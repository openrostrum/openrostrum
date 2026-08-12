import { asc, eq } from "drizzle-orm";
import { data, redirect } from "react-router";
import {
	ContactImportWizard,
	IMPORT_LIMITS_HINT,
} from "~/components/contact-import-wizard";
import { getDb } from "~/db";
import { events } from "~/db/schema";
import {
	executeImportWrites,
	loadOrgContacts,
	planContactImport,
	resolveTargetEvent,
} from "~/domain/contact-import";
import { requireAdmin, resolveActiveOrg } from "~/lib/auth";
import {
	countOutcomes,
	type ImportStep,
	PARTIAL_FAILURE_ERROR,
	readMappedCsv,
	readUpload,
} from "~/lib/contact-import";
import { createTimings, track } from "~/lib/track";
import {
	ButtonLink,
	EmptyState,
	Field,
	Input,
	PageHeader,
	Panel,
	Select,
} from "~/ui";
import type { Route } from "./+types/admin.crm.directory_.import";

/**
 * Import people into the organization directory. Same engine as the event
 * roster importer (~/domain/contact-import) with the organization as the
 * matching scope: someone the directory already knows gains an appearance on
 * the chosen event instead of becoming a second person with the same email.
 *
 * A contact always belongs to an event, so the importer asks which one — the
 * same requirement the directory's "Add person" form makes.
 */
type ActionResult = ImportStep & { targetEventId: string | null };

const NO_EVENT_PICKED = "Choose the event these people should be added to.";
const FOREIGN_EVENT = "That event does not belong to your organization.";

export function headers({ actionHeaders, loaderHeaders }: Route.HeadersArgs) {
	return actionHeaders.has("Server-Timing") ? actionHeaders : loaderHeaders;
}

export async function loader({ context, request }: Route.LoaderArgs) {
	const env = context.cloudflare.env;
	const user = await requireAdmin(env, request);
	const db = getDb(env);
	const org = await resolveActiveOrg(env, user);
	if (!org) throw redirect("/admin/crm");
	const orgEvents = await db
		.select({ id: events.id, name: events.name })
		.from(events)
		.where(eq(events.organizationId, org.id))
		.orderBy(asc(events.createdAt));
	return { events: orgEvents };
}

export async function action({
	context,
	request,
}: Route.ActionArgs): Promise<
	ActionResult | ReturnType<typeof data<ActionResult>>
> {
	const env = context.cloudflare.env;
	const user = await requireAdmin(env, request);
	const org = await resolveActiveOrg(env, user);
	if (!org) throw redirect("/admin/crm");
	const db = getDb(env);
	const form = await request.formData();
	const intent = String(form.get("intent") ?? "upload");
	const policyValue = String(form.get("duplicatePolicy") ?? "");
	const duplicatePolicy =
		policyValue === "skip" || policyValue === "create" ? policyValue : null;

	// Resolved through the org on EVERY step, not just the first: the event id
	// rides along in a hidden field, so it is re-checked before any write.
	const targetEventId = String(form.get("targetEventId") ?? "");
	if (!targetEventId) {
		return { step: "upload", formError: NO_EVENT_PICKED, targetEventId: null };
	}
	const target = await resolveTargetEvent(db, org.id, targetEventId);
	if (!target) {
		return { step: "upload", formError: FOREIGN_EVENT, targetEventId: null };
	}

	if (intent === "upload") {
		return {
			...(await readUpload(form.get("file"))),
			targetEventId: target.id,
		};
	}

	const parsed = readMappedCsv(form);
	if (!parsed.ok) return { ...parsed.step, targetEventId: target.id };

	const timings = createTimings();
	const existing = await timings.time("db", () => loadOrgContacts(db, org.id));
	const plan = planContactImport({
		rows: parsed.rows,
		mapping: parsed.mapping,
		targetEventId: target.id,
		targetEventName: target.name,
		// The whole organization is the matching scope — that is what makes this
		// a directory import rather than a second roster import.
		existing,
		duplicatePolicy,
	});

	if (plan.probableDuplicates.length > 0 && duplicatePolicy === null) {
		return {
			step: "review",
			csvB64: parsed.csvB64,
			mapping: parsed.mapping,
			probableDuplicates: plan.probableDuplicates,
			targetEventId: target.id,
		};
	}

	const writeError = await executeImportWrites(db, plan, timings);
	if (writeError) {
		track("crm.directory_import_failed", {
			organizationId: org.id,
			eventId: target.id,
			error: writeError,
		});
	}
	const counts = countOutcomes(plan.results);
	track("crm.directory_imported", {
		organizationId: org.id,
		eventId: target.id,
		...counts,
	});
	return data<ActionResult>(
		{
			step: "done",
			...counts,
			results: plan.results,
			formError: writeError ? PARTIAL_FAILURE_ERROR : undefined,
			targetEventId: target.id,
		},
		{ headers: { "Server-Timing": timings.header() } },
	);
}

export default function ImportDirectory({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { events: orgEvents } = loaderData;
	const state = actionData;

	if (orgEvents.length === 0) {
		return (
			<div className="flex flex-col gap-5 px-7 py-6">
				<PageHeader
					title="Import people from CSV"
					subtitle="People live on events, so the directory needs one event to import into."
				/>
				<Panel>
					<EmptyState
						icon="calendar"
						title="Create an event first"
						body="Every person in the directory belongs to at least one event. Create one, then import your list into it."
						action={
							<ButtonLink to="/admin/events/new" icon="plus">
								Create an event
							</ButtonLink>
						}
					/>
				</Panel>
			</div>
		);
	}

	// Never pre-picked: an import dropped on the wrong event is a thousand rows
	// to undo by hand, so the organizer names the event before anything moves.
	const selected = state?.targetEventId ?? "";

	return (
		<ContactImportWizard
			title="Import people from CSV"
			subtitle="Bring a list into the directory: rows for people you already know join them to the event you pick, everyone else is created — every row accounted for."
			back={{ to: "/admin/crm/directory", label: "Back to the directory" }}
			done={{ to: "/admin/crm/directory", label: "View the directory" }}
			basePath="/admin/crm/directory/import"
			uploadFields={
				<Field label="Add these people to">
					<Select name="targetEventId" defaultValue={selected}>
						<option value="">Choose an event…</option>
						{orgEvents.map((event) => (
							<option key={event.id} value={event.id}>
								{event.name}
							</option>
						))}
					</Select>
				</Field>
			}
			carryFields={
				<Input type="hidden" name="targetEventId" value={selected} readOnly />
			}
			uploadHint={`${IMPORT_LIMITS_HINT} The first row must be column headers (name, email, company…) — you map them next, so any column order works. Anyone already in the directory keeps their profile and simply joins the event you picked.`}
			duplicateHint="These rows have the same normalized name and company as someone already in your directory, but a different email. They will never be auto-merged."
			state={state}
		/>
	);
}

export function ErrorBoundary() {
	return (
		<div className="mx-auto max-w-5xl px-7 py-6">
			<PageHeader
				title="Import failed"
				tone="danger"
				subtitle="Something went wrong reading that file. Please try again."
			/>
			<div className="mt-4">
				<ButtonLink to="/admin/crm/directory/import" variant="ghost">
					Try again
				</ButtonLink>
			</div>
		</div>
	);
}
