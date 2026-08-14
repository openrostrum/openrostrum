import { useState } from "react";
import { and, eq } from "drizzle-orm";
import { Form, redirect } from "react-router";
import { z } from "zod";
import { getDb } from "~/db";
import { events, organizationMembers, organizations, users } from "~/db/schema";
import { getFirstRunState, requireFirstRunStart } from "~/domain/onboarding";
import { provisionEventDefaults } from "~/domain/provisionEvent";
import { requireAdmin } from "~/lib/auth";
import { errorChainIncludes, errorMessage } from "~/lib/errors";
import { createTimings, track } from "~/lib/track";
import { useBusy } from "~/lib/use-busy";
import {
	EventSlug,
	isSlugTakenError,
	SLUG_TAKEN_MESSAGE,
} from "~/settings/event-details.server";
import { eventSlugBase } from "~/settings/event-form";
import { Button, ErrorText, Field, Input, PageHeader, Panel } from "~/ui";
import type { Route } from "./+types/onboarding._index";

/**
 * The name is the only first-run question with no good default. The derived
 * slug is visible and editable before the site opens — a taken tidy slug is
 * theirs to confirm, not ours to mint.
 */
const ConferenceForm = z.object({
	conferenceName: z
		.string()
		.trim()
		.min(1, "Your conference needs a name to get started")
		.max(200, "Keep the name under 200 characters"),
	slug: EventSlug,
});

const SetupIds = z.object({
	setupOrganizationId: z.string().uuid(),
	setupEventId: z.string().uuid(),
});
type SetupIds = z.infer<typeof SetupIds>;

type EchoValues = Record<"conferenceName" | "slug", string>;

type ActionResult = {
	fieldErrors?: Partial<Record<keyof EchoValues, string[]>>;
	formError?: string;
	values?: EchoValues;
	setupIds?: SetupIds;
};

export async function loader({ context, request }: Route.LoaderArgs) {
	const env = context.cloudflare.env;
	const user = await requireAdmin(env, request);
	await requireFirstRunStart(env, user);
	// Client-minted IDs: a double-submit replays the same two rows instead of
	// creating a second organization.
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
	const user = await requireAdmin(env, request);
	const firstRun = await getFirstRunState(env, user.id);
	const form = await request.formData();
	const values: EchoValues = {
		conferenceName: String(form.get("conferenceName") ?? ""),
		slug: String(form.get("slug") ?? ""),
	};
	const openAdmin = String(form.get("intent") ?? "") === "admin";

	if (firstRun.hasEvent) {
		throw redirect(openAdmin ? "/admin" : `/schedule/${firstRun.slug}`);
	}

	const existingOrganizationId = firstRun.organizationId;
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
	const parsed = ConferenceForm.safeParse(values);
	if (!parsed.success) {
		return {
			fieldErrors: z.flattenError(parsed.error).fieldErrors,
			values,
			setupIds,
		};
	}

	const db = getDb(env);
	const name = parsed.data.conferenceName;
	const organizationId = existingOrganizationId ?? setupIds.setupOrganizationId;
	const eventId = setupIds.setupEventId;
	const timings = createTimings();
	const slug = parsed.data.slug;
	const destination = openAdmin ? "/admin" : `/schedule/${slug}`;
	try {
		await timings.time("db", async () => {
			const eventStatements = [
				db.insert(events).values({
					id: eventId,
					organizationId,
					name,
					slug,
				}),
				...provisionEventDefaults(db, eventId),
				db
					.update(users)
					.set({ activeEventId: eventId })
					.where(eq(users.id, user.id)),
			] as const;

			if (existingOrganizationId) {
				await db.batch([...eventStatements]);
				return;
			}

			await db.batch([
				db.insert(organizations).values({ id: organizationId, name }),
				db.insert(organizationMembers).values({
					organizationId,
					userId: user.id,
				}),
				...eventStatements,
			]);
		});
	} catch (error) {
		const replayConflict =
			errorChainIncludes(error, "UNIQUE constraint failed: organizations.id") ||
			errorChainIncludes(error, "UNIQUE constraint failed: events.id");
		const [replayed] = replayConflict
			? await db
					.select({ name: events.name })
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
		if (replayed?.name === name) {
			track("onboarding.replayed", { userId: user.id });
			return redirect(destination, {
				headers: { "Server-Timing": timings.header() },
			});
		}
		if (isSlugTakenError(error)) {
			return {
				fieldErrors: { slug: [SLUG_TAKEN_MESSAGE] },
				values,
				setupIds,
			};
		}
		track("onboarding.failed", {
			userId: user.id,
			error: errorMessage(error),
		});
		return {
			formError: "Could not create your conference — please try again.",
			values,
			setupIds,
		};
	}

	track("onboarding.event_created", {
		organizationId,
		eventId,
		userId: user.id,
	});
	return redirect(destination, {
		headers: { "Server-Timing": timings.header() },
	});
}

export default function OnboardingStart({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const busy = useBusy();
	const setupIds = actionData?.setupIds ?? loaderData;
	const nameError = actionData?.fieldErrors?.conferenceName?.[0];
	const slugError = actionData?.fieldErrors?.slug?.[0];
	const [name, setName] = useState(actionData?.values?.conferenceName ?? "");
	const [slug, setSlug] = useState(actionData?.values?.slug ?? "");
	const [slugEdited, setSlugEdited] = useState(
		Boolean(actionData?.values?.slug),
	);
	const slugPreview = slug || eventSlugBase(name) || "your-conference";

	return (
		<>
			<PageHeader
				title="What conference are you running?"
				subtitle="This name goes on a public page you can send someone right now."
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
					<Field label="Conference name" error={nameError}>
						<Input
							name="conferenceName"
							required
							maxLength={200}
							placeholder="Devcon 2027"
							value={name}
							invalid={Boolean(nameError)}
							onChange={(e) => {
								const next = e.target.value;
								setName(next);
								if (!slugEdited) setSlug(eventSlugBase(next));
							}}
						/>
					</Field>
					<Field
						label="Public URL"
						hint={`/schedule/${slugPreview}`}
						error={slugError}
					>
						<Input
							name="slug"
							required
							maxLength={80}
							placeholder="devcon-2027"
							value={slug}
							invalid={Boolean(slugError)}
							onChange={(e) => {
								setSlug(e.target.value);
								setSlugEdited(true);
							}}
						/>
					</Field>
					<Button type="submit" disabled={busy}>
						Open the site
					</Button>
					<Button
						type="submit"
						name="intent"
						value="admin"
						variant="ghost"
						disabled={busy}
					>
						Go to admin instead
					</Button>
					{actionData?.formError && (
						<ErrorText>{actionData.formError}</ErrorText>
					)}
				</Form>
			</Panel>
		</>
	);
}
