import { data } from "react-router";
import {
	ContactImportWizard,
	IMPORT_LIMITS_HINT,
} from "~/components/contact-import-wizard";
import { getDb } from "~/db";
import {
	executeImportWrites,
	loadEventContacts,
	planContactImport,
} from "~/domain/contact-import";
import { getActiveEvent, requireAdmin } from "~/lib/auth";
import {
	countOutcomes,
	type ImportStep,
	PARTIAL_FAILURE_ERROR,
	readMappedCsv,
	readUpload,
} from "~/lib/contact-import";
import { createTimings, track } from "~/lib/track";
import { ButtonLink, PageHeader } from "~/ui";
import type { Route } from "./+types/admin.contacts_.import";

/**
 * Import speakers into the current event. The engine (column mapping, dedupe,
 * batched writes) is shared with the organization directory importer — see
 * ~/domain/contact-import; this route only supplies the event scope.
 */
type ActionResult = ImportStep;

export function headers({ actionHeaders, loaderHeaders }: Route.HeadersArgs) {
	return actionHeaders.has("Server-Timing") ? actionHeaders : loaderHeaders;
}

export async function loader({ context, request }: Route.LoaderArgs) {
	const env = context.cloudflare.env;
	const user = await requireAdmin(env, request);
	const event = await getActiveEvent(env, user);
	return { eventName: event?.name ?? null };
}

export async function action({
	context,
	request,
}: Route.ActionArgs): Promise<
	ActionResult | ReturnType<typeof data<ActionResult>>
> {
	const env = context.cloudflare.env;
	const user = await requireAdmin(env, request);
	const event = await getActiveEvent(env, user);
	if (!event)
		return { step: "upload", formError: "No event is configured yet." };
	const db = getDb(env);
	const form = await request.formData();
	const intent = String(form.get("intent") ?? "upload");
	const policyValue = String(form.get("duplicatePolicy") ?? "");
	const duplicatePolicy =
		policyValue === "skip" || policyValue === "create" ? policyValue : null;

	if (intent === "upload") return readUpload(form.get("file"));

	const parsed = readMappedCsv(form);
	if (!parsed.ok) return parsed.step;

	const timings = createTimings();
	const existing = await timings.time("db", () =>
		loadEventContacts(db, event.id),
	);
	const plan = planContactImport({
		rows: parsed.rows,
		mapping: parsed.mapping,
		targetEventId: event.id,
		targetEventName: event.name,
		// One event's roster is the whole matching scope here: a row either
		// merges into this event's contact or creates a new one.
		existing,
		duplicatePolicy,
	});

	if (plan.probableDuplicates.length > 0 && duplicatePolicy === null) {
		return {
			step: "review",
			csvB64: parsed.csvB64,
			mapping: parsed.mapping,
			probableDuplicates: plan.probableDuplicates,
		};
	}

	const writeError = await executeImportWrites(db, plan, timings);
	if (writeError) {
		track("contacts.import_failed", { eventId: event.id, error: writeError });
	}
	const counts = countOutcomes(plan.results);
	track("contacts.imported", { eventId: event.id, ...counts });
	return data<ActionResult>(
		{
			step: "done",
			...counts,
			results: plan.results,
			formError: writeError ? PARTIAL_FAILURE_ERROR : undefined,
		},
		{ headers: { "Server-Timing": timings.header() } },
	);
}

export default function ImportContacts({ actionData }: Route.ComponentProps) {
	return (
		<ContactImportWizard
			title="Import speakers from CSV"
			subtitle="The migration path off Sessionboard: upload an export, map its columns, and every row is accounted for — added, merged, or skipped with a reason."
			back={{ to: "/admin/contacts", label: "Back to speakers" }}
			done={{ to: "/admin/contacts", label: "View the roster" }}
			basePath="/admin/contacts/import"
			uploadHint={`${IMPORT_LIMITS_HINT} The first row must be column headers (name, email, company…) — you will map them to contact fields next, so any column order works.`}
			duplicateHint="These rows have the same normalized name and company as an existing speaker, but a different email. They will never be auto-merged."
			state={actionData}
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
				<ButtonLink to="/admin/contacts/import" variant="ghost">
					Try again
				</ButtonLink>
			</div>
		</div>
	);
}
