import { and, eq, inArray } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { useState } from "react";
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
import {
	contacts,
	insertSubmissionSchema,
	participants,
	submissionRevisions,
	submissions,
} from "~/db/schema";
import {
	canReceiveDecision,
	MissingTemplateError,
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
	.pick({ title: true, type: true, status: true, description: true })
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
		.min(1, "Select at least one submission.")
		.max(
			100,
			"Decision emails go out in batches of up to 100 — narrow the selection.",
		),
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
export function headers({ actionHeaders, loaderHeaders }: Route.HeadersArgs) {
	return actionHeaders.has("Server-Timing") ? actionHeaders : loaderHeaders;
}

export async function loader({ context, request }: Route.LoaderArgs) {
	const env = context.cloudflare.env;
	// Self-authenticate — do NOT rely on the admin.tsx layout loader: single-fetch
	// lets a client run this loader alone via `?_routes=`, skipping the layout.
	const user = await requireAdmin(env, request);
	const event = await getActiveEvent(env, user);
	if (!event) return { submissions: [], eventName: null };
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
		{ submissions: rows, eventName: event.name },
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

	return createSubmission(db, event.id, user.id, form);
}

/**
 * The ONE manual-create path — the inline form on this page AND the
 * "+ Add Submission / Add Session" drawer on the Abstracts/Sessions tabs both
 * POST here (the drawer adds description + speaker participants and a `drawer`
 * flag so errors render in place instead of navigating). Creating AS accepted
 * routes through the accept spine so provisioning and content gating behave
 * exactly like a review-time accept.
 */
async function createSubmission(
	db: ReturnType<typeof getDb>,
	eventId: string,
	creatorId: string,
	form: FormData,
) {
	const parsed = NewSubmission.safeParse({
		title: form.get("title"),
		type: form.get("type") || undefined,
		status: form.get("status") || undefined,
		description: form.get("description") || undefined,
	});
	if (!parsed.success) {
		return {
			fieldErrors: z.flattenError(parsed.error).fieldErrors,
			formError: undefined,
		};
	}
	const participantContactIds = [
		...new Set(
			form
				.getAll("participantContactIds")
				.map(String)
				.filter((v) => v.length > 0),
		),
	];
	const timings = createTimings();
	const id = crypto.randomUUID();
	try {
		const refusal = await timings.time("db", async () => {
			if (participantContactIds.length) {
				// Speakers attach as existing contacts of THIS event only — a forged
				// foreign contact id is refused, never written.
				const owned = await db
					.select({ id: contacts.id })
					.from(contacts)
					.where(
						and(
							inArray(contacts.id, participantContactIds),
							eq(contacts.eventId, eventId),
						),
					);
				if (owned.length !== participantContactIds.length) {
					return "Some selected contacts do not belong to this event.";
				}
			}
			const desired = parsed.data.status ?? "pending";
			const statements: BatchItem<"sqlite">[] = [
				db.insert(submissions).values({
					...parsed.data,
					id,
					// Accepted is reached only THROUGH the spine (below), never by
					// direct insert — provisioning must run exactly once.
					status: desired === "accepted" ? "pending" : desired,
					eventId, // server-derived — never trust a client eventId
				}),
			];
			if (participantContactIds.length) {
				statements.push(
					db.insert(participants).values(
						participantContactIds.map((contactId, i) => ({
							submissionId: id,
							contactId,
							role: "speaker" as const,
							isPrimary: i === 0,
							position: i,
						})),
					),
				);
			}
			// Creation is the first content save — snapshot it so a later edit can
			// always be restored back to the original.
			statements.push(
				db.insert(submissionRevisions).values({
					submissionId: id,
					title: parsed.data.title,
					description: parsed.data.description ?? "",
					editedById: creatorId,
				}),
			);
			await db.batch(
				statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]],
			);
			return null;
		});
		if (refusal) {
			return timed(timings, { formError: refusal });
		}
	} catch (error) {
		// Log the detail server-side; show the user a generic message (never leak
		// SQL / row values into the UI).
		track("submission.create_failed", {
			eventId,
			error: errorMessage(error),
		});
		return {
			fieldErrors: undefined,
			formError: "Could not save the submission — please try again.",
		};
	}
	track("submission.created", {
		eventId,
		type: parsed.data.type,
		status: parsed.data.status,
		participants: participantContactIds.length,
	});
	// The accept transition runs AFTER the committed create so a spine failure
	// is reported as exactly what it is — the row exists; a retry must not
	// re-create it.
	let notice = `"${parsed.data.title}" created.`;
	if (parsed.data.status === "accepted") {
		try {
			const [row] = await timings.time("db", () =>
				db.select().from(submissions).where(eq(submissions.id, id)),
			);
			const [transition] = row
				? await transitionSubmissions(db, [row], "accepted")
				: [];
			if (transition && !transition.ok) {
				notice = `"${parsed.data.title}" created as pending — accepting it failed: ${transition.reason}`;
			}
		} catch (error) {
			track("submission.create_accept_failed", {
				eventId,
				submissionId: id,
				error: errorMessage(error),
			});
			notice = `"${parsed.data.title}" was created, but accepting it failed — set the status from its detail page.`;
		}
	}
	if (form.get("drawer")) {
		return data(
			{ created: true, notice },
			{ headers: { "Server-Timing": timings.header() } },
		);
	}
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

/** Wrap an intent's result so its Server-Timing marks reach the response. */
function timed(
	timings: ReturnType<typeof createTimings>,
	body: DecisionActionData,
) {
	return data(body, { headers: { "Server-Timing": timings.header() } });
}

async function setStatusAction(
	db: ReturnType<typeof getDb>,
	eventId: string,
	form: FormData,
) {
	const parsed = SetStatus.safeParse({
		submissionId: form.get("submissionId"),
		status: form.get("status"),
	});
	if (!parsed.success) {
		return {
			fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<
				string,
				string[] | undefined
			>,
		};
	}
	const timings = createTimings();
	const result = await timings.time("db", async () => {
		const rows = await findEventSubmissions(db, eventId, [
			parsed.data.submissionId,
		]);
		const row = rows[0];
		if (!row)
			return { formError: "That submission does not belong to this event." };
		const [transition] = await transitionSubmissions(
			db,
			[row],
			parsed.data.status,
		);
		if (transition && !transition.ok) return { formError: transition.reason };
		return {
			notice: `"${row.title}" is now ${parsed.data.status.replace("_", " ")}.`,
		};
	});
	return timed(timings, result);
}

async function bulkSetStatusAction(
	db: ReturnType<typeof getDb>,
	eventId: string,
	form: FormData,
) {
	const parsed = BulkSetStatus.safeParse({
		submissionIds: form.getAll("submissionIds"),
		status: form.get("status"),
	});
	if (!parsed.success) {
		return { formError: firstZodMessage(parsed.error) };
	}
	const timings = createTimings();
	const result = await timings.time("db", async () => {
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
	});
	return timed(timings, result);
}

async function sendDecisionsAction(
	db: ReturnType<typeof getDb>,
	env: Env,
	event: NonNullable<Awaited<ReturnType<typeof getActiveEvent>>>,
	form: FormData,
	intent: "send-accept" | "send-decline",
) {
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
	const timings = createTimings();
	const rows = await timings.time("db", () =>
		findEventSubmissions(db, event.id, parsed.data.submissionIds),
	);
	const skipped: string[] = missingIdNotes(parsed.data.submissionIds, rows);

	// Sessionboard's loop is send → then flip; we run both as one explicit
	// action. Rows that can't take the decision (drafts) are excluded from the
	// send too — nobody gets a decision email for a decision that didn't apply.
	const eligible: typeof rows = [];
	for (const row of rows) {
		const check = canReceiveDecision(row.status);
		if (check.ok) eligible.push(row);
		else skipped.push(`"${row.title}": ${check.reason}`);
	}
	let sent: Awaited<ReturnType<typeof sendDecisionEmails>>;
	try {
		sent = await timings.time("send", () =>
			sendDecisionEmails(db, env, {
				event,
				rows: eligible,
				decision,
				idempotencyKey,
			}),
		);
	} catch (error) {
		track("email.decision_send_failed", {
			eventId: event.id,
			decision,
			error: errorMessage(error),
		});
		// Missing template is product state the admin can fix; anything else is
		// infrastructure and gets the generic copy (never leak provider detail).
		// Retrying re-uses the form's key, so partial sends never deliver twice.
		return timed(timings, {
			formError:
				error instanceof MissingTemplateError
					? error.message
					: "Sending failed partway — try again; emails already sent will not go out twice.",
		});
	}
	const sendable = new Set(sent.filter((s) => s.ok).map((s) => s.submissionId));
	try {
		const transitions = await timings.time("db", () =>
			transitionSubmissions(
				db,
				eligible.filter((r) => sendable.has(r.id)),
				target,
			),
		);
		for (const s of sent.filter((s) => !s.ok)) {
			const title = rows.find((row) => row.id === s.submissionId)?.title;
			skipped.push(`"${title ?? s.submissionId}": ${s.reason}`);
		}
		const emailed = sent.filter((s) => s.ok && !s.deduped).length;
		const finalized = transitions.filter((t) => t.ok).length;
		return timed(timings, {
			notice: `${emailed} ${decision} email${emailed === 1 ? "" : "s"} sent · ${finalized} submission${finalized === 1 ? "" : "s"} finalized as ${target}.`,
			skipped: skipped.length ? skipped : undefined,
		});
	} catch (error) {
		// The emails DID go out — say so, and point at the safe remediation.
		track("submission.transition_failed", {
			eventId: event.id,
			decision,
			error: errorMessage(error),
		});
		return timed(timings, {
			formError:
				"Decision emails were sent, but updating statuses failed — send again to finish; duplicates are prevented.",
		});
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
	// A refused flip snaps the pill back — say why instead of failing silently.
	const inlineError =
		!pending &&
		fetcher.data &&
		typeof fetcher.data === "object" &&
		"formError" in fetcher.data &&
		typeof fetcher.data.formError === "string"
			? fetcher.data.formError
			: undefined;
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
			{inlineError && <ErrorText>{inlineError}</ErrorText>}
		</fetcher.Form>
	);
}

export default function Submissions({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { submissions: rows } = loaderData;
	const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
	// The send idempotency key is minted per SELECTION and held in client
	// state, so loader revalidation can't rotate it: retrying a failed (or
	// double-clicked) send re-uses the key and dedupes — nothing delivers
	// twice — while a deliberate re-send (fresh page or reselect) goes out.
	const [sendKey, setSendKey] = useState("");
	const toggleSelected = (id: string, checked: boolean) => {
		setSelected((prev) => {
			const next = new Set(prev);
			if (checked) next.add(id);
			else next.delete(id);
			return next;
		});
		setSendKey(crypto.randomUUID());
	};
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
					<Input type="hidden" name="idempotencyKey" value={sendKey} readOnly />
					<Field
						label={`${selected.size} selected submission${selected.size === 1 ? "" : "s"}`}
					>
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
						disabled={selected.size === 0}
					>
						Apply status
					</Button>
					<Button
						type="submit"
						name="intent"
						value="send-accept"
						icon="mail"
						disabled={selected.size === 0 || !sendKey}
					>
						Send accept emails + finalize
					</Button>
					<Button
						type="submit"
						name="intent"
						value="send-decline"
						variant="ghost"
						icon="mail"
						disabled={selected.size === 0 || !sendKey}
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
									checked={selected.has(s.id)}
									onChange={(e) =>
										toggleSelected(s.id, e.currentTarget.checked)
									}
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
