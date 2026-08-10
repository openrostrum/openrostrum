import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getDb } from "../app/db";
import { aiReviews } from "../app/db/schema";
import {
	type AiChatProvider,
	type AiReviewSubmission,
	type AiRunner,
	buildReviewMessages,
	clearAiOverride,
	createDeepseekProvider,
	createWorkersAiProvider,
	effectiveAiScore,
	generateAiReview,
	getAiProvider,
	overrideAiReview,
	saveAiReview,
	WORKERS_AI_DEFAULT_MODEL,
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

const verdictJson = (score: number) =>
	JSON.stringify({ score, rationale: RATIONALE });

/** Scripted provider: returns each reply text in order, records every call. */
function scriptedProvider(replies: string[]) {
	const calls: Array<Array<{ role: string; content: string }>> = [];
	const provider: AiChatProvider = {
		model: "test-model",
		async chat(messages) {
			calls.push(messages);
			return {
				text: replies[Math.min(calls.length, replies.length) - 1] ?? "",
			};
		},
	};
	return { provider, calls };
}

afterEach(() => vi.restoreAllMocks());

describe("generateAiReview — structured output with retry-once", () => {
	it("parses a verdict wrapped in markdown fences and prose", async () => {
		const { provider, calls } = scriptedProvider([
			`Sure! Here is my review:\n\`\`\`json\n{"score": 7.5, "rationale": "${RATIONALE}"}\n\`\`\`\nHope this helps.`,
		]);
		const result = await generateAiReview(provider, SUB);
		expect(result).toEqual({
			ok: true,
			score: 7.5,
			rationale: RATIONALE,
			model: "test-model",
			attempts: 1,
		});
		expect(calls).toHaveLength(1);
	});

	it("retries exactly once on a malformed reply, then succeeds", async () => {
		const { provider, calls } = scriptedProvider([
			"I would rate this talk quite highly overall.",
			`{"score": "6", "rationale": "${RATIONALE}"}`,
		]);
		const result = await generateAiReview(provider, SUB);
		expect(result).toEqual({
			ok: true,
			score: 6,
			rationale: RATIONALE,
			model: "test-model",
			attempts: 2,
		});
		expect(calls).toHaveLength(2);
	});

	it("two malformed replies fail as 'malformed' — never a fabricated score", async () => {
		const { provider, calls } = scriptedProvider([
			"not json",
			"still not json",
		]);
		const result = await generateAiReview(provider, SUB);
		expect(result).toMatchObject({ ok: false, reason: "malformed" });
		expect(calls).toHaveLength(2);
	});

	it("a score outside 0–10 is rejected, not stored as-is", async () => {
		const { provider } = scriptedProvider([
			`{"score": 47, "rationale": "${RATIONALE}"}`,
			`{"score": 47, "rationale": "${RATIONALE}"}`,
		]);
		const result = await generateAiReview(provider, SUB);
		expect(result).toMatchObject({ ok: false, reason: "malformed" });
	});

	it("a model that never answers times out instead of hanging", async () => {
		const provider: AiChatProvider = {
			model: "test-model",
			chat: () => new Promise(() => {}),
		};
		const result = await generateAiReview(provider, SUB, { timeoutMs: 50 });
		expect(result).toMatchObject({ ok: false, reason: "timeout" });
	});

	it("a thrown provider error becomes a typed failure, not an exception", async () => {
		const provider: AiChatProvider = {
			model: "test-model",
			chat: () => Promise.reject(new Error("5001: model overloaded")),
		};
		const result = await generateAiReview(provider, SUB);
		expect(result).toMatchObject({ ok: false, reason: "error" });
	});

	it("a submission with an empty abstract still gets reviewed", async () => {
		const { provider } = scriptedProvider([verdictJson(3)]);
		const result = await generateAiReview(provider, {
			...SUB,
			description: "",
		});
		expect(result).toMatchObject({ ok: true, score: 3 });
	});
});

describe("Workers AI provider — reply envelopes", () => {
	it("reads the OpenAI chat-completions envelope the live chat route returns", async () => {
		// Shape captured from a real Workers AI reply on 2026-08-10.
		const runner: AiRunner = {
			run: async () => ({
				choices: [
					{
						finish_reason: "stop",
						index: 0,
						message: { content: verdictJson(4), role: "assistant" },
					},
				],
				created: 1786393319,
			}),
		};
		const provider = createWorkersAiProvider(runner, "@cf/test/model");
		const result = await generateAiReview(provider, SUB);
		expect(result).toMatchObject({
			ok: true,
			score: 4,
			model: "@cf/test/model",
		});
	});

	it("reads the legacy { response } envelope some catalog models still use", async () => {
		const runner: AiRunner = {
			run: async () => ({ response: verdictJson(8) }),
		};
		const provider = createWorkersAiProvider(runner, "@cf/test/model");
		const result = await generateAiReview(provider, SUB);
		expect(result).toMatchObject({ ok: true, score: 8 });
	});

	it("asks the binding for exactly the configured model", async () => {
		const models: string[] = [];
		const runner: AiRunner = {
			run: async (model) => {
				models.push(model);
				return { response: verdictJson(5) };
			},
		};
		await generateAiReview(
			createWorkersAiProvider(runner, "@cf/pinned/x"),
			SUB,
		);
		expect(models).toEqual(["@cf/pinned/x"]);
	});
});

describe("DeepSeek provider — Anthropic Messages endpoint", () => {
	it("posts plain-text Messages payload and stores the API-reported model", async () => {
		const fetchMock = vi.fn(
			async () =>
				new Response(
					JSON.stringify({
						id: "msg_test",
						type: "message",
						role: "assistant",
						model: "deepseek-v4-flash",
						content: [{ type: "text", text: verdictJson(7) }],
						stop_reason: "end_turn",
					}),
					{ status: 200 },
				),
		);
		vi.stubGlobal("fetch", fetchMock);
		const result = await generateAiReview(
			createDeepseekProvider("sk-test"),
			SUB,
		);
		expect(result).toMatchObject({
			ok: true,
			score: 7,
			model: "deepseek-v4-flash",
		});
		const [url, init] = fetchMock.mock.calls[0] as unknown as [
			string,
			RequestInit,
		];
		expect(url).toBe("https://api.deepseek.com/anthropic/v1/messages");
		expect((init.headers as Record<string, string>)["x-api-key"]).toBe(
			"sk-test",
		);
		expect(
			(init.headers as Record<string, string>).Authorization,
		).toBeUndefined();
		const body = JSON.parse(init.body as string);
		expect(body.model).toBe("deepseek-v4-flash");
		expect(body.system).toContain("AI first-pass reviewer");
		expect(body.messages).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ role: "user", content: expect.any(String) }),
			]),
		);
		expect(JSON.stringify(body)).not.toContain('"type":"image"');
		expect(body.output_config).toBeUndefined();
	});

	it("a non-OK response becomes a typed 'error' failure, never a crash", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("Insufficient Balance", { status: 402 })),
		);
		const result = await generateAiReview(
			createDeepseekProvider("sk-test"),
			SUB,
		);
		expect(result).toMatchObject({ ok: false, reason: "error" });
	});
});

describe("provider resolution — capability, like the email port", () => {
	const binding: AiRunner = { run: async () => ({ response: "" }) };

	it("a DeepSeek key wins over the Workers AI binding", () => {
		const provider = getAiProvider({
			DEEPSEEK_API_KEY: "sk-x",
			AI: binding,
		} as unknown as Env);
		expect(provider?.model).toBe("deepseek-v4-flash");
	});

	it("no key → the binding with the default model; env var pins another", () => {
		const base = { DEEPSEEK_API_KEY: "", AI: binding } as unknown as Env;
		expect(getAiProvider(base)?.model).toBe(WORKERS_AI_DEFAULT_MODEL);
		expect(
			getAiProvider({
				...base,
				AI_REVIEW_WORKERS_MODEL: "@cf/openai/gpt-oss-120b",
			} as unknown as Env)?.model,
		).toBe("@cf/openai/gpt-oss-120b");
	});

	it("neither key nor binding → null (the degraded state)", () => {
		expect(
			getAiProvider({ DEEPSEEK_API_KEY: "", AI: undefined } as unknown as Env),
		).toBeNull();
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
	const V = (
		score: number,
		extra: Partial<{ rationale: string; model: string }> = {},
	) => ({
		score,
		rationale: extra.rationale ?? RATIONALE,
		model: extra.model ?? "test-model",
	});

	it("re-saving replaces the single row (including the model id) and clears a standing override", async () => {
		await seedEvalBase(env, { withPlan: false });
		const db = getDb(env);
		await saveAiReview(db, "s1", V(7.5), null);
		await overrideAiReview(db, "s1", 4, "u_admin");
		// A legitimate re-run reads the row's current stamp before saving.
		const [fresh] = await db
			.select({ updatedAt: aiReviews.updatedAt })
			.from(aiReviews)
			.where(eq(aiReviews.submissionId, "s1"));
		const saved = await saveAiReview(
			db,
			"s1",
			V(5.5, { rationale: "Second pass.", model: "deepseek-v4-flash" }),
			fresh?.updatedAt ?? null,
		);
		expect(saved).toBe(true);
		const rows = await db
			.select()
			.from(aiReviews)
			.where(eq(aiReviews.submissionId, "s1"));
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			score: 5.5,
			rationale: "Second pass.",
			model: "deepseek-v4-flash",
			overrideScore: null,
			overrideById: null,
			overrideAt: null,
		});
	});

	it("a late save keyed to a stale stamp is skipped — the in-flight override survives", async () => {
		await seedEvalBase(env, { withPlan: false });
		const db = getDb(env);
		await saveAiReview(db, "s1", V(7.5), null);
		const stale = new Date("2026-08-01T00:00:00Z");
		await db
			.update(aiReviews)
			.set({ updatedAt: stale })
			.where(eq(aiReviews.submissionId, "s1"));
		// Organizer overrides while a slow re-run (started at `stale`) is in flight.
		await overrideAiReview(db, "s1", 3, "u_admin");
		const saved = await saveAiReview(
			db,
			"s1",
			V(9, { rationale: "Late verdict." }),
			stale,
		);
		expect(saved).toBe(false);
		const [row] = await db
			.select()
			.from(aiReviews)
			.where(eq(aiReviews.submissionId, "s1"));
		expect(row).toMatchObject({ score: 7.5, overrideScore: 3 });
	});

	it("two concurrent first runs cannot both land — the second save is skipped", async () => {
		await seedEvalBase(env, { withPlan: false });
		const db = getDb(env);
		expect(await saveAiReview(db, "s1", V(7), null)).toBe(true);
		expect(
			await saveAiReview(db, "s1", V(2, { rationale: "Loser." }), null),
		).toBe(false);
		const [row] = await db
			.select()
			.from(aiReviews)
			.where(eq(aiReviews.submissionId, "s1"));
		expect(row?.score).toBe(7);
	});

	it("override wins as the effective score until cleared, and records who set it", async () => {
		await seedEvalBase(env, { withPlan: false });
		const db = getDb(env);
		await saveAiReview(db, "s1", V(7.5), null);
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
