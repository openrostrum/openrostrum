import { and, avg, count, eq, ne } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { useState } from "react";
import { data, Form } from "react-router";
import { z } from "zod";
import { getDb } from "~/db";
import {
	contacts,
	evaluationAnswers,
	evaluationPlans,
	evaluationRounds,
	evaluations,
	formats,
	levels,
	participants,
	REVIEW_DECISION,
	reviewerTracks,
	reviews,
	roundQuestions,
	submissions,
	submissionTags,
	submissionTracks,
	tags,
	tracks,
	users,
} from "~/db/schema";
import { requireRole } from "~/lib/auth";
import { errorMessage } from "~/lib/errors";
import {
	REVIEW_DECISION_TONE as DECISION_TONE,
	formatDay,
	roundWritable,
} from "~/lib/evaluation";
import { escapeHtmlText, stripHtml } from "~/lib/html";
import { createTimings, track } from "~/lib/track";
import { useBusy } from "~/lib/use-busy";
import { getEmailSender } from "~/ports/email";
import {
	Button,
	ButtonLink,
	Chip,
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
	THead,
	Th,
	Tr,
} from "~/ui";
import type { Route } from "./+types/reviews.$id";

// Both boxes land in nullable columns, so blank means null — decided here once
// instead of by every caller on the way in and out.
const decisionText = (label: string) =>
	z
		.string()
		.max(5000, `Keep the ${label} under 5,000 characters.`)
		.transform((text) => text.trim() || null);

// The decision tuple comes from the schema (single source of truth).
const Decision = z.object({
	decision: z.enum(REVIEW_DECISION),
	comment: decisionText("comment"),
	feedback: decisionText("feedback"),
});

/**
 * Access + shared context for both loader and action. A reviewer may open a
 * submission only when it is assigned to them (an `evaluations` row exists)
 * or routed to them by track overlap — anything else is 404, so URL guessing
 * can't browse the event (evaluators must never reach the admin-wide reads).
 */
async function requireReviewContext(
	env: Env,
	user: Awaited<ReturnType<typeof requireRole>>,
	submissionId: string,
) {
	const db = getDb(env);
	const [myEvaluations, overlapRows] = await Promise.all([
		db
			.select({
				id: evaluations.id,
				status: evaluations.status,
				abstainReason: evaluations.abstainReason,
				roundId: evaluationRounds.id,
				roundName: evaluationRounds.name,
				opensAt: evaluationRounds.opensAt,
				closesAt: evaluationRounds.closesAt,
				anonymized: evaluationRounds.anonymized,
				showOtherScores: evaluationRounds.showOtherScores,
				planName: evaluationPlans.name,
				planStatus: evaluationPlans.status,
				instructions: evaluationPlans.instructions,
			})
			.from(evaluations)
			.innerJoin(evaluationRounds, eq(evaluationRounds.id, evaluations.roundId))
			.innerJoin(
				evaluationPlans,
				eq(evaluationPlans.id, evaluationRounds.planId),
			)
			.where(
				and(
					eq(evaluations.evaluatorId, user.id),
					eq(evaluations.submissionId, submissionId),
				),
			),
		db
			.selectDistinct({ id: submissions.id })
			.from(submissions)
			.innerJoin(
				submissionTracks,
				eq(submissionTracks.submissionId, submissions.id),
			)
			.innerJoin(
				reviewerTracks,
				eq(reviewerTracks.trackId, submissionTracks.trackId),
			)
			.innerJoin(tracks, eq(tracks.id, reviewerTracks.trackId))
			.where(
				and(
					eq(submissions.id, submissionId),
					eq(reviewerTracks.userId, user.id),
					eq(tracks.eventId, submissions.eventId),
				),
			),
	]);
	const canDecide = overlapRows.length > 0;
	if (myEvaluations.length === 0 && !canDecide) {
		throw new Response("Not found", { status: 404 });
	}
	// Blind review wins over track routing: if ANY of this reviewer's
	// assignments on the submission sits in an anonymized round, identity is
	// masked everywhere on this page (a per-section mask would defeat the round).
	const anonymized = myEvaluations.some((e) => e.anonymized);
	return { user, db, myEvaluations, canDecide, anonymized };
}

export function headers({ loaderHeaders }: Route.HeadersArgs) {
	return loaderHeaders;
}

export async function loader({ context, request, params }: Route.LoaderArgs) {
	const env = context.cloudflare.env;
	const user = await requireRole(env, request, "reviewer", "admin");
	const { db, myEvaluations, canDecide, anonymized } =
		await requireReviewContext(env, user, params.id);
	const timings = createTimings();

	const [subRows, trackRows, tagRows] = await timings.time("db", () =>
		Promise.all([
			db
				.select({
					id: submissions.id,
					title: submissions.title,
					description: submissions.description,
					language: submissions.language,
					formatName: formats.name,
					levelName: levels.name,
				})
				.from(submissions)
				.leftJoin(formats, eq(formats.id, submissions.formatId))
				.leftJoin(levels, eq(levels.id, submissions.levelId))
				.where(eq(submissions.id, params.id))
				.limit(1),
			db
				.select({ name: tracks.name, color: tracks.color })
				.from(submissionTracks)
				.innerJoin(tracks, eq(tracks.id, submissionTracks.trackId))
				.where(eq(submissionTracks.submissionId, params.id)),
			db
				.select({ name: tags.name })
				.from(submissionTags)
				.innerJoin(tags, eq(tags.id, submissionTags.tagId))
				.where(eq(submissionTags.submissionId, params.id)),
		]),
	);
	const sub = subRows[0];
	if (!sub) throw new Response("Not found", { status: 404 });

	// Identity ships ONLY when no anonymized round covers this reviewer —
	// the mask is a server-side projection, never a hidden client field.
	// Emails/phones are never sent to reviewers even unmasked.
	let identity: {
		participants: Array<{
			name: string;
			role: string;
			jobTitle: string | null;
			companyName: string | null;
		}>;
		submitter: string | null;
	} | null = null;
	if (!anonymized) {
		const [people, submitterRows] = await timings.time("db-identity", () =>
			Promise.all([
				db
					.select({
						firstName: contacts.firstName,
						lastName: contacts.lastName,
						role: participants.role,
						jobTitle: contacts.jobTitle,
						companyName: contacts.companyName,
					})
					.from(participants)
					.innerJoin(contacts, eq(contacts.id, participants.contactId))
					.where(eq(participants.submissionId, params.id))
					.orderBy(participants.position),
				db
					.select({ name: users.name })
					.from(users)
					.innerJoin(submissions, eq(submissions.submitterId, users.id))
					.where(eq(submissions.id, params.id))
					.limit(1),
			]),
		);
		identity = {
			participants: people.map((p) => ({
				name: `${p.firstName} ${p.lastName}`,
				role: p.role,
				jobTitle: p.jobTitle,
				companyName: p.companyName,
			})),
			submitter: submitterRows[0]?.name ?? null,
		};
	}

	const scorecards = await timings.time("db-scorecards", () =>
		Promise.all(
			myEvaluations.map(async (evaluation) => {
				const [questions, myAnswers] = await Promise.all([
					db
						.select()
						.from(roundQuestions)
						.where(eq(roundQuestions.roundId, evaluation.roundId))
						.orderBy(roundQuestions.position),
					db
						.select({
							questionId: evaluationAnswers.questionId,
							valueNumber: evaluationAnswers.valueNumber,
							valueText: evaluationAnswers.valueText,
						})
						.from(evaluationAnswers)
						.where(eq(evaluationAnswers.evaluationId, evaluation.id)),
				]);
				// "Show scores from other evaluators": averages of OTHER completed
				// reviews' rating answers — scores only, never comments, never
				// evaluator identities.
				let others: Array<{
					questionId: string;
					average: number;
					reviewers: number;
				}> = [];
				if (evaluation.showOtherScores) {
					const rows = await db
						.select({
							questionId: evaluationAnswers.questionId,
							average: avg(evaluationAnswers.valueNumber),
							reviewers: count(),
						})
						.from(evaluationAnswers)
						.innerJoin(
							evaluations,
							eq(evaluations.id, evaluationAnswers.evaluationId),
						)
						.where(
							and(
								eq(evaluations.roundId, evaluation.roundId),
								eq(evaluations.submissionId, params.id),
								eq(evaluations.status, "completed"),
								ne(evaluations.evaluatorId, user.id),
							),
						)
						.groupBy(evaluationAnswers.questionId);
					others = rows.flatMap((r) =>
						r.average == null
							? []
							: [
									{
										questionId: r.questionId,
										average: Math.round(Number(r.average) * 10) / 10,
										reviewers: r.reviewers,
									},
								],
					);
				}
				const writable = roundWritable(evaluation, evaluation.planStatus);
				return {
					id: evaluation.id,
					status: evaluation.status,
					abstainReason: evaluation.abstainReason,
					roundName: evaluation.roundName,
					planName: evaluation.planName,
					instructions: evaluation.instructions,
					window: `${formatDay(evaluation.opensAt)} – ${formatDay(evaluation.closesAt)}`,
					writable: writable.writable,
					lockReason: writable.reason,
					questions: questions.map((q) => {
						const mine = myAnswers.find((a) => a.questionId === q.id);
						return {
							id: q.id,
							label: q.label,
							type: q.type,
							min: q.config?.min ?? 1,
							max: q.config?.max ?? 5,
							options: q.config?.options ?? [],
							weight: q.weight,
							required: q.required,
							myNumber: mine?.valueNumber ?? null,
							myText: mine?.valueText ?? null,
							others: others.find((o) => o.questionId === q.id) ?? null,
						};
					}),
				};
			}),
		),
	);

	let decision: { decision: string; comment: string | null } | null = null;
	if (canDecide) {
		const [row] = await db
			.select({ decision: reviews.decision, comment: reviews.comment })
			.from(reviews)
			.where(
				and(
					eq(reviews.submissionId, params.id),
					eq(reviews.reviewerId, user.id),
				),
			)
			.limit(1);
		decision = row ?? null;
	}

	return data(
		{
			submission: {
				id: sub.id,
				title: sub.title,
				description: stripHtml(sub.description),
				language: sub.language,
				formatName: sub.formatName,
				levelName: sub.levelName,
				tracks: trackRows,
				tags: tagRows.map((t) => t.name),
			},
			anonymized,
			identity,
			scorecards,
			canDecide,
			decision,
		},
		{ headers: { "Server-Timing": timings.header() } },
	);
}

export async function action({ context, request, params }: Route.ActionArgs) {
	const env = context.cloudflare.env;
	const user = await requireRole(env, request, "reviewer", "admin");
	const { db, myEvaluations, canDecide } = await requireReviewContext(
		env,
		user,
		params.id,
	);
	const form = await request.formData();
	const intent = String(form.get("intent") ?? "");

	try {
		if (intent === "save-eval" || intent === "abstain" || intent === "resume") {
			const evaluationId = String(form.get("evaluationId") ?? "");
			const evaluation = myEvaluations.find((e) => e.id === evaluationId);
			if (!evaluation) throw new Response("Not found", { status: 404 });
			const writable = roundWritable(evaluation, evaluation.planStatus);
			if (!writable.writable) {
				return {
					intent,
					evaluationId,
					formError:
						writable.reason === "not-open"
							? "This round hasn't opened yet."
							: "This round is closed — reviews are locked and can no longer be changed.",
				};
			}

			if (intent === "abstain") {
				const reason = String(form.get("reason") ?? "").trim();
				await db
					.update(evaluations)
					.set({
						status: "abstained",
						abstainReason: reason || null,
						submittedAt: new Date(),
					})
					.where(eq(evaluations.id, evaluationId));
				track("evaluation.abstained", {
					submissionId: params.id,
					evaluationId,
				});
				return {
					intent,
					evaluationId,
					ok: "You abstained from this review — your administrator can see the recusal.",
				};
			}

			if (intent === "resume") {
				await db
					.update(evaluations)
					.set({ status: "pending", abstainReason: null, submittedAt: null })
					.where(eq(evaluations.id, evaluationId));
				track("evaluation.resumed", {
					submissionId: params.id,
					evaluationId,
				});
				return { intent, evaluationId, ok: "Review reopened." };
			}

			// save-eval
			const questions = await db
				.select()
				.from(roundQuestions)
				.where(eq(roundQuestions.roundId, evaluation.roundId));
			const fieldErrors: Record<string, string[]> = {};
			const answers: Array<{
				questionId: string;
				valueNumber: number | null;
				valueText: string | null;
			}> = [];
			const cleared: string[] = [];
			for (const q of questions) {
				const raw = String(form.get(`q_${q.id}`) ?? "").trim();
				if (!raw) {
					if (q.required) {
						fieldErrors[`q_${q.id}`] = ["This question is required"];
					} else {
						cleared.push(q.id);
					}
					continue;
				}
				if (q.type === "rating") {
					const min = q.config?.min ?? 1;
					const max = q.config?.max ?? 5;
					const n = Number(raw);
					if (!Number.isInteger(n) || n < min || n > max) {
						fieldErrors[`q_${q.id}`] = [
							`Pick a value between ${min} and ${max}`,
						];
					} else {
						answers.push({ questionId: q.id, valueNumber: n, valueText: null });
					}
				} else if (q.type === "dropdown") {
					if (!(q.config?.options ?? []).includes(raw)) {
						fieldErrors[`q_${q.id}`] = ["Pick one of the listed choices"];
					} else {
						answers.push({
							questionId: q.id,
							valueNumber: null,
							valueText: raw,
						});
					}
				} else {
					if (raw.length > 5000) {
						fieldErrors[`q_${q.id}`] = ["Keep it under 5,000 characters"];
					} else {
						answers.push({
							questionId: q.id,
							valueNumber: null,
							valueText: raw,
						});
					}
				}
			}
			if (Object.keys(fieldErrors).length > 0) {
				return { intent, evaluationId, fieldErrors };
			}
			const statements: BatchItem<"sqlite">[] = [
				...answers.map((a) =>
					db
						.insert(evaluationAnswers)
						.values({ evaluationId, ...a })
						.onConflictDoUpdate({
							target: [
								evaluationAnswers.evaluationId,
								evaluationAnswers.questionId,
							],
							set: { valueNumber: a.valueNumber, valueText: a.valueText },
						}),
				),
				...cleared.map((questionId) =>
					db
						.delete(evaluationAnswers)
						.where(
							and(
								eq(evaluationAnswers.evaluationId, evaluationId),
								eq(evaluationAnswers.questionId, questionId),
							),
						),
				),
				db
					.update(evaluations)
					.set({
						status: "completed",
						abstainReason: null,
						submittedAt: new Date(),
					})
					.where(eq(evaluations.id, evaluationId)),
			];
			const [first, ...rest] = statements;
			if (first) await db.batch([first, ...rest]);
			track("evaluation.saved", { submissionId: params.id, evaluationId });
			return {
				intent,
				evaluationId,
				ok: "Review saved — you can edit it until the round closes.",
			};
		}

		if (intent === "decide") {
			if (!canDecide) throw new Response("Forbidden", { status: 403 });
			const parsed = Decision.safeParse({
				decision: form.get("decision"),
				comment: String(form.get("comment") ?? ""),
				feedback: String(form.get("feedback") ?? ""),
			});
			if (!parsed.success) {
				const flat = z.flattenError(parsed.error).fieldErrors;
				return {
					intent,
					formError:
						flat.comment?.[0] ??
						flat.feedback?.[0] ??
						"Pick approve, maybe, or deny before saving.",
				};
			}
			await db
				.insert(reviews)
				.values({
					submissionId: params.id,
					reviewerId: user.id,
					decision: parsed.data.decision,
					comment: parsed.data.comment,
				})
				.onConflictDoUpdate({
					target: [reviews.submissionId, reviews.reviewerId],
					set: {
						decision: parsed.data.decision,
						comment: parsed.data.comment,
					},
				});
			track("review.decided", {
				submissionId: params.id,
				decision: parsed.data.decision,
			});

			const feedback = parsed.data.feedback;
			if (feedback) {
				// Recipient = the submitter's account email, falling back to the
				// primary speaker contact. The mail never names the reviewer —
				// reviewer identities stay anonymous to speakers.
				const [subRow] = await db
					.select({
						title: submissions.title,
						eventId: submissions.eventId,
						submitterEmail: users.email,
					})
					.from(submissions)
					.leftJoin(users, eq(users.id, submissions.submitterId))
					.where(eq(submissions.id, params.id))
					.limit(1);
				let to = subRow?.submitterEmail ?? null;
				if (!to) {
					const [primary] = await db
						.select({ email: contacts.email })
						.from(participants)
						.innerJoin(contacts, eq(contacts.id, participants.contactId))
						.where(eq(participants.submissionId, params.id))
						.orderBy(participants.position)
						.limit(1);
					to = primary?.email ?? null;
				}
				if (!to) {
					return {
						intent,
						ok: "Decision saved.",
						formError:
							"Feedback was NOT sent — this submission has no submitter email on file.",
					};
				}
				// Content-keyed dedupe: an identical double-submit sends once, a
				// later DIFFERENT feedback to the same speaker still goes out.
				const digest = await crypto.subtle.digest(
					"SHA-256",
					new TextEncoder().encode(feedback),
				);
				const feedbackHash = [...new Uint8Array(digest)]
					.slice(0, 8)
					.map((b) => b.toString(16).padStart(2, "0"))
					.join("");
				await getEmailSender(env).send({
					to,
					subject: `Feedback on your submission: ${subRow?.title ?? "your talk"}`,
					html: `<p>${escapeHtmlText(feedback)}</p><p>— The review team</p>`,
					dedupeKey: `review_feedback:${params.id}:${user.id}:${feedbackHash}`,
					eventId: subRow?.eventId,
				});
				track("review.feedback_sent", { submissionId: params.id });
				return {
					intent,
					ok: "Decision saved and your feedback was emailed to the speaker.",
				};
			}
			return { intent, ok: "Decision saved." };
		}
	} catch (error) {
		if (error instanceof Response) throw error;
		track("review.action_failed", {
			submissionId: params.id,
			intent,
			error: errorMessage(error),
		});
		return { intent, formError: "Something went wrong — please try again." };
	}
	return { intent, formError: "Unknown action." };
}

export default function ReviewSubmission({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { submission, anonymized, identity, scorecards, canDecide, decision } =
		loaderData;
	return (
		<div className="mx-auto flex max-w-6xl flex-col gap-5 px-7 py-6">
			<PageHeader
				title={submission.title}
				count={submission.formatName ?? undefined}
				subtitle="Score the submission with the round's scorecard. Your review stays editable until the round closes."
				actions={
					<ButtonLink to="/reviews" variant="ghost">
						Back to My Reviews
					</ButtonLink>
				}
			/>
			<div className="flex flex-wrap items-start gap-5">
				<div className="flex min-w-[320px] max-w-[560px] flex-1 flex-col gap-4">
					<Panel>
						<div className="flex flex-col gap-4">
							<Field label="Description">
								<p className="whitespace-pre-wrap">
									{submission.description || "No description provided."}
								</p>
							</Field>
							<div className="flex flex-wrap gap-6">
								<Field label="Format">
									<p>{submission.formatName ?? "—"}</p>
								</Field>
								<Field label="Level">
									<p>{submission.levelName ?? "—"}</p>
								</Field>
								<Field label="Language">
									<p>{submission.language}</p>
								</Field>
								<Field label="Tags">
									<p>
										{submission.tags.length > 0
											? submission.tags.join(", ")
											: "—"}
									</p>
								</Field>
							</div>
							<Field label="Tracks">
								<div className="flex min-h-[20px] flex-wrap gap-3">
									{submission.tracks.map((t) => (
										<Chip key={t.name} color={t.color}>
											{t.name}
										</Chip>
									))}
									{submission.tracks.length === 0 && <p>—</p>}
								</div>
							</Field>
						</div>
					</Panel>
					<Panel>
						{anonymized ? (
							<StatusBadge tone="neutral">
								Anonymized review — participant identity is hidden for this
								round
							</StatusBadge>
						) : identity ? (
							<div className="flex flex-col gap-3">
								{identity.submitter && (
									<Field label="Submitted by">
										<p>{identity.submitter}</p>
									</Field>
								)}
								<Table>
									<THead>
										<Th>Participant</Th>
										<Th>Role</Th>
										<Th>Title</Th>
										<Th>Company</Th>
									</THead>
									<TBody>
										{identity.participants.map((p) => (
											<Tr key={`${p.name}-${p.role}`}>
												<Td kind="strong">{p.name}</Td>
												<Td>{p.role}</Td>
												<Td>{p.jobTitle ?? "—"}</Td>
												<Td>{p.companyName ?? "—"}</Td>
											</Tr>
										))}
										{identity.participants.length === 0 && (
											<Tr>
												<Td>—</Td>
												<Td>—</Td>
												<Td>—</Td>
												<Td>—</Td>
											</Tr>
										)}
									</TBody>
								</Table>
							</div>
						) : null}
					</Panel>
				</div>

				<div className="flex min-w-[360px] flex-1 flex-col gap-4">
					{scorecards.map((card) => (
						<Scorecard key={card.id} card={card} actionData={actionData} />
					))}
					{scorecards.length === 0 && (
						<Panel>
							<StatusBadge tone="faint">
								No scorecard assigned — this submission reached you through
								track routing only.
							</StatusBadge>
						</Panel>
					)}
					{canDecide && (
						<DecisionPanel decision={decision} actionData={actionData} />
					)}
				</div>
			</div>
		</div>
	);
}

type CardData = {
	id: string;
	status: string;
	abstainReason: string | null;
	roundName: string;
	planName: string;
	instructions: string;
	window: string;
	writable: boolean;
	lockReason: string;
	questions: Array<{
		id: string;
		label: string;
		type: "rating" | "dropdown" | "text";
		min: number;
		max: number;
		options: string[];
		weight: number;
		required: boolean;
		myNumber: number | null;
		myText: string | null;
		others: { average: number; reviewers: number } | null;
	}>;
};

type CardActionData =
	| {
			intent?: string;
			evaluationId?: string;
			ok?: string;
			formError?: string;
			fieldErrors?: Record<string, string[]>;
	  }
	| undefined;

function Scorecard({
	card,
	actionData,
}: {
	card: CardData;
	actionData: CardActionData;
}) {
	const busy = useBusy();
	const [abstaining, setAbstaining] = useState(false);
	const mine = actionData?.evaluationId === card.id ? actionData : undefined;
	const locked = !card.writable;
	return (
		<Panel>
			<div className="flex flex-col gap-4">
				<PageHeader
					title={card.roundName}
					count={card.planName}
					subtitle={
						<>
							{card.window}
							{card.instructions ? ` — ${card.instructions}` : ""}
						</>
					}
				/>
				{card.status === "completed" && (
					<StatusBadge tone="success">
						Review submitted{locked ? "" : " — you can still edit it"}
					</StatusBadge>
				)}
				{card.status === "abstained" && (
					<StatusBadge tone="caution">
						Abstained (conflict of interest)
						{card.abstainReason ? ` — ${card.abstainReason}` : ""}
					</StatusBadge>
				)}
				{locked && (
					<StatusBadge tone="neutral">
						{card.lockReason === "not-open"
							? "This round hasn't opened yet"
							: "Round closed — review locked"}
					</StatusBadge>
				)}
				{mine?.ok && <StatusBadge tone="success">{mine.ok}</StatusBadge>}
				{mine?.formError && <ErrorText>{mine.formError}</ErrorText>}

				{card.status !== "abstained" && (
					<Form method="post" className="flex flex-col gap-3">
						<Input type="hidden" name="intent" value="save-eval" />
						<Input type="hidden" name="evaluationId" value={card.id} />
						{card.questions.map((q) => (
							<Field
								key={q.id}
								label={`${q.label}${q.required ? " *" : ""}${q.weight !== 1 ? ` · weight ${q.weight}` : ""}`}
								error={mine?.fieldErrors?.[`q_${q.id}`]?.[0]}
							>
								{q.type === "rating" ? (
									<Select
										name={`q_${q.id}`}
										defaultValue={q.myNumber == null ? "" : String(q.myNumber)}
										disabled={locked}
									>
										<option value="">—</option>
										{Array.from(
											{ length: q.max - q.min + 1 },
											(_, i) => q.min + i,
										).map((n) => (
											<option key={n} value={n}>
												{n}
											</option>
										))}
									</Select>
								) : q.type === "dropdown" ? (
									<Select
										name={`q_${q.id}`}
										defaultValue={q.myText ?? ""}
										disabled={locked}
									>
										<option value="">—</option>
										{q.options.map((option) => (
											<option key={option} value={option}>
												{option}
											</option>
										))}
									</Select>
								) : (
									<Input
										name={`q_${q.id}`}
										defaultValue={q.myText ?? ""}
										disabled={locked}
										size={40}
									/>
								)}
								{q.others && (
									<StatusBadge tone="faint">
										Other evaluators: avg {q.others.average} ·{" "}
										{q.others.reviewers} review
										{q.others.reviewers === 1 ? "" : "s"}
									</StatusBadge>
								)}
							</Field>
						))}
						{!locked && (
							<div className="flex items-center gap-3">
								<Button type="submit" disabled={busy || locked}>
									{card.status === "completed"
										? "Update review"
										: "Save review"}
								</Button>
							</div>
						)}
					</Form>
				)}

				{!locked && card.status !== "abstained" && !abstaining && (
					<Button
						type="button"
						variant="ghost"
						onClick={() => setAbstaining(true)}
					>
						Conflict of interest — abstain from this review
					</Button>
				)}
				{!locked && card.status !== "abstained" && abstaining && (
					<Form method="post" className="flex flex-wrap items-end gap-3">
						<Input type="hidden" name="intent" value="abstain" />
						<Input type="hidden" name="evaluationId" value={card.id} />
						<Field label="Reason (optional — shared with the organizer)">
							<Input name="reason" size={32} />
						</Field>
						<Button
							type="submit"
							disabled={busy || locked}
							onClick={() => setAbstaining(false)}
						>
							Confirm abstain
						</Button>
						<Button
							type="button"
							variant="ghost"
							onClick={() => setAbstaining(false)}
						>
							Cancel
						</Button>
					</Form>
				)}
				{!locked && card.status === "abstained" && (
					<Form method="post">
						<Input type="hidden" name="intent" value="resume" />
						<Input type="hidden" name="evaluationId" value={card.id} />
						<Button type="submit" variant="ghost" disabled={busy || locked}>
							Undo — resume this review
						</Button>
					</Form>
				)}
			</div>
		</Panel>
	);
}

function DecisionPanel({
	decision,
	actionData,
}: {
	decision: { decision: string; comment: string | null } | null;
	actionData: CardActionData;
}) {
	const busy = useBusy();
	const mine = actionData?.intent === "decide" ? actionData : undefined;
	return (
		<Panel>
			<div className="flex flex-col gap-4">
				<PageHeader
					title="Your decision"
					count="track routing"
					subtitle="Approve, maybe, or deny — the organizer sees the tally across reviewers and makes the final call. Optionally email feedback to the speaker; it is sent anonymously, from the review team."
				/>
				{decision && (
					<StatusBadge tone={DECISION_TONE[decision.decision] ?? "neutral"}>
						Current decision: {decision.decision}
					</StatusBadge>
				)}
				{mine?.ok && <StatusBadge tone="success">{mine.ok}</StatusBadge>}
				{mine?.formError && <ErrorText>{mine.formError}</ErrorText>}
				<Form method="post" className="flex flex-col gap-3">
					<Input type="hidden" name="intent" value="decide" />
					<Field label="Decision *">
						<Select name="decision" defaultValue={decision?.decision ?? ""}>
							<option value="">—</option>
							<option value="approve">Approve</option>
							<option value="maybe">Maybe</option>
							<option value="deny">Deny</option>
						</Select>
					</Field>
					<Field label="Comment for the organizers (optional)">
						<Input
							name="comment"
							defaultValue={decision?.comment ?? ""}
							size={40}
						/>
					</Field>
					<Field label="Email feedback to the speaker (optional — sends only when filled)">
						<Input name="feedback" size={40} />
					</Field>
					<div className="flex items-center gap-3">
						<Button type="submit" disabled={busy}>
							Save decision
						</Button>
					</div>
				</Form>
			</div>
		</Panel>
	);
}

export function ErrorBoundary() {
	return (
		<div className="mx-auto max-w-6xl px-7 py-6">
			<PageHeader
				title="Submission unavailable"
				tone="danger"
				subtitle="This submission isn't in your queue. Head back to My Reviews."
			/>
			<ButtonLink to="/reviews" variant="ghost">
				Back to My Reviews
			</ButtonLink>
		</div>
	);
}
