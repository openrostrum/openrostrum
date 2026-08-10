import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "../app/db";
import { aiReviews } from "../app/db/schema";
import {
	type AiReviewSubmission,
	type AiRunner,
	buildReviewMessages,
	clearAiOverride,
	effectiveAiScore,
	generateAiReview,
	overrideAiReview,
	saveAiReview,
} from "../app/domain/ai-review";
import { seedEvalBase } from "./eval-fixtures";

const SUB: AiReviewSubmission = {
	title: "Taming 40-Minute CI",
	description: "<p>Incremental builds at monorepo scale.</p>",
	eventName: "DevFlow Conf",
	format: "Talk",
	level: "Intermediate",
	language: "English",
	tracks: ["Developer Experience"],
	tags: ["ci"],
};

const RATIONALE =
	"The proposal tackles CI latency with concrete incremental-build techniques at monorepo scale, which fits the developer-experience track well.";

/** Scripted runner: returns each reply in order, records every call. */
function scriptedRunner(replies: string[]): AiRunner & {
	calls: Array<{ model: string; inputs: Record<string, unknown> }>;
} {
	const calls: Array<{ model: string; inputs: Record<string, unknown> }> = [];
	return {
		calls,
		async run(model, inputs) {
			calls.push({ model, inputs });
			const reply = replies[Math.min(calls.length, replies.length) - 1] ?? "";
			return { response: reply };
		},
	};
}

describe("generateAiReview — structured output with retry-once", () => {
	it("parses a verdict wrapped in markdown fences and prose", async () => {
		const runner = scriptedRunner([
			`Sure! Here is my review:\n\`\`\`json\n{"score": 7.5, "rationale": "${RATIONALE}"}\n\`\`\`\nHope this helps.`,
		]);
		const result = await generateAiReview(runner, SUB);
		expect(result).toEqual({ ok: true, score: 7.5, rationale: RATIONALE });
		expect(runner.calls).toHaveLength(1);
	});

	it("reads the OpenAI chat-completions envelope the live llama-4 route returns", async () => {
		// Shape captured from a real Workers AI reply on 2026-08-10.
		const runner: AiRunner = {
			run: async () => ({
				choices: [
					{
						finish_reason: "stop",
						index: 0,
						message: {
							content: `{"score": 4.0, "rationale": "${RATIONALE}"}`,
							role: "assistant",
						},
					},
				],
				created: 1786393319,
			}),
		};
		const result = await generateAiReview(runner, SUB);
		expect(result).toEqual({ ok: true, score: 4, rationale: RATIONALE });
	});

	it("retries exactly once on a malformed reply, then succeeds", async () => {
		const runner = scriptedRunner([
			"I would rate this talk quite highly overall.",
			`{"score": "6", "rationale": "${RATIONALE}"}`,
		]);
		const result = await generateAiReview(runner, SUB);
		expect(result).toEqual({ ok: true, score: 6, rationale: RATIONALE });
		expect(runner.calls).toHaveLength(2);
	});

	it("two malformed replies fail as 'malformed' — never a fabricated score", async () => {
		const runner = scriptedRunner(["not json", "still not json"]);
		const result = await generateAiReview(runner, SUB);
		expect(result).toMatchObject({ ok: false, reason: "malformed" });
		expect(runner.calls).toHaveLength(2);
	});

	it("a score outside 0–10 is rejected, not stored as-is", async () => {
		const runner = scriptedRunner([
			`{"score": 47, "rationale": "${RATIONALE}"}`,
			`{"score": 47, "rationale": "${RATIONALE}"}`,
		]);
		const result = await generateAiReview(runner, SUB);
		expect(result).toMatchObject({ ok: false, reason: "malformed" });
	});

	it("a model that never answers times out instead of hanging", async () => {
		const runner: AiRunner = {
			run: () => new Promise(() => {}),
		};
		const result = await generateAiReview(runner, SUB, { timeoutMs: 50 });
		expect(result).toMatchObject({ ok: false, reason: "timeout" });
	});

	it("a thrown provider error becomes a typed failure, not an exception", async () => {
		const runner: AiRunner = {
			run: () => Promise.reject(new Error("5001: model overloaded")),
		};
		const result = await generateAiReview(runner, SUB);
		expect(result).toMatchObject({ ok: false, reason: "error" });
	});

	it("a submission with an empty abstract still gets reviewed", async () => {
		const runner = scriptedRunner([
			`{"score": 3, "rationale": "${RATIONALE}"}`,
		]);
		const result = await generateAiReview(runner, {
			...SUB,
			description: "",
		});
		expect(result).toMatchObject({ ok: true, score: 3 });
	});
});

describe("buildReviewMessages — prompt boundaries", () => {
	it("caps a huge abstract so the request payload stays bounded", () => {
		const huge = "word ".repeat(5_000); // 25k chars
		const messages = buildReviewMessages({ ...SUB, description: huge });
		const user = messages.find((m) => m.role === "user");
		expect(user).toBeTruthy();
		expect((user as { content: string }).content.length).toBeLessThan(7_000);
		expect((user as { content: string }).content).toContain(
			"[abstract truncated]",
		);
	});
});

describe("AI review persistence — replace and override", () => {
	it("re-saving replaces the single row and clears a standing override", async () => {
		await seedEvalBase(env, { withPlan: false });
		const db = getDb(env);
		await saveAiReview(db, "s1", { score: 7.5, rationale: RATIONALE });
		await overrideAiReview(db, "s1", 4, "u_admin");
		await saveAiReview(db, "s1", { score: 5.5, rationale: "Second pass." });
		const rows = await db
			.select()
			.from(aiReviews)
			.where(eq(aiReviews.submissionId, "s1"));
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			score: 5.5,
			rationale: "Second pass.",
			overrideScore: null,
			overrideById: null,
			overrideAt: null,
		});
	});

	it("override wins as the effective score until cleared, and records who set it", async () => {
		await seedEvalBase(env, { withPlan: false });
		const db = getDb(env);
		await saveAiReview(db, "s1", { score: 7.5, rationale: RATIONALE });
		expect(await overrideAiReview(db, "s1", 3, "u_admin")).toBe(true);
		const [row] = await db
			.select()
			.from(aiReviews)
			.where(eq(aiReviews.submissionId, "s1"));
		if (!row) throw new Error("row missing");
		expect(row.overrideById).toBe("u_admin");
		expect(effectiveAiScore(row)).toBe(3);
		expect(row.score).toBe(7.5); // the AI original stays visible

		expect(await clearAiOverride(db, "s1")).toBe(true);
		const [restored] = await db
			.select()
			.from(aiReviews)
			.where(eq(aiReviews.submissionId, "s1"));
		if (!restored) throw new Error("row missing");
		expect(effectiveAiScore(restored)).toBe(7.5);
	});

	it("overriding a submission that has no AI review reports false and writes nothing", async () => {
		await seedEvalBase(env, { withPlan: false });
		const db = getDb(env);
		expect(await overrideAiReview(db, "s2", 5, "u_admin")).toBe(false);
		const rows = await db
			.select()
			.from(aiReviews)
			.where(eq(aiReviews.submissionId, "s2"));
		expect(rows).toHaveLength(0);
	});
});
