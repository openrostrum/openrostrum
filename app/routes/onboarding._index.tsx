import { and, eq } from "drizzle-orm";
import { Form, redirect } from "react-router";
import { z } from "zod";
import { getDb } from "~/db";
import { events, organizationMembers, organizations, users } from "~/db/schema";
import {
	deriveEventSlug,
	eventSlugBase,
	randomizedSlug,
	requireFirstRunStart,
} from "~/domain/onboarding";
import { provisionEventDefaults } from "~/domain/provisionEvent";
import { requireAdmin } from "~/lib/auth";
import { errorChainIncludes, errorMessage } from "~/lib/errors";
import { createTimings, track } from "~/lib/track";
import { useBusy } from "~/lib/use-busy";
import { isSlugTakenError } from "~/settings/event-details.server";
import { Button, ErrorText, Field, Input, PageHeader, Panel } from "~/ui";
import type { Route } from "./+types/onboarding._index";

/**
 * The name is the only first-run question with no good default: organization,
 * membership, event, URL, email templates, task list and portal are all derived
 * from it in one batch, so the organizer's first action produces a working event
 * rather than a half-filled form.
 */

const ConferenceForm = z.object({
	conferenceName: z
		.string()
		.trim()
		.min(1, "Your conference needs a name to get started")
		.max(200, "Keep the name under 200 characters"),
});

const SetupIds = z.object({
	setupOrganizationId: z.string().uuid(),
	setupEventId: z.string().uuid(),
});
type SetupIds = z.infer<typeof SetupIds>;

/** A derived slug can still lose a race against a concurrent create; the
 * UNIQUE index is the authority, so retry with a randomized suffix. */
const SLUG_RETRIES = 2;

type EchoValues = Record<"conferenceName", string>;

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
	// Self-authenticate; a user who already has an event lands on the dashboard,
	// while a membership-only state resumes against that same organization.
	const user = await requireAdmin(env, request);
	const { organizationId: existingOrganizationId } = await requireFirstRunStart(
		env,
		user,
	);

	const form = await request.formData();
	const values: EchoValues = {
		conferenceName: String(form.get("conferenceName") ?? ""),
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
	let slug = await timings.time("slug", () => deriveEventSlug(db, name));

	for (let attempt = 0; attempt <= SLUG_RETRIES; attempt++) {
		const attemptedSlug = slug;
		try {
			await timings.time("db", async () => {
				const eventStatements = [
					db.insert(events).values({
						id: eventId,
						organizationId,
						name,
						slug: attemptedSlug,
					}),
					...provisionEventDefaults(db, eventId),
					db
						.update(users)
						.set({ activeEventId: eventId })
						.where(eq(users.id, user.id)),
				] as const;

				if (existingOrganizationId) {
					// An organization that already exists was named by whoever created
					// it — an invite, or an earlier attempt. Never rename it from here.
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
			// Only the two IDs echoed by this setup form can identify a losing
			// replay; unrelated batch failures must remain visible as failures.
			const replayConflict =
				errorChainIncludes(
					error,
					"UNIQUE constraint failed: organizations.id",
				) || errorChainIncludes(error, "UNIQUE constraint failed: events.id");
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
				return redirect("/onboarding/dates", {
					headers: { "Server-Timing": timings.header() },
				});
			}
			// The organizer never chose this URL, so a collision with someone
			// else's event is ours to resolve, not theirs to read about.
			if (isSlugTakenError(error) && attempt < SLUG_RETRIES) {
				slug = randomizedSlug(eventSlugBase(name));
				continue;
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
		return redirect("/onboarding/dates", {
			headers: { "Server-Timing": timings.header() },
		});
	}

	return {
		formError: "Could not create your conference — please try again.",
		values,
		setupIds,
	};
}

export default function OnboardingStart({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const busy = useBusy();
	const setupIds = actionData?.setupIds ?? loaderData;
	const nameError = actionData?.fieldErrors?.conferenceName?.[0];

	return (
		<>
			<PageHeader
				title="What conference are you running?"
				subtitle="The name is all we need to open your event — its program, its emails, and its public pages. Two short steps after this."
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
							defaultValue={actionData?.values?.conferenceName}
							invalid={Boolean(nameError)}
						/>
					</Field>
					<Button type="submit" disabled={busy}>
						Continue
					</Button>
					{actionData?.formError && (
						<ErrorText>{actionData.formError}</ErrorText>
					)}
				</Form>
			</Panel>
		</>
	);
}
