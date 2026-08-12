import { data, Form, redirect } from "react-router";
import { z } from "zod";
import { IdentityPanel } from "~/components/crm-identity";
import { getDb } from "~/db";
import type { ContactMergeAuditSummary } from "~/db/schema";
import {
	buildContactMergePreview,
	executeContactMerge,
} from "~/domain/contact-merge";
import { normalizeEmail, requireAdmin, resolveActiveOrg } from "~/lib/auth";
import { formatRole } from "~/lib/format";
import { createTimings, track } from "~/lib/track";
import { useBusy } from "~/lib/use-busy";
import {
	ButtonLink,
	ConfirmButton,
	EmptyState,
	ErrorText,
	Input,
	PageHeader,
	Panel,
	StatusBadge,
	Table,
	TBody,
	Td,
	Th,
	THead,
	Tr,
} from "~/ui";
import type { Route } from "./+types/admin.crm.merge";

const MergeInput = z.object({
	sourceEmail: z.email(),
	survivorEmail: z.email(),
	mergeKey: z.uuid(),
});

const MOVEMENT_ROWS: Array<{
	label: string;
	moved: keyof ContactMergeAuditSummary;
	consolidated?: keyof ContactMergeAuditSummary;
}> = [
	{ label: "Survivor event rows created", moved: "eventContactsCreated" },
	{ label: "Duplicate event rows retired", moved: "contactsRetired" },
	{
		label: "Blank survivor profile values filled",
		moved: "profileFieldsFilled",
	},
	{
		label: "Submission participant links",
		moved: "participantLinksMoved",
		consolidated: "participantLinksConsolidated",
	},
	{
		label: "Task assignments",
		moved: "taskAssignmentsMoved",
		consolidated: "taskAssignmentsConsolidated",
	},
	{ label: "Files", moved: "filesMoved" },
	{
		label: "Contact custom values",
		moved: "customValuesMoved",
		consolidated: "customValuesConsolidated",
	},
	{ label: "CRM notes", moved: "notesMoved" },
	{
		label: "Pipeline enrollments",
		moved: "pipelineCardsMoved",
		consolidated: "pipelineCardsConsolidated",
	},
	{ label: "Pipeline stage-history entries", moved: "pipelineHistoryMoved" },
	{ label: "Portal account identities", moved: "portalIdentitiesAliased" },
	{ label: "Submitted sessions reassigned", moved: "submissionsReassigned" },
	{
		label: "Airtable contact mappings",
		moved: "airtableLinksMoved",
		consolidated: "airtableLinksConsolidated",
	},
];

export function headers({ actionHeaders, loaderHeaders }: Route.HeadersArgs) {
	return actionHeaders.has("Server-Timing") ? actionHeaders : loaderHeaders;
}

export async function loader({ context, request }: Route.LoaderArgs) {
	const env = context.cloudflare.env;
	const user = await requireAdmin(env, request);
	const db = getDb(env);
	const timings = createTimings();
	const org = await timings.time("org", () => resolveActiveOrg(env, user));
	if (!org) throw redirect("/admin/crm/directory");
	const url = new URL(request.url);
	const sourceEmail = normalizeEmail(url.searchParams.get("source") ?? "");
	const survivorEmail = normalizeEmail(url.searchParams.get("survivor") ?? "");
	const result = await timings.time("preview", () =>
		buildContactMergePreview(db, org.id, sourceEmail, survivorEmail),
	);
	if (!result.ok) throw data(result.reason, { status: 404 });
	return data(
		{ preview: result.preview, mergeKey: crypto.randomUUID() },
		{ headers: { "Server-Timing": timings.header() } },
	);
}

export async function action({ context, request }: Route.ActionArgs) {
	const env = context.cloudflare.env;
	const user = await requireAdmin(env, request);
	const db = getDb(env);
	const org = await resolveActiveOrg(env, user);
	if (!org) return { formError: "No organization is configured yet." };
	const form = await request.formData();
	const parsed = MergeInput.safeParse({
		sourceEmail: normalizeEmail(String(form.get("sourceEmail") ?? "")),
		survivorEmail: normalizeEmail(String(form.get("survivorEmail") ?? "")),
		mergeKey: form.get("mergeKey"),
	});
	if (!parsed.success) {
		return { formError: "Reload the comparison before merging." };
	}
	const timings = createTimings();
	const result = await timings.time("merge", () =>
		executeContactMerge(db, org.id, {
			...parsed.data,
			idempotencyKey: parsed.data.mergeKey,
			actor: { id: user.id, name: user.name ?? user.email },
		}),
	);
	if (!result.ok) {
		track("crm.contacts_merge_failed", {
			orgId: org.id,
			outcome: result.code,
		});
		return data(
			{ formError: result.reason },
			{ headers: { "Server-Timing": timings.header() } },
		);
	}
	track("crm.contacts_merged", {
		orgId: org.id,
		mergeId: result.mergeId,
		replayed: result.replayed,
	});
	return redirect(
		`/admin/crm/person/${encodeURIComponent(result.survivorEmail)}?merged=1`,
		{ headers: { "Server-Timing": timings.header() } },
	);
}

export default function ContactMerge({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { preview, mergeKey } = loaderData;
	const busy = useBusy();
	const sourceName =
		`${preview.source.firstName} ${preview.source.lastName}`.trim();
	const survivorName =
		`${preview.survivor.firstName} ${preview.survivor.lastName}`.trim();
	const reversePath = `/admin/crm/merge?source=${encodeURIComponent(preview.survivor.email)}&survivor=${encodeURIComponent(preview.source.email)}`;
	const formError = actionData?.formError;

	return (
		<div className="flex flex-col gap-5">
			<PageHeader
				title="Review duplicate contact merge"
				subtitle="Choose the identity that remains active, then review every relationship that will move or consolidate."
				actions={
					<ButtonLink to="/admin/crm/directory" variant="ghost">
						Cancel
					</ButtonLink>
				}
			/>

			<div className="grid items-start gap-5 lg:grid-cols-2">
				<IdentityPanel
					heading="Retiring duplicate"
					aside={<StatusBadge tone="caution">retires</StatusBadge>}
					name={sourceName}
					email={preview.source.email}
					lines={[
						formatRole(preview.source) || "No title or company on record",
					]}
				>
					<ButtonLink to={reversePath} variant="ghost">
						Keep this contact instead
					</ButtonLink>
				</IdentityPanel>
				<IdentityPanel
					heading="Surviving contact"
					aside={<StatusBadge tone="success">primary</StatusBadge>}
					name={survivorName}
					email={preview.survivor.email}
					lines={[
						formatRole(preview.survivor) || "No title or company on record",
					]}
				/>
			</div>

			<div className="flex flex-col gap-3">
				<h2>Per-event contact rows</h2>
				<Table>
					<THead>
						<Th>Event</Th>
						<Th>Retiring row</Th>
						<Th>Survivor row</Th>
						<Th>Profile values filled</Th>
					</THead>
					<TBody>
						{preview.events.map((event) => (
							<Tr key={event.sourceContactId}>
								<Td kind="strong">{event.eventName}</Td>
								<Td kind="mono">{event.sourceContactId}</Td>
								<Td kind="mono">
									{event.createsSurvivor
										? "New survivor row"
										: event.survivorContactId}
								</Td>
								<Td>
									{event.profileFieldsFilled.length > 0
										? event.profileFieldsFilled.join(", ")
										: "None"}
								</Td>
							</Tr>
						))}
					</TBody>
				</Table>
			</div>

			<div className="flex flex-col gap-3">
				<h2>Exactly what moves</h2>
				<Table>
					<THead>
						<Th>Relationship</Th>
						<Th>Moved</Th>
						<Th>Consolidated</Th>
					</THead>
					<TBody>
						{MOVEMENT_ROWS.map((row) => (
							<Tr key={row.label}>
								<Td kind="strong">{row.label}</Td>
								<Td kind="mono">{preview.summary[row.moved]}</Td>
								<Td kind="mono">
									{row.consolidated ? preview.summary[row.consolidated] : "—"}
								</Td>
							</Tr>
						))}
					</TBody>
				</Table>
			</div>

			<Panel>
				<div className="flex flex-col gap-4">
					<div className="flex flex-wrap items-center gap-2">
						<StatusBadge tone="caution">cannot be undone</StatusBadge>
						<p>
							The retired entry leaves the active directory, but its full row
							and movement audit remain recorded. Existing portal credentials
							continue into the survivor.
						</p>
					</div>
					{formError && <ErrorText>{formError}</ErrorText>}
					<Form method="post">
						<Input
							type="hidden"
							name="sourceEmail"
							value={preview.source.email}
						/>
						<Input
							type="hidden"
							name="survivorEmail"
							value={preview.survivor.email}
						/>
						<Input type="hidden" name="mergeKey" value={mergeKey} />
						<ConfirmButton
							label="Merge contacts"
							prompt={`Retire ${preview.source.email} into ${preview.survivor.email}?`}
							confirmLabel="Merge and retire duplicate"
							name="intent"
							value="merge"
							variant="primary"
							disabled={busy}
						/>
					</Form>
				</div>
			</Panel>
		</div>
	);
}

export function ErrorBoundary() {
	return (
		<Panel>
			<EmptyState
				icon="users"
				title="Merge comparison unavailable"
				body="Both contacts must still exist in your organization. Return to the directory and choose another possible duplicate."
				action={
					<ButtonLink to="/admin/crm/directory" variant="ghost">
						Back to the directory
					</ButtonLink>
				}
			/>
		</Panel>
	);
}
