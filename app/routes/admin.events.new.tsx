import { asc, eq } from "drizzle-orm";
import { Form, redirect, useNavigation } from "react-router";
import { getDb } from "~/db";
import { events, organizationMembers, organizations, users } from "~/db/schema";
import { provisionEventDefaults } from "~/domain/provisionEvent";
import { getActiveEvent, requireAdmin } from "~/lib/auth";
import { errorMessage } from "~/lib/errors";
import { createTimings, track } from "~/lib/track";
import {
	isSlugTakenError,
	parseEventDetails,
	SLUG_TAKEN_MESSAGE,
} from "~/settings/event-details.server";
import {
	EventDetailsFields,
	type EventDetailsErrors,
	type EventDetailsValues,
} from "~/settings/event-form";
import { Button, ErrorText, PageHeader, Panel } from "~/ui";
import type { Route } from "./+types/admin.events.new";

type ActionResult = {
	fieldErrors?: EventDetailsErrors;
	formError?: string;
	values?: EventDetailsValues;
};

export function headers({ loaderHeaders }: Route.HeadersArgs) {
	return loaderHeaders;
}

/**
 * Which organization owns the new event: the ACTIVE event's organization
 * (multi-tenancy binding rule — new events inherit it), falling back to the
 * user's oldest membership when they have no event yet. A user with no
 * organization at all belongs in /onboarding, which mints org + first event.
 */
async function resolveOrganization(
	env: Env,
	user: Awaited<ReturnType<typeof requireAdmin>>,
): Promise<{ id: string; name: string }> {
	const db = getDb(env);
	const active = await getActiveEvent(env, user);
	const organizationId = active
		? active.organizationId
		: (
				await db
					.select({ organizationId: organizationMembers.organizationId })
					.from(organizationMembers)
					.where(eq(organizationMembers.userId, user.id))
					.orderBy(asc(organizationMembers.createdAt))
					.limit(1)
			)[0]?.organizationId;
	if (!organizationId) throw redirect("/onboarding");
	const [org] = await db
		.select({ id: organizations.id, name: organizations.name })
		.from(organizations)
		.where(eq(organizations.id, organizationId))
		.limit(1);
	if (!org) throw redirect("/onboarding");
	return org;
}

export async function loader({ context, request }: Route.LoaderArgs) {
	const env = context.cloudflare.env;
	// Self-authenticate — never rely on the admin.tsx layout loader.
	const user = await requireAdmin(env, request);
	const organization = await resolveOrganization(env, user);
	return { organizationName: organization.name };
}

export async function action({ context, request }: Route.ActionArgs) {
	const env = context.cloudflare.env;
	// Actions MUST self-authenticate — a POST does not run any layout loader.
	const user = await requireAdmin(env, request);
	const organization = await resolveOrganization(env, user);

	const form = await request.formData();
	const parsed = parseEventDetails(form);
	if (!parsed.ok) {
		return {
			fieldErrors: parsed.fieldErrors,
			values: parsed.values,
		} satisfies ActionResult;
	}

	const db = getDb(env);
	const eventId = crypto.randomUUID();
	const timings = createTimings();
	try {
		// One atomic batch: an event must never exist without its default email
		// templates, and the creator lands inside the new event immediately.
		await timings.time("db", () =>
			db.batch([
				db.insert(events).values({
					id: eventId,
					organizationId: organization.id,
					...parsed.data,
				}),
				provisionEventDefaults(db, eventId),
				db
					.update(users)
					.set({ activeEventId: eventId })
					.where(eq(users.id, user.id)),
			]),
		);
	} catch (error) {
		if (isSlugTakenError(error)) {
			return {
				fieldErrors: { slug: [SLUG_TAKEN_MESSAGE] },
				values: parsed.values,
			} satisfies ActionResult;
		}
		track("event.create_failed", {
			organizationId: organization.id,
			userId: user.id,
			error: errorMessage(error),
		});
		return {
			formError: "Could not create the event — please try again.",
			values: parsed.values,
		} satisfies ActionResult;
	}

	track("event.created", {
		eventId,
		organizationId: organization.id,
		userId: user.id,
	});
	return redirect("/admin", {
		headers: { "Server-Timing": timings.header() },
	});
}

export default function NewEvent({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const busy = useNavigation().state !== "idle";
	return (
		<div className="mx-auto flex max-w-[760px] flex-col gap-5 px-7 py-6">
			<PageHeader
				title="Create event"
				subtitle={`The new event joins ${loaderData.organizationName} with its own submissions, forms, library, and agenda. Everything here can be changed later in settings.`}
			/>
			<Panel>
				<Form method="post" className="flex flex-col gap-[13px]">
					<EventDetailsFields
						values={actionData?.values ?? null}
						errors={actionData?.fieldErrors}
						autoSlug
					/>
					<div className="flex items-center gap-3">
						<Button type="submit" icon="plus" disabled={busy}>
							Create event
						</Button>
						{actionData?.formError && (
							<ErrorText>{actionData.formError}</ErrorText>
						)}
					</div>
				</Form>
			</Panel>
		</div>
	);
}

export function ErrorBoundary() {
	// Generic message only — never render the raw error.
	return (
		<div className="mx-auto max-w-[760px] px-7 py-6">
			<PageHeader
				title="Failed to load the create-event form"
				tone="danger"
				subtitle="Something went wrong. Please refresh or try again."
			/>
		</div>
	);
}
