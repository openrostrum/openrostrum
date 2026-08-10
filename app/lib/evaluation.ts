/**
 * Pure evaluation logic shared by the admin plan editor, the reviewer surface,
 * and the CSV export. No DB access here — routes fetch, this computes — so the
 * scoring/distribution contracts are unit-testable against fixed fixtures.
 */

import type { BadgeTone } from "~/ui";

/**
 * Statuses that are never reviewable: drafts are private to their submitter
 * and withdrawn submissions were pulled by the speaker. Single-sourced so the
 * admin assignment scope and both reviewer queues can never disagree.
 */
export const REVIEWABLE_EXCLUDED = ["draft", "withdrawn"] as const;

export const REVIEW_PAGE_SIZE = 25;

export const EVAL_STATUS_TONE: Record<string, BadgeTone> = {
	pending: "warning",
	completed: "success",
	abstained: "caution",
};

export const REVIEW_DECISION_TONE: Record<string, BadgeTone> = {
	approve: "success",
	maybe: "warning",
	deny: "danger",
};

/**
 * Run an id-list query in slices so no statement exceeds D1's ~100
 * bound-parameter cap — every `inArray` over an unbounded id list must go
 * through this.
 */
export async function fetchChunked<T>(
	ids: readonly string[],
	fetchSlice: (chunk: string[]) => Promise<T[]>,
	chunkSize = 80,
): Promise<T[]> {
	const out: T[] = [];
	for (let i = 0; i < ids.length; i += chunkSize) {
		out.push(...(await fetchSlice(ids.slice(i, i + chunkSize))));
	}
	return out;
}

export type ScoreQuestion = {
	id: string;
	type: "rating" | "dropdown" | "text";
	weight: number;
};

export type ScoreAnswer = {
	questionId: string;
	valueNumber: number | null;
};

/**
 * Weighted score of ONE evaluation = Σ(value×weight) / Σ(weight) over the
 * RATING questions that were answered (dropdown/text never enter the number;
 * unanswered optional ratings drop out of both sums). Returns null when no
 * rating was answered. Weight 2 on "Originality" therefore counts that rating
 * twice: ratings 4 (w2) and 2 (w1) aggregate to 10/3 ≈ 3.33, not 3.0.
 */
export function evaluationScore(
	questions: readonly ScoreQuestion[],
	answers: readonly ScoreAnswer[],
): number | null {
	const byQuestion = new Map(answers.map((a) => [a.questionId, a]));
	let weighted = 0;
	let totalWeight = 0;
	for (const q of questions) {
		if (q.type !== "rating" || q.weight <= 0) continue;
		const value = byQuestion.get(q.id)?.valueNumber;
		if (value == null) continue;
		weighted += value * q.weight;
		totalWeight += q.weight;
	}
	return totalWeight > 0 ? weighted / totalWeight : null;
}

/** Submission aggregate = plain mean of its evaluations' weighted scores. */
export function meanScore(scores: readonly number[]): number | null {
	if (scores.length === 0) return null;
	return scores.reduce((a, b) => a + b, 0) / scores.length;
}

export function formatScore(score: number | null): string {
	return score == null ? "—" : (Math.round(score * 100) / 100).toFixed(2);
}

export type AssignmentPair = { submissionId: string; evaluatorId: string };

/**
 * Deterministic assignment distribution. Each submission is offered to the
 * least-loaded eligible evaluators first (ties broken by input order), so
 * workloads stay balanced without randomness:
 *   - `reviewersPerSubmission` null → every evaluator gets every submission
 *     (Sessionboard's documented no-caps behavior). When set, it is a TARGET
 *     counting reviewers the submission already has — re-running the same
 *     distribution is a no-op, never a doubling.
 *   - `maxPerEvaluator` caps an evaluator's TOTAL load (existing + new); when
 *     everyone is at cap a submission simply receives fewer reviewers.
 * Pairs that already exist are never re-minted.
 */
export function distributeAssignments(opts: {
	submissionIds: readonly string[];
	evaluatorIds: readonly string[];
	existing: readonly AssignmentPair[];
	reviewersPerSubmission?: number | null;
	maxPerEvaluator?: number | null;
}): AssignmentPair[] {
	const load = new Map<string, number>();
	for (const id of opts.evaluatorIds) load.set(id, 0);
	const existingKeys = new Set<string>();
	const perSubmission = new Map<string, number>();
	for (const pair of opts.existing) {
		existingKeys.add(`${pair.submissionId} ${pair.evaluatorId}`);
		perSubmission.set(
			pair.submissionId,
			(perSubmission.get(pair.submissionId) ?? 0) + 1,
		);
		if (load.has(pair.evaluatorId)) {
			load.set(pair.evaluatorId, (load.get(pair.evaluatorId) ?? 0) + 1);
		}
	}
	const order = new Map(opts.evaluatorIds.map((id, i) => [id, i]));
	const minted: AssignmentPair[] = [];
	for (const submissionId of opts.submissionIds) {
		const candidates = opts.evaluatorIds
			.filter((evaluatorId) => {
				if (existingKeys.has(`${submissionId} ${evaluatorId}`)) return false;
				const cap = opts.maxPerEvaluator;
				return cap == null || (load.get(evaluatorId) ?? 0) < cap;
			})
			.sort(
				(a, b) =>
					(load.get(a) ?? 0) - (load.get(b) ?? 0) ||
					(order.get(a) ?? 0) - (order.get(b) ?? 0),
			);
		const take =
			opts.reviewersPerSubmission == null
				? candidates.length
				: Math.min(
						Math.max(
							opts.reviewersPerSubmission -
								(perSubmission.get(submissionId) ?? 0),
							0,
						),
						candidates.length,
					);
		for (const evaluatorId of candidates.slice(0, take)) {
			minted.push({ submissionId, evaluatorId });
			existingKeys.add(`${submissionId} ${evaluatorId}`);
			perSubmission.set(
				submissionId,
				(perSubmission.get(submissionId) ?? 0) + 1,
			);
			load.set(evaluatorId, (load.get(evaluatorId) ?? 0) + 1);
		}
	}
	return minted;
}

/**
 * Round write-window. "Closes" dates are date-only and INCLUSIVE: reviewers
 * can submit through the whole close day (UTC), matching how organizers read
 * "closes Oct 15". A closed plan locks every round regardless of dates.
 */
export function roundWritable(
	round: { opensAt: Date | null; closesAt: Date | null },
	planStatus: "open" | "closed",
	now: Date = new Date(),
): {
	writable: boolean;
	reason: "open" | "plan-closed" | "not-open" | "closed";
} {
	if (planStatus === "closed")
		return { writable: false, reason: "plan-closed" };
	if (round.opensAt && now.getTime() < startOfUtcDay(round.opensAt))
		return { writable: false, reason: "not-open" };
	if (round.closesAt && now.getTime() > endOfUtcDay(round.closesAt))
		return { writable: false, reason: "closed" };
	return { writable: true, reason: "open" };
}

function startOfUtcDay(d: Date): number {
	return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function endOfUtcDay(d: Date): number {
	return startOfUtcDay(d) + 24 * 60 * 60 * 1000 - 1;
}

/** yyyy-mm-dd (UTC) — the daily window key for reminder dedupe. */
export function utcDayKey(now: Date = new Date()): string {
	return now.toISOString().slice(0, 10);
}

export function formatDay(d: Date | null | undefined): string {
	if (!d) return "—";
	return d.toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
		timeZone: "UTC",
	});
}

/** Value for an <input type="date"> from a stored date (UTC calendar day). */
export function dateInputValue(d: Date | null | undefined): string {
	return d ? d.toISOString().slice(0, 10) : "";
}

/** Parse an <input type="date"> value ("2026-10-15") as a UTC calendar day. */
export function parseDateInput(value: string | null | undefined): Date | null {
	if (!value) return null;
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
	if (!match) return null;
	const parsed = new Date(`${value}T00:00:00.000Z`);
	return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/* ------------------------------------------------------------------- CSV --- */

export function csvCell(value: unknown): string {
	const s = value == null ? "" : String(value);
	return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export function toCsv(rows: readonly (readonly unknown[])[]): string {
	return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}
