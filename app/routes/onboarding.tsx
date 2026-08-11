import { and, eq } from "drizzle-orm";
import { useEffect, useMemo, useState } from "react";
import { Form, redirect } from "react-router";
import { z } from "zod";
import { getDb } from "~/db";
import { events, organizationMembers, organizations, users } from "~/db/schema";
import { provisionEventDefaults } from "~/domain/provisionEvent";
import { requireAdmin } from "~/lib/auth";
import { errorChainIncludes, errorMessage } from "~/lib/errors";
import { createTimings, track } from "~/lib/track";
import { useBusy } from "~/lib/use-busy";
import {
	isSlugTakenError,
	SLUG_TAKEN_MESSAGE,
	zonedInputToDate,
} from "~/settings/event-details.server";
import {
	Button,
	ErrorText,
	Field,
	Input,
	PageHeader,
	Panel,
	Select,
	Wordmark,
} from "~/ui";
import type { Route } from "./+types/onboarding";

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidTimeZone(tz: string): boolean {
	try {
		new Intl.DateTimeFormat("en-US", { timeZone: tz });
		return true;
	} catch {
		return false;
	}
}

const OnboardingForm = z
	.object({
		organizationName: z
			.string()
			.trim()
			.min(1, "Organization name is required")
			.max(200),
		eventName: z.string().trim().min(1, "Event name is required").max(200),
		slug: z
			.string()
			.trim()
			.toLowerCase()
			.min(1, "A URL slug is required")
			.max(80, "Keep the slug under 80 characters")
			.regex(SLUG_RE, "Lowercase letters, numbers, and hyphens only"),
		startsAt: z.string().regex(DATE_RE, "Pick a start date"),
		endsAt: z.string().regex(DATE_RE, "Pick an end date"),
		timezone: z
			.string()
			.refine(isValidTimeZone, "Pick a timezone from the list"),
	})
	.refine((v) => v.endsAt >= v.startsAt, {
		path: ["endsAt"],
		message: "End date must be on or after the start date",
	});

const SetupIds = z.object({
	setupOrganizationId: z.string().uuid(),
	setupEventId: z.string().uuid(),
});
type SetupIds = z.infer<typeof SetupIds>;

/** Raw submitted values, echoed back so a full-document error response
 * (no-JS fallback) re-renders the form filled in instead of wiped. */
type EchoValues = Record<
	| "organizationName"
	| "eventName"
	| "slug"
	| "startsAt"
	| "endsAt"
	| "timezone",
	string
>;

type ActionResult = {
	fieldErrors?: Partial<Record<keyof EchoValues, string[]>>;
	formError?: string;
	values?: EchoValues;
	setupIds?: SetupIds;
};

async function getOnboardingState(env: Env, userId: string) {
	const db = getDb(env);
	const [event] = await db
		.select({
			eventId: events.id,
			organizationId: organizationMembers.organizationId,
		})
		.from(organizationMembers)
		.innerJoin(
			events,
			eq(events.organizationId, organizationMembers.organizationId),
		)
		.where(eq(organizationMembers.userId, userId))
		.limit(1);
	if (event) return { complete: true as const, ...event };

	const [organization] = await db
		.select({ id: organizations.id })
		.from(organizationMembers)
		.innerJoin(
			organizations,
			eq(organizations.id, organizationMembers.organizationId),
		)
		.where(eq(organizationMembers.userId, userId))
		.limit(1);
	return {
		complete: false as const,
		eventId: null,
		organizationId: organization?.id ?? null,
	};
}

/**
 * Only authenticated organizers without an event onboard. A membership-only
 * state is incomplete and resumes against that same organization.
 */
async function checkOnboardingAccess(
	env: Env,
	user: Awaited<ReturnType<typeof requireAdmin>>,
) {
	const state = await getOnboardingState(env, user.id);
	if (state.complete) throw redirect("/admin");
	return { organizationId: state.organizationId };
}

export async function loader({ context, request }: Route.LoaderArgs) {
	const env = context.cloudflare.env;
	const user = await requireAdmin(env, request);
	await checkOnboardingAccess(env, user);
	return {
		setupOrganizationId: crypto.randomUUID(),
		setupEventId: crypto.randomUUID(),
	};
}

export async function action({
	context,
	request,
}: Route.ActionArgs): Promise<ActionResult | Response> {
	const env = context.cloudflare.env;
	// Self-authenticate; completed replays redirect, while a membership-only
	// state resumes against that same organization.
	const user = await requireAdmin(env, request);
	const { organizationId: existingOrganizationId } =
		await checkOnboardingAccess(env, user);

	const form = await request.formData();
	const values: EchoValues = {
		organizationName: String(form.get("organizationName") ?? ""),
		eventName: String(form.get("eventName") ?? ""),
		slug: String(form.get("slug") ?? ""),
		startsAt: String(form.get("startsAt") ?? ""),
		endsAt: String(form.get("endsAt") ?? ""),
		timezone: String(form.get("timezone") ?? ""),
	};
	const setupResult = SetupIds.safeParse({
		setupOrganizationId: form.get("setupOrganizationId"),
		setupEventId: form.get("setupEventId"),
	});
	if (!setupResult.success) {
		return {
			formError: "This setup form expired — refresh and try again.",
			values,
		};
	}
	const setupIds = setupResult.data;
	const parsed = OnboardingForm.safeParse(values);
	if (!parsed.success) {
		return {
			fieldErrors: z.flattenError(parsed.error).fieldErrors,
			values,
			setupIds,
		};
	}

	const db = getDb(env);
	const organizationId = existingOrganizationId ?? setupIds.setupOrganizationId;
	const eventId = setupIds.setupEventId;
	// Date-only picks preserve the selected calendar day in the event zone:
	// starts open at local midnight and ends close at local 23:59.
	const startsAt = zonedInputToDate(
		`${parsed.data.startsAt}T00:00`,
		parsed.data.timezone,
	);
	const endsAt = zonedInputToDate(
		`${parsed.data.endsAt}T23:59`,
		parsed.data.timezone,
	);
	const timings = createTimings();
	try {
		await timings.time("db", async () => {
			const eventStatements = [
				db.insert(events).values({
					id: eventId,
					organizationId,
					name: parsed.data.eventName,
					slug: parsed.data.slug,
					timezone: parsed.data.timezone,
					startsAt,
					endsAt,
				}),
				...provisionEventDefaults(db, eventId),
				db
					.update(users)
					.set({ activeEventId: eventId })
					.where(eq(users.id, user.id)),
			] as const;

			if (existingOrganizationId) {
				await db.batch([
					db
						.update(organizations)
						.set({ name: parsed.data.organizationName })
						.where(eq(organizations.id, organizationId)),
					...eventStatements,
				]);
				return;
			}

			await db.batch([
				db
					.insert(organizations)
					.values({ id: organizationId, name: parsed.data.organizationName }),
				db.insert(organizationMembers).values({
					organizationId,
					userId: user.id,
				}),
				...eventStatements,
			]);
		});
	} catch (error) {
		// Only the two IDs echoed by this setup form can identify a losing replay;
		// unrelated batch failures must remain visible as failures.
		const replayConflict =
			errorChainIncludes(error, "UNIQUE constraint failed: organizations.id") ||
			errorChainIncludes(error, "UNIQUE constraint failed: events.id");
		const [completedReplay] = replayConflict
			? await db
					.select({
						organizationName: organizations.name,
						eventName: events.name,
						slug: events.slug,
						timezone: events.timezone,
						startsAt: events.startsAt,
						endsAt: events.endsAt,
					})
					.from(organizationMembers)
					.innerJoin(
						organizations,
						eq(organizations.id, organizationMembers.organizationId),
					)
					.innerJoin(events, eq(events.organizationId, organizations.id))
					.where(
						and(
							eq(organizationMembers.userId, user.id),
							eq(organizations.id, organizationId),
							eq(events.id, eventId),
						),
					)
					.limit(1)
			: [];
		const replayMatches =
			completedReplay?.organizationName === parsed.data.organizationName &&
			completedReplay.eventName === parsed.data.eventName &&
			completedReplay.slug === parsed.data.slug &&
			completedReplay.timezone === parsed.data.timezone &&
			completedReplay.startsAt?.getTime() === startsAt.getTime() &&
			completedReplay.endsAt?.getTime() === endsAt.getTime();
		if (replayMatches) {
			track("onboarding.replayed", { userId: user.id });
			return redirect("/admin", {
				headers: { "Server-Timing": timings.header() },
			});
		}
		// Event slugs are one global namespace — a taken slug is a normal
		// user-facing outcome, not a server error.
		if (isSlugTakenError(error)) {
			return {
				fieldErrors: {
					slug: [SLUG_TAKEN_MESSAGE],
				},
				values,
				setupIds,
			};
		}
		track("onboarding.failed", {
			userId: user.id,
			error: errorMessage(error),
		});
		return {
			formError: "Could not create your organization — please try again.",
			values,
			setupIds,
		};
	}

	track("onboarding.completed", { organizationId, eventId, userId: user.id });
	return redirect("/admin", {
		headers: { "Server-Timing": timings.header() },
	});
}

function slugify(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

const FALLBACK_TIMEZONE = "America/Los_Angeles";

export default function Onboarding({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const busy = useBusy();
	const setupIds = actionData?.setupIds ?? loaderData;
	const timeZones = useMemo(() => Intl.supportedValuesOf("timeZone"), []);
	const echoed = actionData?.values;
	// The slug tracks the event name until it is edited by hand (SSR renders
	// the value as a plain attribute, so the field still works without JS).
	const [slug, setSlug] = useState(echoed?.slug ?? "");
	const [slugEdited, setSlugEdited] = useState(false);

	// Preselect the visitor's own timezone — a client-only signal, applied to
	// the uncontrolled select after hydration and only while it's untouched.
	useEffect(() => {
		if (echoed) return; // a submitted value beats the browser guess
		const guess = Intl.DateTimeFormat().resolvedOptions().timeZone;
		if (!guess || !timeZones.includes(guess)) return;
		const select = document.querySelector('select[name="timezone"]');
		if (
			select instanceof HTMLSelectElement &&
			select.value === FALLBACK_TIMEZONE
		) {
			select.value = guess;
		}
	}, [echoed, timeZones]);

	return (
		<main className="mx-auto flex min-h-screen w-full max-w-[560px] flex-col justify-center gap-7 px-6 py-16">
			<div className="flex justify-center">
				<Wordmark size={21} />
			</div>
			<PageHeader
				title="Set up your organization"
				subtitle="Name your organization and your first event — you can change all of this later from settings."
			/>
			<Panel>
				<Form method="post" className="flex flex-col gap-[13px]">
					<Input
						type="hidden"
						name="setupOrganizationId"
						value={setupIds.setupOrganizationId}
						readOnly
					/>
					<Input
						type="hidden"
						name="setupEventId"
						value={setupIds.setupEventId}
						readOnly
					/>
					<Field
						label="Organization name"
						error={actionData?.fieldErrors?.organizationName?.[0]}
					>
						<Input
							name="organizationName"
							autoComplete="organization"
							required
							placeholder="Devcon Collective"
							defaultValue={echoed?.organizationName}
							invalid={Boolean(actionData?.fieldErrors?.organizationName?.[0])}
						/>
					</Field>
					<Field
						label="First event name"
						error={actionData?.fieldErrors?.eventName?.[0]}
					>
						<Input
							name="eventName"
							required
							placeholder="Devcon 2027"
							defaultValue={echoed?.eventName}
							invalid={Boolean(actionData?.fieldErrors?.eventName?.[0])}
							onChange={(e) => {
								if (!slugEdited) setSlug(slugify(e.target.value));
							}}
						/>
					</Field>
					<Field
						label="Event URL slug"
						error={actionData?.fieldErrors?.slug?.[0]}
					>
						<Input
							name="slug"
							required
							placeholder="devcon-2027"
							value={slug}
							invalid={Boolean(actionData?.fieldErrors?.slug?.[0])}
							onChange={(e) => {
								setSlug(e.target.value);
								setSlugEdited(true);
							}}
						/>
					</Field>
					<div className="flex flex-wrap gap-3 [&>label]:min-w-[180px] [&>label]:flex-1">
						<Field
							label="Start date"
							error={actionData?.fieldErrors?.startsAt?.[0]}
						>
							<Input
								name="startsAt"
								type="date"
								required
								defaultValue={echoed?.startsAt}
								invalid={Boolean(actionData?.fieldErrors?.startsAt?.[0])}
							/>
						</Field>
						<Field
							label="End date"
							error={actionData?.fieldErrors?.endsAt?.[0]}
						>
							<Input
								name="endsAt"
								type="date"
								required
								defaultValue={echoed?.endsAt}
								invalid={Boolean(actionData?.fieldErrors?.endsAt?.[0])}
							/>
						</Field>
					</div>
					<Field
						label="Timezone"
						error={actionData?.fieldErrors?.timezone?.[0]}
					>
						<Select
							name="timezone"
							required
							defaultValue={echoed?.timezone ?? FALLBACK_TIMEZONE}
						>
							{timeZones.map((tz) => (
								<option key={tz} value={tz}>
									{tz.replaceAll("_", " ")}
								</option>
							))}
						</Select>
					</Field>
					<Button type="submit" disabled={busy}>
						Create organization
					</Button>
					{actionData?.formError && (
						<ErrorText>{actionData.formError}</ErrorText>
					)}
				</Form>
			</Panel>
		</main>
	);
}

export function ErrorBoundary() {
	return (
		<main className="mx-auto max-w-[560px] px-6 py-16">
			<PageHeader
				title="Setup failed to load"
				tone="danger"
				subtitle="Something went wrong. Please refresh or try again."
			/>
		</main>
	);
}
