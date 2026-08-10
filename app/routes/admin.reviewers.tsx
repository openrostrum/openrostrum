import { useState } from "react";
import { and, count, eq, inArray, notInArray } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { Form, data, redirect } from "react-router";
import { z } from "zod";
import { getDb } from "~/db";
import {
	evaluationPlans,
	evaluationRounds,
	evaluations,
	reviewerTracks,
	roundEvaluators,
	submissions,
	tracks,
} from "~/db/schema";
import { getActiveEvent, requireAdmin } from "~/lib/auth";
import { ensureQuickRound, mintEvaluations } from "~/lib/assign";
import { errorMessage } from "~/lib/errors";
import { fetchChunked, REVIEWABLE_EXCLUDED, utcDayKey } from "~/lib/evaluation";
import { escapeHtmlText } from "~/lib/html";
import {
	activeInviteTokens,
	ensureReviewerUser,
	hasUsablePassword,
	listEventReviewers,
	mintInviteToken,
} from "~/lib/reviewers";
import { getEmailSender } from "~/ports/email";
import { createTimings, track } from "~/lib/track";
import {
	Button,
	Chip,
	EmptyRow,
	EmptyState,
	ErrorText,
	Field,
	Input,
	PageHeader,
	Panel,
	Select,
	StatusBadge,
	Table,
	TBody,
	Td,
	Th,
	THead,
	Tr,
} from "~/ui";
import type { Route } from "./+types/admin.reviewers";

const AddReviewer = z.object({
	name: z.string().min(1, "Name is required"),
	email: z.string().email("Enter a valid email address"),
	trackIds: z.array(z.string().min(1)).min(1, "Assign at least one track"),
});

export function headers({ loaderHeaders }: Route.HeadersArgs) {
	return loaderHeaders;
}

export async function loader({ context, request }: Route.LoaderArgs) {
	const env = context.cloudflare.env;
	const user = await requireAdmin(env, request);
	const event = await getActiveEvent(env, user);
	if (!event) {
		return data({
			eventName: null,
			origin: new URL(request.url).origin,
			tracks: [],
			reviewers: [],
			rounds: [],
			assignable: [],
		});
	}
	const db = getDb(env);
	const timings = createTimings();
	const [eventTracks, registry, rounds, assignable] = await timings.time(
		"db",
		() =>
			Promise.all([
				db
					.select({ id: tracks.id, name: tracks.name, color: tracks.color })
					.from(tracks)
					.where(eq(tracks.eventId, event.id))
					.orderBy(tracks.name),
				listEventReviewers(db, event.id),
				db
					.select({
						id: evaluationRounds.id,
						name: evaluationRounds.name,
						planName: evaluationPlans.name,
					})
					.from(evaluationRounds)
					.innerJoin(
						evaluationPlans,
						eq(evaluationPlans.id, evaluationRounds.planId),
					)
					.where(eq(evaluationPlans.eventId, event.id))
					.orderBy(evaluationPlans.createdAt, evaluationRounds.position),
				db
					.select({ id: submissions.id, title: submissions.title })
					.from(submissions)
					.where(
						and(
							eq(submissions.eventId, event.id),
							notInArray(submissions.status, [...REVIEWABLE_EXCLUDED]),
						),
					)
					.orderBy(submissions.createdAt)
					.limit(500),
			]),
	);
	const userIds = registry.map((r) => r.id);
	const [tokens, evalCounts] = await timings.time("db-counts", () =>
		Promise.all([
			activeInviteTokens(db, userIds),
			userIds.length === 0
				? Promise.resolve([])
				: db
						.select({
							evaluatorId: evaluations.evaluatorId,
							status: evaluations.status,
							n: count(),
						})
						.from(evaluations)
						.innerJoin(
							evaluationRounds,
							eq(evaluationRounds.id, evaluations.roundId),
						)
						.innerJoin(
							evaluationPlans,
							eq(evaluationPlans.id, evaluationRounds.planId),
						)
						.where(eq(evaluationPlans.eventId, event.id))
						.groupBy(evaluations.evaluatorId, evaluations.status),
		]),
	);
	const trackById = new Map(eventTracks.map((t) => [t.id, t]));
	const origin = new URL(request.url).origin;
	const reviewers = registry.map((r) => {
		const mine = evalCounts.filter((c) => c.evaluatorId === r.id);
		const token = tokens.get(r.id);
		return {
			id: r.id,
			name: r.name,
			email: r.email,
			invited: r.invited,
			tracks: r.trackIds.flatMap((id) => {
				const t = trackById.get(id);
				return t ? [t] : [];
			}),
			assigned: mine.reduce((sum, c) => sum + c.n, 0),
			completed: mine.find((c) => c.status === "completed")?.n ?? 0,
			inviteLink: r.invited && token ? `${origin}/set-password/${token}` : null,
		};
	});
	return data(
		{
			eventName: event.name,
			origin,
			tracks: eventTracks,
			reviewers,
			rounds,
			assignable,
		},
		{ headers: { "Server-Timing": timings.header() } },
	);
}

type ActionResult = {
	intent: string;
	ok?: string;
	formError?: string;
	fieldErrors?: Record<string, string[] | undefined>;
};

export async function action({
	context,
	request,
}: Route.ActionArgs): Promise<Response | ActionResult> {
	const env = context.cloudflare.env;
	const user = await requireAdmin(env, request);
	const event = await getActiveEvent(env, user);
	if (!event) {
		return { intent: "none", formError: "No event is configured yet." };
	}
	const db = getDb(env);
	const form = await request.formData();
	const intent = String(form.get("intent") ?? "");
	const origin = new URL(request.url).origin;

	const eventTracks = await db
		.select({ id: tracks.id })
		.from(tracks)
		.where(eq(tracks.eventId, event.id));
	const eventTrackIds = new Set(eventTracks.map((t) => t.id));

	try {
		if (intent === "add") {
			const parsed = AddReviewer.safeParse({
				name: form.get("name"),
				email: form.get("email"),
				trackIds: form.getAll("trackIds").map(String),
			});
			if (!parsed.success) {
				return {
					intent,
					fieldErrors: z.flattenError(parsed.error).fieldErrors,
				};
			}
			if (!parsed.data.trackIds.every((id) => eventTrackIds.has(id))) {
				return { intent, formError: "Pick tracks from this event only." };
			}
			const { user: reviewer } = await ensureReviewerUser(db, parsed.data);
			await db
				.insert(reviewerTracks)
				.values(
					parsed.data.trackIds.map((trackId) => ({
						userId: reviewer.id,
						trackId,
					})),
				)
				.onConflictDoNothing();
			const invited = !hasUsablePassword(reviewer.passwordHash);
			const sender = getEmailSender(env);
			if (invited) {
				const token = await mintInviteToken(db, reviewer.id);
				const link = `${origin}/set-password/${token}`;
				await sender.send({
					to: reviewer.email,
					subject: `You're invited to review for ${event.name}`,
					html: `<p>Hi ${escapeHtmlText(parsed.data.name)},</p><p>You have been invited to review submissions for ${escapeHtmlText(event.name)}.</p><p><a href="${link}">Set your password to start reviewing</a></p><p>Or paste this link into your browser: ${link}</p>`,
					dedupeKey: `reviewer_invite:${reviewer.id}:${token}`,
					eventId: event.id,
				});
			} else {
				await sender.send({
					to: reviewer.email,
					subject: `You're now a reviewer for ${event.name}`,
					html: `<p>Hi ${escapeHtmlText(parsed.data.name)},</p><p>You have been added as a reviewer for ${escapeHtmlText(event.name)}.</p><p><a href="${origin}/reviews">Open your review queue</a></p>`,
					// Day-scoped occurrence: a same-day double-submit dedupes, but a
					// reviewer removed and later re-added is still notified.
					dedupeKey: `reviewer_added:${reviewer.id}:${event.id}:${utcDayKey()}`,
					eventId: event.id,
				});
			}
			track("reviewer.added", {
				eventId: event.id,
				userId: reviewer.id,
				invited,
				trackCount: parsed.data.trackIds.length,
			});
			return redirect("/admin/reviewers");
		}

		if (intent === "reinvite") {
			const userId = String(form.get("userId") ?? "");
			const target = (await listEventReviewers(db, event.id)).find(
				(r) => r.id === userId,
			);
			if (!target) return { intent, formError: "Reviewer not found." };
			if (!target.invited) {
				return {
					intent,
					formError: "This reviewer already has a working login.",
				};
			}
			const token = await mintInviteToken(db, userId);
			const link = `${origin}/set-password/${token}`;
			await getEmailSender(env).send({
				to: target.email,
				subject: `You're invited to review for ${event.name}`,
				html: `<p>Hi ${escapeHtmlText(target.name ?? target.email)},</p><p>Here is a fresh invite link for ${escapeHtmlText(event.name)}.</p><p><a href="${link}">Set your password to start reviewing</a></p><p>Or paste this link into your browser: ${link}</p>`,
				dedupeKey: `reviewer_invite:${userId}:${token}`,
				eventId: event.id,
			});
			track("reviewer.reinvited", { eventId: event.id, userId });
			return { intent, ok: "Invite re-sent — the link below is the new one." };
		}

		if (intent === "update-tracks") {
			const userId = String(form.get("userId") ?? "");
			const trackIds = form.getAll("trackIds").map(String);
			if (trackIds.length === 0) {
				return { intent, formError: "Assign at least one track." };
			}
			if (!trackIds.every((id) => eventTrackIds.has(id))) {
				return { intent, formError: "Pick tracks from this event only." };
			}
			// Never trust a client-supplied principal id: the target must already
			// be one of this event's reviewers.
			const registry = await listEventReviewers(db, event.id);
			if (!registry.some((r) => r.id === userId)) {
				return { intent, formError: "Reviewer not found." };
			}
			await db.batch([
				db
					.delete(reviewerTracks)
					.where(
						and(
							eq(reviewerTracks.userId, userId),
							inArray(reviewerTracks.trackId, [...eventTrackIds]),
						),
					),
				db
					.insert(reviewerTracks)
					.values(trackIds.map((trackId) => ({ userId, trackId })))
					.onConflictDoNothing(),
			]);
			track("reviewer.tracks_updated", { eventId: event.id, userId });
			return { intent, ok: "Tracks updated." };
		}

		if (intent === "remove") {
			const userId = String(form.get("userId") ?? "");
			const eventRounds = await db
				.select({ id: evaluationRounds.id })
				.from(evaluationRounds)
				.innerJoin(
					evaluationPlans,
					eq(evaluationPlans.id, evaluationRounds.planId),
				)
				.where(eq(evaluationPlans.eventId, event.id));
			const roundIds = eventRounds.map((r) => r.id);
			const statements: BatchItem<"sqlite">[] = [
				db
					.delete(reviewerTracks)
					.where(
						and(
							eq(reviewerTracks.userId, userId),
							inArray(reviewerTracks.trackId, [...eventTrackIds]),
						),
					),
			];
			if (roundIds.length > 0) {
				statements.push(
					db
						.delete(roundEvaluators)
						.where(
							and(
								eq(roundEvaluators.userId, userId),
								inArray(roundEvaluators.roundId, roundIds),
							),
						),
					db
						.delete(evaluations)
						.where(
							and(
								eq(evaluations.evaluatorId, userId),
								inArray(evaluations.roundId, roundIds),
								eq(evaluations.status, "pending"),
							),
						),
				);
			}
			const [first, ...rest] = statements;
			if (first) await db.batch([first, ...rest]);
			track("reviewer.removed", { eventId: event.id, userId });
			return {
				intent,
				ok: "Reviewer removed — completed reviews were kept for the record.",
			};
		}

		if (intent === "assign") {
			const userId = String(form.get("userId") ?? "");
			const roundChoice = String(form.get("roundId") ?? "auto");
			const submissionIds = form.getAll("submissionIds").map(String);
			if (submissionIds.length === 0) {
				return { intent, formError: "Pick at least one submission." };
			}
			// The minted rows grant /reviews access — validate the principal
			// against the event's reviewer registry, never the raw form value.
			const registry = await listEventReviewers(db, event.id);
			if (!registry.some((r) => r.id === userId)) {
				return { intent, formError: "Reviewer not found." };
			}
			// Chunked: the multi-select can submit hundreds of ids — one inArray
			// over all of them would blow D1's bound-parameter cap.
			const valid = await fetchChunked(submissionIds, (chunk) =>
				db
					.select({ id: submissions.id })
					.from(submissions)
					.where(
						and(
							eq(submissions.eventId, event.id),
							inArray(submissions.id, chunk),
							notInArray(submissions.status, [...REVIEWABLE_EXCLUDED]),
						),
					),
			);
			if (valid.length !== submissionIds.length) {
				return {
					intent,
					formError: "Pick reviewable submissions from this event only.",
				};
			}
			let roundId: string;
			if (roundChoice === "auto") {
				roundId = await ensureQuickRound(db, event.id);
			} else {
				const [round] = await db
					.select({ id: evaluationRounds.id })
					.from(evaluationRounds)
					.innerJoin(
						evaluationPlans,
						eq(evaluationPlans.id, evaluationRounds.planId),
					)
					.where(
						and(
							eq(evaluationRounds.id, roundChoice),
							eq(evaluationPlans.eventId, event.id),
						),
					)
					.limit(1);
				if (!round) return { intent, formError: "Round not found." };
				roundId = round.id;
			}
			await db
				.insert(roundEvaluators)
				.values({ roundId, userId })
				.onConflictDoNothing();
			const minted = await mintEvaluations(
				db,
				roundId,
				submissionIds.map((submissionId) => ({
					submissionId,
					evaluatorId: userId,
				})),
			);
			track("evaluation.assigned", {
				eventId: event.id,
				roundId,
				userId,
				minted,
			});
			const skipped = submissionIds.length - minted;
			return {
				intent,
				ok: `Assigned ${minted} submission${minted === 1 ? "" : "s"}${skipped > 0 ? ` (${skipped} already assigned)` : ""}.`,
			};
		}
	} catch (error) {
		track("reviewer.action_failed", {
			eventId: event.id,
			intent,
			error: errorMessage(error),
		});
		return {
			intent,
			formError: "Something went wrong — please try again.",
		};
	}
	return { intent, formError: "Unknown action." };
}

export default function Reviewers({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { tracks: eventTracks, reviewers, rounds, assignable } = loaderData;
	const [selected, setSelected] = useState<{
		userId: string;
		mode: "tracks" | "assign" | "remove";
	} | null>(null);
	const [copiedId, setCopiedId] = useState<string | null>(null);
	const selectedReviewer = reviewers.find((r) => r.id === selected?.userId);
	const result = actionData ?? undefined;

	return (
		<div className="mx-auto flex max-w-6xl flex-col gap-5 px-7 py-6">
			<PageHeader
				title="Reviewers"
				count={`${reviewers.length} total`}
				subtitle="Reviewers route by track: they see submissions whose tracks overlap theirs, plus anything explicitly assigned in an evaluation plan. Invite links can be copied from the table — no inbox required."
			/>

			{result?.ok && <StatusBadge tone="success">{result.ok}</StatusBadge>}
			{result?.formError && <ErrorText>{result.formError}</ErrorText>}

			<Panel>
				{eventTracks.length === 0 ? (
					<EmptyState
						icon="sliders"
						title="No tracks yet"
						body="Reviewers route by track. Create tracks in Settings → Library first, then add reviewers here."
					/>
				) : (
					<Form method="post" className="flex flex-wrap items-end gap-3">
						<Input type="hidden" name="intent" value="add" />
						<Field
							label="Name"
							error={
								result?.intent === "add"
									? result.fieldErrors?.name?.[0]
									: undefined
							}
						>
							<Input name="name" placeholder="Rosa Delgado" />
						</Field>
						<Field
							label="Email"
							error={
								result?.intent === "add"
									? result.fieldErrors?.email?.[0]
									: undefined
							}
						>
							<Input name="email" placeholder="rosa@example.com" />
						</Field>
						<Field
							label="Tracks (hold Ctrl/Cmd to pick several)"
							error={
								result?.intent === "add"
									? result.fieldErrors?.trackIds?.[0]
									: undefined
							}
						>
							<Select
								name="trackIds"
								multiple
								size={Math.min(Math.max(eventTracks.length, 2), 4)}
							>
								{eventTracks.map((t) => (
									<option key={t.id} value={t.id}>
										{t.name}
									</option>
								))}
							</Select>
						</Field>
						<Button type="submit" icon="plus">
							Add reviewer
						</Button>
					</Form>
				)}
			</Panel>

			<Table>
				<THead>
					<Th>Reviewer</Th>
					<Th>Email</Th>
					<Th>Tracks</Th>
					<Th>Reviews</Th>
					<Th>Status</Th>
					<Th>Invite link</Th>
					<Th>Actions</Th>
				</THead>
				<TBody>
					{reviewers.map((r) => (
						<Tr key={r.id} selected={selected?.userId === r.id}>
							<Td kind="strong">{r.name ?? "—"}</Td>
							<Td kind="mono">{r.email}</Td>
							<Td>
								<div className="flex flex-wrap gap-3">
									{r.tracks.map((t) => (
										<Chip key={t.id} color={t.color}>
											{t.name}
										</Chip>
									))}
								</div>
							</Td>
							<Td kind="mono">
								{r.completed}/{r.assigned}
							</Td>
							<Td>
								{r.invited ? (
									<StatusBadge tone="info">Invited</StatusBadge>
								) : (
									<StatusBadge tone="success">Active</StatusBadge>
								)}
							</Td>
							<Td>
								{r.inviteLink ? (
									<div className="flex items-center gap-2">
										<Input
											readOnly
											value={r.inviteLink}
											size={28}
											aria-label={`Invite link for ${r.name ?? r.email}`}
											onFocus={(e) => e.currentTarget.select()}
										/>
										<Button
											type="button"
											variant="ghost"
											onClick={() => {
												void navigator.clipboard.writeText(r.inviteLink ?? "");
												setCopiedId(r.id);
											}}
										>
											{copiedId === r.id ? "Copied" : "Copy"}
										</Button>
									</div>
								) : (
									"—"
								)}
							</Td>
							<Td>
								<div className="flex gap-2">
									<Button
										type="button"
										variant="ghost"
										onClick={() =>
											setSelected({ userId: r.id, mode: "assign" })
										}
									>
										Assign
									</Button>
									<Button
										type="button"
										variant="ghost"
										onClick={() =>
											setSelected({ userId: r.id, mode: "tracks" })
										}
									>
										Tracks
									</Button>
									{r.invited && (
										<Form method="post">
											<Input type="hidden" name="intent" value="reinvite" />
											<Input type="hidden" name="userId" value={r.id} />
											<Button type="submit" variant="ghost">
												Re-invite
											</Button>
										</Form>
									)}
									<Button
										type="button"
										variant="ghost"
										onClick={() =>
											setSelected({ userId: r.id, mode: "remove" })
										}
									>
										Remove
									</Button>
								</div>
							</Td>
						</Tr>
					))}
					{reviewers.length === 0 && (
						<EmptyRow colSpan={7}>
							No reviewers yet — add one above and share their invite link so
							they can set a password and start reviewing.
						</EmptyRow>
					)}
				</TBody>
			</Table>

			{selected && selectedReviewer && (
				<Panel>
					{selected.mode === "tracks" && (
						<Form method="post" className="flex flex-wrap items-end gap-3">
							<Input type="hidden" name="intent" value="update-tracks" />
							<Input type="hidden" name="userId" value={selectedReviewer.id} />
							<Field
								label={`Tracks for ${selectedReviewer.name ?? selectedReviewer.email} (hold Ctrl/Cmd to pick several)`}
							>
								<Select
									name="trackIds"
									multiple
									size={Math.min(Math.max(eventTracks.length, 2), 4)}
									defaultValue={selectedReviewer.tracks.map((t) => t.id)}
								>
									{eventTracks.map((t) => (
										<option key={t.id} value={t.id}>
											{t.name}
										</option>
									))}
								</Select>
							</Field>
							<Button type="submit">Save tracks</Button>
							<Button
								type="button"
								variant="ghost"
								onClick={() => setSelected(null)}
							>
								Cancel
							</Button>
						</Form>
					)}
					{selected.mode === "assign" && (
						<Form method="post" className="flex flex-wrap items-end gap-3">
							<Input type="hidden" name="intent" value="assign" />
							<Input type="hidden" name="userId" value={selectedReviewer.id} />
							<Field label="Evaluation round">
								<Select name="roundId" defaultValue={rounds[0]?.id ?? "auto"}>
									{rounds.length === 0 && (
										<option value="auto">
											Quick review plan (created automatically)
										</option>
									)}
									{rounds.map((round) => (
										<option key={round.id} value={round.id}>
											{round.planName} · {round.name}
										</option>
									))}
								</Select>
							</Field>
							<Field
								label={`Submissions for ${selectedReviewer.name ?? selectedReviewer.email} (hold Ctrl/Cmd to pick several${assignable.length >= 500 ? "; showing the newest 500 — use the plan editor's Assignments tab for the full list" : ""})`}
							>
								<Select name="submissionIds" multiple size={8}>
									{assignable.map((s) => (
										<option key={s.id} value={s.id}>
											{s.title}
										</option>
									))}
								</Select>
							</Field>
							<Button type="submit">Assign</Button>
							<Button
								type="button"
								variant="ghost"
								onClick={() => setSelected(null)}
							>
								Cancel
							</Button>
						</Form>
					)}
					{selected.mode === "remove" && (
						<Form method="post" className="flex flex-wrap items-center gap-3">
							<Input type="hidden" name="intent" value="remove" />
							<Input type="hidden" name="userId" value={selectedReviewer.id} />
							<ErrorText>
								Remove {selectedReviewer.name ?? selectedReviewer.email} as a
								reviewer on this event? Pending assignments are deleted;
								completed reviews are kept for the record.
							</ErrorText>
							<Button type="submit" onClick={() => setSelected(null)}>
								Confirm removal
							</Button>
							<Button
								type="button"
								variant="ghost"
								onClick={() => setSelected(null)}
							>
								Cancel
							</Button>
						</Form>
					)}
				</Panel>
			)}
		</div>
	);
}

export function ErrorBoundary() {
	return (
		<div className="mx-auto max-w-6xl px-7 py-6">
			<PageHeader
				title="Failed to load reviewers"
				tone="danger"
				subtitle="Something went wrong. Please refresh or try again."
			/>
		</div>
	);
}
