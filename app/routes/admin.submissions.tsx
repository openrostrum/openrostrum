import { Form, data, redirect } from "react-router";
import { z } from "zod";
import { getDb } from "~/db";
// Client-safe enums come from ~/db/constants (pure) — importing them from
// ~/db/schema would pull drizzle-orm + every table def into the client bundle.
import { SUBMISSION_STATUS, SUBMISSION_TYPE } from "~/db/constants";
import { insertSubmissionSchema, submissions } from "~/db/schema";
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
	// Derive tenant/ownership fields SERVER-side — never trust the client for
	// eventId. (On a public/portal route, also default `status` server-side and
	// never accept it from a non-admin submitter — that would be escalation.)
	const event = await getActiveEvent(env, user);
	if (!event) {
		return { fieldErrors: undefined, formError: "No event is configured yet." };
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

export default function Submissions({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { submissions: rows } = loaderData;
	return (
		<div className="mx-auto flex max-w-5xl flex-col gap-5 px-7 py-6">
			<PageHeader title="Submissions" count={`${rows.length} total`} />

			<Panel>
				<Form method="post" className="flex flex-wrap items-end gap-3">
					<Field label="Title" error={actionData?.fieldErrors?.title?.[0]}>
						<Input
							name="title"
							invalid={Boolean(actionData?.fieldErrors?.title?.[0])}
						/>
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
					{actionData?.formError && (
						<ErrorText>{actionData.formError}</ErrorText>
					)}
				</Form>
			</Panel>

			<Table>
				<THead>
					<Th>Title</Th>
					<Th>Status</Th>
					<Th>Tracks</Th>
					<Th>Speakers</Th>
					<Th>Format</Th>
				</THead>
				<TBody>
					{rows.map((s) => (
						<Tr key={s.id}>
							<Td kind="strong">{s.title}</Td>
							<Td>
								<StatusBadge tone={SUBMISSION_STATUS_TONE[s.status]}>
									{s.status.replace("_", " ")}
								</StatusBadge>
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
						<EmptyRow colSpan={5}>
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
