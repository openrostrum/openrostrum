import { eq } from "drizzle-orm";
import { useEffect, useMemo, useState } from "react";
import { Form, redirect, useNavigation } from "react-router";
import { z } from "zod";
import { getDb } from "~/db";
import { events, organizationMembers, organizations, users } from "~/db/schema";
import { provisionEventDefaults } from "~/domain/provisionEvent";
import { getUser, homePathForRole } from "~/lib/auth";
import { errorMessage } from "~/lib/errors";
import { createTimings, track } from "~/lib/track";
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
};

/**
 * Only authenticated, membership-less organizers onboard: members already
 * have an organization (they go to the app), other roles have their own
 * surfaces, and anonymous visitors start at /signup.
 */
async function checkOnboardingAccess(
	env: Env,
	user: Awaited<ReturnType<typeof getUser>>,
): Promise<NonNullable<Awaited<ReturnType<typeof getUser>>>> {
	if (!user) throw redirect("/signup");
	if (user.role !== "admin") throw redirect(homePathForRole(user.role));
	const [membership] = await getDb(env)
		.select({ id: organizationMembers.id })
		.from(organizationMembers)
		.where(eq(organizationMembers.userId, user.id))
		.limit(1);
	if (membership) throw redirect("/admin");
	return user;
}

export async function loader({ context, request }: Route.LoaderArgs) {
	const env = context.cloudflare.env;
	await checkOnboardingAccess(env, await getUser(env, request));
	return null;
}

export async function action({
	context,
	request,
}: Route.ActionArgs): Promise<ActionResult | Response> {
	const env = context.cloudflare.env;
	// Self-authenticate; the membership check doubles as the double-submit
	// guard — a replayed POST after the first success just lands in /admin.
	const user = await checkOnboardingAccess(env, await getUser(env, request));

	const form = await request.formData();
	const values: EchoValues = {
		organizationName: String(form.get("organizationName") ?? ""),
		eventName: String(form.get("eventName") ?? ""),
		slug: String(form.get("slug") ?? ""),
		startsAt: String(form.get("startsAt") ?? ""),
		endsAt: String(form.get("endsAt") ?? ""),
		timezone: String(form.get("timezone") ?? ""),
	};
	const parsed = OnboardingForm.safeParse(values);
	if (!parsed.success) {
		return { fieldErrors: z.flattenError(parsed.error).fieldErrors, values };
	}

	const db = getDb(env);
	const organizationId = crypto.randomUUID();
	const eventId = crypto.randomUUID();
	const timings = createTimings();
	try {
		// One atomic batch: an org must never exist without its founding member,
		// nor an event without its default email templates.
		await timings.time("db", () =>
			db.batch([
				db
					.insert(organizations)
					.values({ id: organizationId, name: parsed.data.organizationName }),
				db.insert(organizationMembers).values({
					organizationId,
					userId: user.id,
				}),
				db.insert(events).values({
					id: eventId,
					organizationId,
					name: parsed.data.eventName,
					slug: parsed.data.slug,
					timezone: parsed.data.timezone,
					startsAt: new Date(`${parsed.data.startsAt}T00:00:00Z`),
					endsAt: new Date(`${parsed.data.endsAt}T00:00:00Z`),
				}),
				provisionEventDefaults(db, eventId),
				db
					.update(users)
					.set({ activeEventId: eventId })
					.where(eq(users.id, user.id)),
			]),
		);
	} catch (error) {
		// Event slugs are one global namespace (recorded trade-off) — a taken
		// slug is a normal user-facing outcome, not a server error.
		if (errorMessage(error).includes("UNIQUE constraint failed: events.slug")) {
			return {
				fieldErrors: {
					slug: ["That URL slug is already taken — pick another."],
				},
				values,
			};
		}
		track("onboarding.failed", {
			userId: user.id,
			error: errorMessage(error),
		});
		return {
			formError: "Could not create your organization — please try again.",
			values,
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

export default function Onboarding({ actionData }: Route.ComponentProps) {
	const busy = useNavigation().state !== "idle";
	const timeZones = useMemo(() => Intl.supportedValuesOf("timeZone"), []);
	const echoed = actionData?.values;
	// Inputs stay UNCONTROLLED so the form still works without JS; the slug
	// suggestion and timezone guess are layered on via key-remounts.
	const [suggestedSlug, setSuggestedSlug] = useState("");
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
								if (!slugEdited) setSuggestedSlug(slugify(e.target.value));
							}}
						/>
					</Field>
					<Field
						label="Event URL slug"
						error={actionData?.fieldErrors?.slug?.[0]}
					>
						<Input
							key={`slug-${suggestedSlug}`}
							name="slug"
							required
							placeholder="devcon-2027"
							defaultValue={suggestedSlug || (echoed?.slug ?? "")}
							invalid={Boolean(actionData?.fieldErrors?.slug?.[0])}
							onChange={() => setSlugEdited(true)}
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
