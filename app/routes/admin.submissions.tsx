import { and, eq, inArray } from "drizzle-orm";
import { Form, data, redirect, useFetcher } from "react-router";
import { z } from "zod";
import { getDb } from "~/db";
// Client-safe enums come from ~/db/constants (pure) — importing them from
// ~/db/schema would pull drizzle-orm + every table def into the client bundle.
import {
	DECISION_STATUS,
	SUBMISSION_STATUS,
	SUBMISSION_TYPE,
} from "~/db/constants";
import { insertSubmissionSchema, submissions } from "~/db/schema";
import {
	canTransition,
	sendDecisionEmails,
	transitionSubmissions,
} from "~/domain/accept";
import { getActiveEvent, requireAdmin } from "~/lib/auth";
import { errorMessage } from "~/lib/errors";
import { createTimings, track } from "~/lib/track";
import {
	Button,
	Chip,
	EmptyRow,
	ErrorText,
	Field,
	Input,
	PageHeader,
	Panel,
	Select,
	StatusBadge,
	SUBMISSION_STATUS_TONE,
	Table,
	TBody,
	Td,
	Th,
	THead,
	Tr,
} from "~/ui";
import type { Route } from "./+types/admin.submissions";

// Validate with the DB-derived schema (SSOT), REFINED: drizzle-zod maps a
// notNull text column to z.string(), which accepts "" — so `.min(1)` is required
// or every "required" text field silently accepts blank on a direct POST.
const NewSubmission = insertSubmissionSchema
	.pick({ title: true, type: true, status: true })
	.extend({ title: z.string().min(1, "Title is required") });

const SetStatus = z.object({
	submissionId: z.string().min(1),
	status: z.enum(DECISION_STATUS),
});

const BulkSetStatus = z.object({
	submissionIds: z
		.array(z.string().min(1))
		.min(1, "Select at least one submission."),
	status: z.enum(DECISION_STATUS),
});

const SendDecisions = z.object({
	submissionIds: z
		.array(z.string().min(1))
		.min(1, "Select at least one submission."),
	decision: z.enum(["accept", "decline"]),
	idempotencyKey: z.string().min(1),
});

type DecisionActionData = {
	fieldErrors?: Record<string, string[] | undefined>;
	formError?: string;
	notice?: string;
	skipped?: string[];
};

// Without this export, RR7 drops loader/action headers from DOCUMENT
// responses (they only flow to .data requests) — Server-Timing would
// silently vanish on full page loads.
export function headers({ loaderHeaders }: Route.HeadersArgs) {
	return loaderHeaders;
}

export async function loader({ context, request }: Route.LoaderArgs) {
	const env = context.cloudflare.env;
	// Self-authenticate — do NOT rely on the admin.tsx layout loader: single-fetch
	// lets a client run this loader alone via `?_routes=`, skipping the layout.
	const user = await requireAdmin(env, request);
	const event = await getActiveEvent(env, user);
	// Minted per render: decision sends carry it as their idempotency key, so a
	// double-submit dedupes while a fresh page (fresh key) can re-send.
	const sendKey = crypto.randomUUID();
	if (!event) return { submissions: [], eventName: null, sendKey };
	const db = getDb(env);
	const timings = createTimings();
	const rows = await timings.time("db", () =>
		db.query.submissions.findMany({
			where: (s, { eq }) => eq(s.eventId, event.id), // scope to the ACTIVE event
			with: {
				format: true,
				participants: { with: { contact: true } },
				submissionTracks: { with: { track: true } },
			},
			orderBy: (s, { desc }) => [desc(s.createdAt)],
			limit: 100, // paginate for real lists — never load an unbounded table
		}),
	);
	return data(
		{ submissions: rows, eventName: event.name, sendKey },
		{ headers: { "Server-Timing": timings.header() } },
	);
}

export async function action({ context, request }: Route.ActionArgs) {
	const env = context.cloudflare.env;
	// Actions MUST self-authenticate — a POST does not re-run the layout loader.
	const user = await requireAdmin(env, request);
	const db = getDb(env);
	const form = await request.formData();
	// Derive tenant/ownership fields SERVER-side — never trust the client for
	// eventId. (On a public/portal route, also default `status` server-side and
	// never accept it from a non-admin submitter — that would be escalation.)
	const event = await getActiveEvent(env, user);
	if (!event) {
		return { fieldErrors: undefined, formError: "No event is configured yet." };
	}

	const intent = form.get("intent") ?? "create";
	if (intent === "set-status") {
		return setStatusAction(db, event.id, form);
	}
	if (intent === "bulk-set-status") {
		return bulkSetStatusAction(db, event.id, form);
	}
	if (intent === "send-accept" || intent === "send-decline") {
		return sendDecisionsAction(db, env, event, form, intent);
	}

	const parsed = NewSubmission.safeParse({
		title: form.get("title"),
		type: form.get("type") || undefined,
		status: form.get("status") || undefined,
	});
	if (!parsed.success) {
		return {
			fieldErrors: z.flattenError(parsed.error).fieldErrors,
			formError: undefined,
		};
	}
	const timings = createTimings();
	try {
		await timings.time("db", () =>
			db.insert(submissions).values({ ...parsed.data, eventId: event.id }),
		);
	} catch (error) {
		// Log the detail server-side; show the user a generic message (never leak
		// SQL / row values into the UI).
		track("submission.create_failed", {
			eventId: event.id,
			error: errorMessage(error),
		});
		return {
			fieldErrors: undefined,
			formError: "Could not save the submission — please try again.",
		};
	}
	track("submission.created", {
		eventId: event.id,
		type: parsed.data.type,
		status: parsed.data.status,
	});
	return redirect("/admin/submissions", {
		headers: { "Server-Timing": timings.header() },
	});
}

/** Rows the caller may act on = rows of the ACTIVE event only. Ids that don't
 * resolve inside it (another org's, another event's, deleted) are refused. */
async function findEventSubmissions(
	db: ReturnType<typeof getDb>,
	eventId: string,
	ids: string[],
) {
	return db
		.select()
		.from(submissions)
		.where(and(inArray(submissions.id, ids), eq(submissions.eventId, eventId)));
}

async function setStatusAction(
	db: ReturnType<typeof getDb>,
	eventId: string,
	form: FormData,
): Promise<DecisionActionData> {
	const parsed = SetStatus.safeParse({
		submissionId: form.get("submissionId"),
		status: form.get("status"),
	});
	if (!parsed.success) {
		return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
	}
	const rows = await findEventSubmissions(db, eventId, [
		parsed.data.submissionId,
	]);
	const row = rows[0];
	if (!row) {
		return { formError: "That submission does not belong to this event." };
	}
	const [result] = await transitionSubmissions(db, [row], parsed.data.status);
	if (result && !result.ok) return { formError: result.reason };
	return {
		notice: `"${row.title}" is now ${parsed.data.status.replace("_", " ")}.`,
	};
}

async function bulkSetStatusAction(
	db: ReturnType<typeof getDb>,
	eventId: string,
	form: FormData,
): Promise<DecisionActionData> {
	const parsed = BulkSetStatus.safeParse({
		submissionIds: form.getAll("submissionIds"),
		status: form.get("status"),
	});
	if (!parsed.success) {
		return { formError: firstZodMessage(parsed.error) };
	}
	const rows = await findEventSubmissions(
		db,
		eventId,
		parsed.data.submissionIds,
	);
	const skipped: string[] = missingIdNotes(parsed.data.submissionIds, rows);
	const results = await transitionSubmissions(db, rows, parsed.data.status);
	for (const r of results.filter((r) => !r.ok)) {
		const title = rows.find((row) => row.id === r.submissionId)?.title;
		skipped.push(`"${title ?? r.submissionId}": ${r.reason}`);
	}
	const changed = results.filter((r) => r.ok).length;
	return {
		notice: `${changed} submission${changed === 1 ? "" : "s"} set to ${parsed.data.status.replace("_", " ")}.`,
		skipped: skipped.length ? skipped : undefined,
	};
}

async function sendDecisionsAction(
	db: ReturnType<typeof getDb>,
	env: Env,
	event: NonNullable<Awaited<ReturnType<typeof getActiveEvent>>>,
	form: FormData,
	intent: "send-accept" | "send-decline",
): Promise<DecisionActionData> {
	const parsed = SendDecisions.safeParse({
		submissionIds: form.getAll("submissionIds"),
		decision: intent === "send-accept" ? "accept" : "decline",
		idempotencyKey: form.get("idempotencyKey"),
	});
	if (!parsed.success) {
		return { formError: firstZodMessage(parsed.error) };
	}
	const { decision, idempotencyKey } = parsed.data;
	const target = decision === "accept" ? "accepted" : "declined";
	const rows = await findEventSubmissions(
		db,
		event.id,
		parsed.data.submissionIds,
	);
	const skipped: string[] = missingIdNotes(parsed.data.submissionIds, rows);

	// Sessionboard's loop is send → then flip; we run both as one explicit
	// action. Rows that can't take the decision (drafts) are excluded from the
	// send too — nobody gets a decision email for a decision that didn't apply.
	const eligible = rows.filter((r) => canTransition(r.status, target).ok);
	for (const row of rows.filter((r) => !canTransition(r.status, target).ok)) {
		const check = canTransition(row.status, target);
		skipped.push(`"${row.title}": ${check.ok ? "" : check.reason}`);
	}
	const timings = createTimings();
	try {
		const results = await timings.time("db", async () => {
			const sent = await sendDecisionEmails(db, env, {
				event,
				rows: eligible,
				decision,
				idempotencyKey,
			});
			const sendable = new Set(
				sent.filter((s) => s.ok).map((s) => s.submissionId),
			);
			const transitions = await transitionSubmissions(
				db,
				eligible.filter((r) => sendable.has(r.id)),
				target,
			);
			return { sent, transitions };
		});
		for (const s of results.sent.filter((s) => !s.ok)) {
			const title = rows.find((row) => row.id === s.submissionId)?.title;
			skipped.push(`"${title ?? s.submissionId}": ${s.reason}`);
		}
		const emailed = results.sent.filter((s) => s.ok && !s.deduped).length;
		const finalized = results.transitions.filter((t) => t.ok).length;
		return {
			notice: `${emailed} ${decision} email${emailed === 1 ? "" : "s"} sent · ${finalized} submission${finalized === 1 ? "" : "s"} finalized as ${target}.`,
			skipped: skipped.length ? skipped : undefined,
		};
	} catch (error) {
		track("email.decision_send_failed", {
			eventId: event.id,
			decision,
			error: errorMessage(error),
		});
		return {
			formError:
				"Could not send the decision emails — check the event's email templates and try again.",
		};
	}
}

function firstZodMessage(error: z.ZodError): string {
	return error.issues[0]?.message ?? "Invalid request.";
}

function missingIdNotes(
	requested: string[],
	found: { id: string }[],
): string[] {
	const present = new Set(found.map((r) => r.id));
	return requested
		.filter((id) => !present.has(id))
		.map((id) => `"${id}": not part of this event.`);
}

function StatusCell({
	id,
	title,
	status,
}: {
	id: string;
	title: string;
	status: (typeof SUBMISSION_STATUS)[number];
}) {
	const fetcher = useFetcher();
	const pending = fetcher.formData?.get("status");
	const shown =
		typeof pending === "string" &&
		(SUBMISSION_STATUS as readonly string[]).includes(pending)
			? (pending as (typeof SUBMISSION_STATUS)[number])
			: status;
	if (status === "draft") {
		return <StatusBadge tone={SUBMISSION_STATUS_TONE.draft}>draft</StatusBadge>;
	}
	return (
		<fetcher.Form method="post" className="flex items-center gap-2">
			<Input type="hidden" name="intent" value="set-status" />
			<Input type="hidden" name="submissionId" value={id} />
			<StatusBadge tone={SUBMISSION_STATUS_TONE[shown]}>
				{shown.replace("_", " ")}
			</StatusBadge>
			<Select
				key={status}
				name="status"
				defaultValue={status}
				aria-label={`Change status of ${title}`}
				onChange={(e) => fetcher.submit(e.currentTarget.form)}
			>
				{status === "withdrawn" && (
					<option value="withdrawn" disabled>
						withdrawn
					</option>
				)}
				{DECISION_STATUS.map((s) => (
					<option key={s} value={s}>
						{s.replace("_", " ")}
					</option>
				))}
			</Select>
		</fetcher.Form>
	);
}

export default function Submissions({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { submissions: rows, sendKey } = loaderData;
	const fieldErrors =
		actionData && "fieldErrors" in actionData
			? actionData.fieldErrors
			: undefined;
	const formError =
		actionData && "formError" in actionData ? actionData.formError : undefined;
	const notice =
		actionData && "notice" in actionData ? actionData.notice : undefined;
	const skipped =
		actionData && "skipped" in actionData ? actionData.skipped : undefined;
	return (
		<div className="mx-auto flex max-w-5xl flex-col gap-5 px-7 py-6">
			<PageHeader title="Submissions" count={`${rows.length} total`} />

			<Panel>
				<Form method="post" className="flex flex-wrap items-end gap-3">
					<Field label="Title" error={fieldErrors?.title?.[0]}>
						<Input name="title" invalid={Boolean(fieldErrors?.title?.[0])} />
					</Field>
					<Field label="Type">
						<Select name="type">
							{SUBMISSION_TYPE.map((t) => (
								<option key={t} value={t}>
									{t}
								</option>
							))}
						</Select>
					</Field>
					<Field label="Status">
						<Select name="status">
							{SUBMISSION_STATUS.map((s) => (
								<option key={s} value={s}>
									{s.replace("_", " ")}
								</option>
							))}
						</Select>
					</Field>
					<Button type="submit" icon="plus">
						Add submission
					</Button>
					{formError && <ErrorText>{formError}</ErrorText>}
				</Form>
			</Panel>

			<Panel>
				<Form
					method="post"
					id="bulk-actions"
					className="flex flex-wrap items-end gap-3"
				>
					<Input type="hidden" name="idempotencyKey" value={sendKey} />
					<Field label="Selected submissions">
						<Select name="status" defaultValue="accept_queue">
							{DECISION_STATUS.map((s) => (
								<option key={s} value={s}>
									{s.replace("_", " ")}
								</option>
							))}
						</Select>
					</Field>
					<Button
						type="submit"
						name="intent"
						value="bulk-set-status"
						variant="ghost"
					>
						Apply status
					</Button>
					<Button type="submit" name="intent" value="send-accept" icon="mail">
						Send accept emails + finalize
					</Button>
					<Button
						type="submit"
						name="intent"
						value="send-decline"
						variant="ghost"
						icon="mail"
					>
						Send decline emails + finalize
					</Button>
				</Form>
				{notice && <p className="pt-3">{notice}</p>}
				{skipped?.map((s) => (
					<ErrorText key={s}>Skipped {s}</ErrorText>
				))}
			</Panel>

			<Table>
				<THead>
					<Th> </Th>
					<Th>Title</Th>
					<Th>Status</Th>
					<Th>Tracks</Th>
					<Th>Speakers</Th>
					<Th>Format</Th>
				</THead>
				<TBody>
					{rows.map((s) => (
						<Tr key={s.id}>
							<Td>
								<Input
									type="checkbox"
									name="submissionIds"
									value={s.id}
									form="bulk-actions"
									aria-label={`Select ${s.title}`}
								/>
							</Td>
							<Td kind="strong">{s.title}</Td>
							<Td>
								<StatusCell id={s.id} title={s.title} status={s.status} />
							</Td>
							<Td>
								<div className="flex flex-wrap gap-3">
									{s.submissionTracks.map((st) => (
										<Chip key={st.trackId} color={st.track.color}>
											{st.track.name}
										</Chip>
									))}
								</div>
							</Td>
							<Td kind="mono">{s.participants.length}</Td>
							<Td>{s.format?.name ?? "—"}</Td>
						</Tr>
					))}
					{rows.length === 0 && (
						<EmptyRow colSpan={6}>
							No submissions yet — share your call for papers and talks will
							land here.
						</EmptyRow>
					)}
				</TBody>
			</Table>
		</div>
	);
}

export function ErrorBoundary() {
	// Show a generic message — never render the raw error (it can carry SQL /
	// row values). The detail is in the server logs (see the action's catch).
	return (
		<div className="mx-auto max-w-5xl px-7 py-6">
			<PageHeader
				title="Failed to load submissions"
				tone="danger"
				subtitle="Something went wrong. Please refresh or try again."
			/>
		</div>
	);
}
