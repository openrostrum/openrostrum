import { describe, expect, it } from "vitest";
import {
	csvCell,
	distributeAssignments,
	evaluationScore,
	labelLinesForForm,
	labelsFromLines,
	meanScore,
	ratingAnchors,
	ratingLegend,
	roundWritable,
	storedRatingConfig,
	toCsv,
} from "../app/lib/evaluation";

// Oracle for the weighted math, stated independently of the implementation:
// Originality 4 (weight 2) + Relevance 2 (weight 1) must aggregate to ≈3.33,
// NOT the plain 3.0 average; dropdown/text answers never enter the number.
describe("evaluationScore (weighted, rating-only)", () => {
	const questions = [
		{ id: "orig", type: "rating" as const, weight: 2 },
		{ id: "rel", type: "rating" as const, weight: 1 },
		{ id: "rec", type: "dropdown" as const, weight: 1 },
		{ id: "com", type: "text" as const, weight: 1 },
	];

	it("weights ratings: 4(w2) + 2(w1) → 3.33, not 3.0", () => {
		const score = evaluationScore(questions, [
			{ questionId: "orig", valueNumber: 4 },
			{ questionId: "rel", valueNumber: 2 },
			{ questionId: "rec", valueNumber: null },
		]);
		expect(score).toBeCloseTo(10 / 3, 5);
		expect(score).not.toBeCloseTo(3.0, 2);
	});

	it("drops unanswered optional ratings from both sums", () => {
		const withOptional = [
			...questions,
			{ id: "extra", type: "rating" as const, weight: 5 },
		];
		expect(
			evaluationScore(withOptional, [
				{ questionId: "orig", valueNumber: 4 },
				{ questionId: "rel", valueNumber: 2 },
			]),
		).toBeCloseTo(10 / 3, 5);
	});

	it("returns null when no rating was answered", () => {
		expect(
			evaluationScore(questions, [{ questionId: "rec", valueNumber: null }]),
		).toBeNull();
		expect(evaluationScore(questions, [])).toBeNull();
	});

	it("ignores zero-weight ratings", () => {
		expect(
			evaluationScore(
				[
					{ id: "a", type: "rating", weight: 1 },
					{ id: "b", type: "rating", weight: 0 },
				],
				[
					{ questionId: "a", valueNumber: 5 },
					{ questionId: "b", valueNumber: 1 },
				],
			),
		).toBe(5);
	});
});

describe("meanScore", () => {
	it("averages evaluation scores and is null on empty", () => {
		expect(meanScore([5, 10 / 3])).toBeCloseTo(25 / 6, 5);
		expect(meanScore([])).toBeNull();
	});
});

describe("distributeAssignments", () => {
	const subs = ["s1", "s2", "s3", "s4", "s5"];
	const revs = ["a", "b"];

	it("all-to-all when no caps are set (documented Sessionboard default)", () => {
		const pairs = distributeAssignments({
			submissionIds: subs,
			evaluatorIds: revs,
			existing: [],
		});
		expect(pairs).toHaveLength(10);
	});

	it("reviewersPerSubmission=1 gives every submission one reviewer, balanced", () => {
		const pairs = distributeAssignments({
			submissionIds: subs,
			evaluatorIds: revs,
			existing: [],
			reviewersPerSubmission: 1,
		});
		expect(pairs).toHaveLength(5);
		const loads = revs.map(
			(r) => pairs.filter((p) => p.evaluatorId === r).length,
		);
		expect(Math.abs((loads[0] ?? 0) - (loads[1] ?? 0))).toBeLessThanOrEqual(1);
		// every submission covered exactly once
		expect(new Set(pairs.map((p) => p.submissionId)).size).toBe(5);
	});

	it("maxPerEvaluator caps total load; overflow submissions get fewer reviewers", () => {
		const pairs = distributeAssignments({
			submissionIds: subs,
			evaluatorIds: revs,
			existing: [],
			reviewersPerSubmission: 1,
			maxPerEvaluator: 2,
		});
		expect(pairs).toHaveLength(4); // 2 reviewers × cap 2
		for (const r of revs) {
			expect(
				pairs.filter((p) => p.evaluatorId === r).length,
			).toBeLessThanOrEqual(2);
		}
	});

	it("never re-mints existing pairs and counts them toward the cap", () => {
		const pairs = distributeAssignments({
			submissionIds: ["s1", "s2"],
			evaluatorIds: ["a"],
			existing: [{ submissionId: "s1", evaluatorId: "a" }],
			maxPerEvaluator: 2,
		});
		expect(pairs).toEqual([{ submissionId: "s2", evaluatorId: "a" }]);
	});

	it("reviewersPerSubmission is a TARGET: a submission already covered gets nothing new", () => {
		const pairs = distributeAssignments({
			submissionIds: ["s1", "s2"],
			evaluatorIds: ["a", "b"],
			existing: [{ submissionId: "s1", evaluatorId: "b" }],
			reviewersPerSubmission: 1,
		});
		expect(pairs).toEqual([{ submissionId: "s2", evaluatorId: "a" }]);
	});
});

describe("roundWritable", () => {
	const day = 24 * 60 * 60 * 1000;

	it("locks when the plan is closed regardless of dates", () => {
		expect(
			roundWritable({ opensAt: null, closesAt: null }, "closed").writable,
		).toBe(false);
	});

	it("close date is INCLUSIVE: still writable on the close day itself", () => {
		const now = new Date("2026-10-15T18:00:00Z");
		expect(
			roundWritable(
				{ opensAt: null, closesAt: new Date("2026-10-15T00:00:00Z") },
				"open",
				now,
			).writable,
		).toBe(true);
		expect(
			roundWritable(
				{ opensAt: null, closesAt: new Date("2026-10-14T00:00:00Z") },
				"open",
				now,
			),
		).toEqual({ writable: false, reason: "closed" });
	});

	it("not writable before the open date", () => {
		expect(
			roundWritable(
				{ opensAt: new Date(Date.now() + 2 * day), closesAt: null },
				"open",
			),
		).toEqual({ writable: false, reason: "not-open" });
	});
});

describe("rating anchors", () => {
	it("fills a bare 1–5 config with direction-stating defaults", () => {
		expect(ratingAnchors({ min: 1, max: 5 })).toEqual([
			{ value: 1, label: "Weak — does not meet the bar" },
			{ value: 2, label: "Below the bar" },
			{ value: 3, label: "Meets the bar" },
			{ value: 4, label: "Strong" },
			{ value: 5, label: "Outstanding — a standout talk" },
		]);
	});

	it("keeps organizer labels and fills only the gaps", () => {
		expect(
			ratingAnchors({
				min: 1,
				max: 5,
				labels: {
					"1": "Not ready for the stage",
					"5": "Must-see keynote",
				},
			}),
		).toEqual([
			{ value: 1, label: "Not ready for the stage" },
			{ value: 2, label: "Below the bar" },
			{ value: 3, label: "Meets the bar" },
			{ value: 4, label: "Strong" },
			{ value: 5, label: "Must-see keynote" },
		]);
	});

	it("a 1–10 legend names the ends and the middle", () => {
		const legend = ratingLegend(ratingAnchors({ min: 1, max: 10 }));
		expect(legend).toContain("1 Weak — does not meet the bar");
		expect(legend).toContain("6 Meets the bar");
		expect(legend).toContain("10 Outstanding — a standout talk");
		expect(legend).not.toContain("2 Below the bar");
	});

	it("blank label lines keep their place so 1 and 5 can be named alone", () => {
		expect(
			labelsFromLines(1, 5, "Not ready\n\nProgrammable\n\nMust-see"),
		).toEqual({
			"1": "Not ready",
			"3": "Programmable",
			"5": "Must-see",
		});
		expect(
			labelLinesForForm(1, 5, {
				"1": "Not ready",
				"5": "Must-see",
			}),
		).toBe("Not ready\n\n\n\nMust-see");
		expect(storedRatingConfig(1, 5, {})).toEqual({ min: 1, max: 5 });
	});
});

describe("csv serialization", () => {
	it("quotes cells containing commas, quotes, and newlines", () => {
		expect(csvCell('He said "hi", twice')).toBe('"He said ""hi"", twice"');
		expect(csvCell("plain")).toBe("plain");
		expect(
			toCsv([
				["a", 'b,"c"'],
				["d\ne", 1],
			]),
		).toBe('a,"b,""c"""\r\n"d\ne",1');
	});
});
