/**
 * The review lane's shared vocabulary: scoring/distribution math (pure and
 * unit-tested against fixed fixtures), the constants both surfaces must agree
 * on (reviewable statuses, page size, badge tones), date/lock helpers, and
 * the chunk helper that keeps id-list queries under D1's parameter cap.
 */

import { z } from "zod";
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
 * unanswered optional ratings drop out of BOTH sums), or null when nothing was
 * rated. Weight 2 doubles a rating: 4 (w2) and 2 (w1) give 10/3 ≈ 3.33, not 3.
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

/** The product convention for every numeric scale. Organizer labels must follow it. */
export const RATING_DIRECTION = "Higher is better";

export type RatingAnchor = { value: number; label: string };

/** Shape stored on `round_questions.config` — labels ride along in the JSON blob. */
export type StoredQuestionConfig = {
	min?: number;
	max?: number;
	options?: string[];
};

const RatingConfigBlob = z.object({
	min: z.number().int().optional(),
	max: z.number().int().optional(),
	labels: z.record(z.string(), z.string()).optional(),
});

export function parseRatingConfig(raw: unknown): {
	min: number;
	max: number;
	labels: Record<string, string>;
} {
	const parsed = RatingConfigBlob.safeParse(raw ?? {});
	const min = parsed.success ? (parsed.data.min ?? 1) : 1;
	const max = parsed.success ? (parsed.data.max ?? 5) : 5;
	const lo = Math.min(min, max);
	const hi = Math.max(min, max);
	const labels: Record<string, string> = {};
	if (parsed.success) {
		for (const [key, value] of Object.entries(parsed.data.labels ?? {})) {
			const text = value.trim();
			if (text) labels[key] = text;
		}
	}
	return { min: lo, max: hi, labels };
}

function defaultAnchorLabel(value: number, min: number, max: number): string {
	if (value === min) return "Weak — does not meet the bar";
	if (value === max) return "Outstanding — a standout talk";
	const mid = Math.round((min + max) / 2);
	if (value === mid) return "Meets the bar";
	const t = (value - min) / (max - min);
	return t < 0.5 ? "Below the bar" : "Strong";
}

/** Every point on the scale, organizer label if present, otherwise the built-in. */
export function ratingAnchors(raw: unknown): RatingAnchor[] {
	const { min, max, labels } = parseRatingConfig(raw);
	const anchors: RatingAnchor[] = [];
	for (let value = min; value <= max; value++) {
		anchors.push({
			value,
			label: labels[String(value)] || defaultAnchorLabel(value, min, max),
		});
	}
	return anchors;
}

/** Ends + middle for a long scale; every point when there are five or fewer. */
export function ratingLegend(anchors: readonly RatingAnchor[]): string {
	if (anchors.length === 0) return "";
	if (anchors.length <= 5) {
		return anchors
			.map((anchor) => `${anchor.value} ${anchor.label}`)
			.join(" · ");
	}
	const first = anchors[0];
	const middle = anchors[Math.floor(anchors.length / 2)];
	const last = anchors[anchors.length - 1];
	if (!first || !middle || !last) return "";
	return [first, middle, last]
		.map((anchor) => `${anchor.value} ${anchor.label}`)
		.join(" · ");
}

export function labelsFromLines(
	min: number,
	max: number,
	raw: string,
): Record<string, string> {
	const lines = raw.split(/\r?\n/);
	const labels: Record<string, string> = {};
	for (let i = 0; i <= max - min; i++) {
		const text = (lines[i] ?? "").trim();
		if (text) labels[String(min + i)] = text;
	}
	return labels;
}

export function labelLinesForForm(
	min: number,
	max: number,
	labels: Record<string, string>,
): string {
	const lines: string[] = [];
	for (let value = min; value <= max; value++) {
		lines.push(labels[String(value)] ?? "");
	}
	while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
	return lines.join("\n");
}

export function storedRatingConfig(
	min: number,
	max: number,
	labels: Record<string, string>,
): StoredQuestionConfig {
	if (Object.keys(labels).length === 0) return { min, max };
	return { min, max, labels } as StoredQuestionConfig;
}

export function formatWeightMultiplier(weight: number): string {
	return `${weight}×`;
}

export function ratingWeightsDiffer(
	questions: readonly { type: string; weight: number }[],
): boolean {
	const weights = questions
		.filter((question) => question.type === "rating")
		.map((question) => question.weight);
	return weights.some((weight) => weight !== weights[0]);
}

export type AssignmentPair = { submissionId: string; evaluatorId: string };

/**
 * Deterministic assignment distribution: each submission is offered to the
 * least-loaded eligible evaluators first (ties broken by input order), so
 * workloads stay balanced without randomness. Pairs that already exist are
 * never re-minted, so re-running the same distribution is a no-op.
 */
export function distributeAssignments(opts: {
	submissionIds: readonly string[];
	evaluatorIds: readonly string[];
	existing: readonly AssignmentPair[];
	/** Null → every evaluator gets every submission (Sessionboard's documented
	 * no-caps behavior). When set, a TARGET that counts the reviewers the
	 * submission already has — never a doubling. */
	reviewersPerSubmission?: number | null;
	/** Caps an evaluator's TOTAL load (existing + new); when everyone sits at
	 * cap, a submission simply receives fewer reviewers. */
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

export function csvCell(value: unknown): string {
	const s = value == null ? "" : String(value);
	return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export function toCsv(rows: readonly (readonly unknown[])[]): string {
	return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}
