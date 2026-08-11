import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getDb } from "../app/db";
import { aiReviews, reviews } from "../app/db/schema";
import {
	action as listAction,
	loader as listLoader,
} from "../app/routes/admin.evaluation";
import { loader as planLoader } from "../app/routes/admin.evaluation.$planId";
import { loader as exportLoader } from "../app/routes/admin.evaluation.export[.csv]";
import { action as reviewAction } from "../app/routes/reviews.$id";
import {
	CONTEXT_OF,
	sampleScorecardBody,
	seedEvalBase,
	sessionRequest,
} from "./eval-fixtures";

const RATIONALE =
	"Concrete incremental-build techniques for monorepo CI make this a strong, practical fit for the developer-experience track.";

/** Stub at the Workers AI binding seam: `reply` sees the chat inputs. */
function fakeAi(
	reply: (inputs: {
		messages: Array<{ role: string; content: string }>;
	}) => string | Promise<string>,
) {
	const calls: string[] = [];
	return {
		calls,
		async run(model: string, inputs: Record<string, unknown>) {
			calls.push(model);
			return {
				response: await reply(
					inputs as { messages: Array<{ role: string; content: string }> },
				),
			};
		},
	};
}

const verdict = (score: number) =>
	JSON.stringify({ score, rationale: RATIONALE });
// Explicitly blank the DeepSeek key so these tests always pin the BINDING
// path, independent of what the local .dev.vars happens to contain.
const envWith = (ai: unknown): Env =>
	({ ...env, DEEPSEEK_API_KEY: "", AI: ai }) as unknown as Env;

afterEach(() => vi.restoreAllMocks());

type Fn = (args: unknown) => Promise<unknown>;
const callOn = (testEnv: Env, fn: unknown, request: Request, planId?: string) =>
	(fn as Fn)({
		context: CONTEXT_OF(testEnv),
		request,
		params: planId ? { planId } : {},
	});

/** Posts ai-run the way a fresh page would: carrying the current run stamp. */
const runAi = async (
	testEnv: Env,
	submissionId: string,
	userId = "u_admin",
) => {
	const [row] = await getDb(env)
		.select({ updatedAt: aiReviews.updatedAt })
		.from(aiReviews)
		.where(eq(aiReviews.submissionId, submissionId))
		.limit(1);
	return callOn(
		testEnv,
		listAction,
		await sessionRequest(env, userId, "http://localhost/admin/evaluation", {
			method: "POST",
			body: new URLSearchParams([
				["intent", "ai-run"],
				["submissionId", submissionId],
				["knownRunStamp", String(row?.updatedAt.getTime() ?? 0)],
			]),
		}),
	) as Promise<{ ok?: string; formError?: string }>;
};

const postIntent = async (
	testEnv: Env,
	fields: Array<[string, string]>,
	userId = "u_admin",
) =>
	callOn(
		testEnv,
		listAction,
		await sessionRequest(env, userId, "http://localhost/admin/evaluation", {
			method: "POST",
			body: new URLSearchParams(fields),
		}),
	) as Promise<{ ok?: string; formError?: string }>;

const loadAiTab = async (testEnv: Env, params = "") =>
	(await callOn(
		testEnv,
		listLoader,
		await sessionRequest(
			env,
			"u_admin",
			`http://localhost/admin/evaluation?tab=ai${params}`,
		),
	)) as {
		data: {
			ai: {
				available: boolean;
				missing: number;
				rows: Array<{
					id: string;
					title: string;
					aiScore: number | null;
					aiOverride: number | null;
					aiEffective: number | null;
					approve: number;
				}>;
				detail: {
					ai: {
						score: number;
						effective: number;
						rationale: string;
						model: string;
						override: { score: number; by: string } | null;
					} | null;
					decisions: Array<{ reviewer: string; decision: string }>;
				} | null;
			};
		};
	};

describe("AI review — run and persist", () => {
	it("ai-run stores score + rationale + model; reload shows AI and human signals separately", async () => {
		const { db } = await seedEvalBase(env);
		await db.insert(reviews).values({
			submissionId: "s1",
			reviewerId: "u_rev",
			decision: "approve",
			comment: "Solid.",
		});
		const ai = fakeAi(() => verdict(7.5));
		const result = await runAi(envWith(ai), "s1");
		expect(result.ok).toContain("7.50");

		// A fresh loader request proves DB persistence, not client state.
		const after = await loadAiTab(env, "&sub=s1");
		const detail = after.data.ai.detail;
		expect(detail?.ai).toMatchObject({
			score: 7.5,
			effective: 7.5,
			rationale: RATIONALE,
			model: "@cf/openai/gpt-oss-120b",
			override: null,
		});
		// Human decision lives in its own labeled list, apart from the AI block.
		expect(detail?.decisions).toEqual([
			expect.objectContaining({
				reviewer: "Sam Whitfield",
				decision: "approve",
			}),
		]);
		const row = after.data.ai.rows.find((r) => r.id === "s1");
		expect(row).toMatchObject({ aiScore: 7.5, approve: 1 });
	});

	it("re-running replaces the single row and clears a standing override", async () => {
		await seedEvalBase(env);
		await runAi(envWith(fakeAi(() => verdict(7.5))), "s1");
		await postIntent(env, [
			["intent", "ai-override"],
			["submissionId", "s1"],
			["score", "4"],
		]);
		await runAi(envWith(fakeAi(() => verdict(5.5))), "s1");

		const db = getDb(env);
		const rows = await db
			.select()
			.from(aiReviews)
			.where(eq(aiReviews.submissionId, "s1"));
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ score: 5.5, overrideScore: null });
	});

	it("with a DeepSeek key the run uses DeepSeek, never the binding, and stores the reported model", async () => {
		await seedEvalBase(env);
		const fetchMock = vi.fn(
			async () =>
				new Response(
					JSON.stringify({
						model: "deepseek-v4-flash",
						content: [{ type: "text", text: verdict(8) }],
					}),
					{ status: 200 },
				),
		);
		vi.stubGlobal("fetch", fetchMock);
		const binding = fakeAi(() => verdict(1));
		const deepseekEnv = {
			...env,
			DEEPSEEK_API_KEY: "sk-test",
			AI: binding,
		} as unknown as Env;
		const result = await runAi(deepseekEnv, "s1");
		expect(result.ok).toContain("8.00");
		expect(binding.calls).toHaveLength(0); // the key outranks the binding
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const db = getDb(env);
		const [row] = await db
			.select({ model: aiReviews.model, score: aiReviews.score })
			.from(aiReviews)
			.where(eq(aiReviews.submissionId, "s1"));
		expect(row).toEqual({ model: "deepseek-v4-flash", score: 8 });
	});

	it("a stale form resubmit is refused without buying a second model call", async () => {
		await seedEvalBase(env);
		await runAi(envWith(fakeAi(() => verdict(7.5))), "s1");
		const second = fakeAi(() => verdict(1));
		const result = await postIntent(envWith(second), [
			["intent", "ai-run"],
			["submissionId", "s1"],
			["knownRunStamp", "0"], // the pre-run form, posted again
		]);
		expect(result.formError).toBeTruthy();
		expect(second.calls).toHaveLength(0); // no second inference spend
		const db = getDb(env);
		const [row] = await db
			.select()
			.from(aiReviews)
			.where(eq(aiReviews.submissionId, "s1"));
		expect(row?.score).toBe(7.5); // the fresh result was not replaced
	});

	it("draft/withdrawn submissions cannot be AI-reviewed", async () => {
		const { db } = await seedEvalBase(env);
		const { submissions } = await import("../app/db/schema");
		await db
			.update(submissions)
			.set({ status: "withdrawn" })
			.where(eq(submissions.id, "s1"));
		const result = await runAi(envWith(fakeAi(() => verdict(9))), "s1");
		expect(result.formError).toBe("Submission not found.");
		const rows = await db.select().from(aiReviews);
		expect(rows).toHaveLength(0);
	});
});

describe("AI review — human override (persists distinguishably)", () => {
	it("an admin override to a different value survives reload, showing both numbers and who overrode", async () => {
		await seedEvalBase(env);
		await runAi(envWith(fakeAi(() => verdict(7.5))), "s1");
		const result = await postIntent(env, [
			["intent", "ai-override"],
			["submissionId", "s1"],
			["score", "3"],
		]);
		expect(result.ok).toBeTruthy();

		const after = await loadAiTab(env, "&sub=s1");
		expect(after.data.ai.detail?.ai).toMatchObject({
			score: 7.5, // the AI original stays visible
			effective: 3,
			override: expect.objectContaining({ score: 3, by: "Jordan Alvarez" }),
		});
		const row = after.data.ai.rows.find((r) => r.id === "s1");
		expect(row).toMatchObject({ aiOverride: 3, aiEffective: 3 });

		const cleared = await postIntent(env, [
			["intent", "ai-clear-override"],
			["submissionId", "s1"],
		]);
		expect(cleared.ok).toBeTruthy();
		const restored = await loadAiTab(env, "&sub=s1");
		expect(restored.data.ai.detail?.ai).toMatchObject({
			effective: 7.5,
			override: null,
		});
	});

	it("rejects out-of-range or non-numeric overrides without writing", async () => {
		await seedEvalBase(env);
		await runAi(envWith(fakeAi(() => verdict(7.5))), "s1");
		for (const bad of ["15", "-1", "abc", ""]) {
			const result = await postIntent(env, [
				["intent", "ai-override"],
				["submissionId", "s1"],
				["score", bad],
			]);
			expect(result.formError).toBeTruthy();
		}
		const db = getDb(env);
		const [row] = await db
			.select()
			.from(aiReviews)
			.where(eq(aiReviews.submissionId, "s1"));
		expect(row?.overrideScore).toBeNull();
	});

	it("overriding before any AI run errors and creates nothing", async () => {
		await seedEvalBase(env);
		const result = await postIntent(env, [
			["intent", "ai-override"],
			["submissionId", "s2"],
			["score", "5"],
		]);
		expect(result.formError).toBeTruthy();
		const db = getDb(env);
		const rows = await db.select().from(aiReviews);
		expect(rows).toHaveLength(0);
	});
});

describe("AI review — degraded and failure states", () => {
	it("without the binding: loader reports unavailable, run refuses, nothing is written", async () => {
		await seedEvalBase(env);
		const noAi = envWith(undefined);
		const tab = await loadAiTab(noAi);
		expect(tab.data.ai.available).toBe(false);

		const result = await runAi(noAi, "s1");
		expect(result.formError).toContain("not available");
		const db = getDb(env);
		expect(await db.select().from(aiReviews)).toHaveLength(0);
	});

	it("a model failure surfaces as an error and stores no score", async () => {
		await seedEvalBase(env);
		const result = await runAi(
			envWith(fakeAi(() => "I simply cannot answer in JSON, sorry.")),
			"s1",
		);
		expect(result.formError).toBeTruthy();
		const db = getDb(env);
		expect(await db.select().from(aiReviews)).toHaveLength(0);
	});

	it("a reviewer (non-admin) cannot trigger AI actions", async () => {
		await seedEvalBase(env);
		const ai = fakeAi(() => verdict(9));
		const thrown = await runAi(envWith(ai), "s1", "u_rev").then(
			() => null,
			(e: unknown) => e,
		);
		expect(thrown).toBeInstanceOf(Response);
		expect((thrown as Response).status).toBe(302);
		expect((thrown as Response).headers.get("Location")).toBe("/403");
		expect(ai.calls).toHaveLength(0);
	});
});

describe("AI review — bulk action", () => {
	it("scores every unscored submission, then reports a clean no-op", async () => {
		await seedEvalBase(env);
		const ai = fakeAi(() => verdict(6));
		const first = await postIntent(envWith(ai), [["intent", "ai-run-bulk"]]);
		expect(first.ok).toContain("AI reviewed 3 of 3");
		const db = getDb(env);
		expect(await db.select().from(aiReviews)).toHaveLength(3);

		const again = await postIntent(envWith(ai), [["intent", "ai-run-bulk"]]);
		expect(again.ok).toBeTruthy();
		expect(again.formError).toBeUndefined();
		expect(await db.select().from(aiReviews)).toHaveLength(3);
	});

	it("a partial failure leaves the failed submission unscored and says so", async () => {
		await seedEvalBase(env);
		const ai = fakeAi(({ messages }) => {
			const user = messages.find((m) => m.role === "user")?.content ?? "";
			return user.includes("Docs That Answer Back")
				? "no json here"
				: verdict(8);
		});
		const result = await postIntent(envWith(ai), [["intent", "ai-run-bulk"]]);
		expect(result.ok).toContain("1 failed");
		const db = getDb(env);
		const rows = await db.select().from(aiReviews);
		expect(rows.map((r) => r.submissionId).sort()).toEqual(["s1", "s2"]);
	});
});

describe("AI vs human separation in results views", () => {
	it("plan results carry the AI score beside — never inside — the human aggregate", async () => {
		await seedEvalBase(env);
		// Human weighted review: Originality 4 (w2) + Relevance 2 (w1) → 10/3.
		await (reviewAction as unknown as Fn)({
			context: CONTEXT_OF(env),
			request: await sessionRequest(
				env,
				"u_rev",
				"http://localhost/reviews/s1",
				{
					method: "POST",
					body: sampleScorecardBody("ev1"),
				},
			),
			params: { id: "s1" },
		});
		await runAi(envWith(fakeAi(() => verdict(9.5))), "s1");

		const result = (await callOn(
			env,
			planLoader,
			await sessionRequest(
				env,
				"u_admin",
				"http://localhost/admin/evaluation/plan1?tab=results&sub=s1",
			),
			"plan1",
		)) as {
			data: {
				results: {
					rows: Array<{
						id: string;
						aggregate: number | null;
						ai: { effective: number; overridden: boolean } | null;
					}>;
					detail: { ai: { rationale: string; model: string } | null } | null;
				};
			};
		};
		const row = result.data.results.rows.find((r) => r.id === "s1");
		// The human aggregate stays the weighted human mean — 9.5 must not move it.
		expect(row?.aggregate).toBeCloseTo(10 / 3, 5);
		expect(row?.ai).toMatchObject({ effective: 9.5, overridden: false });
		expect(result.data.results.detail?.ai?.rationale).toBe(RATIONALE);
	});

	it("cumulative CSV exports the AI column alongside the unchanged human aggregate", async () => {
		await seedEvalBase(env);
		await (reviewAction as unknown as Fn)({
			context: CONTEXT_OF(env),
			request: await sessionRequest(
				env,
				"u_rev",
				"http://localhost/reviews/s1",
				{
					method: "POST",
					body: sampleScorecardBody("ev1"),
				},
			),
			params: { id: "s1" },
		});
		await runAi(envWith(fakeAi(() => verdict(9.5))), "s1");
		await postIntent(env, [
			["intent", "ai-override"],
			["submissionId", "s1"],
			["score", "2"],
		]);

		const response = (await callOn(
			env,
			exportLoader,
			await sessionRequest(
				env,
				"u_admin",
				"http://localhost/admin/evaluation/export.csv?plan=plan1&report=cumulative",
			),
		)) as Response;
		const text = await response.text();
		const lines = text.split("\r\n");
		expect(lines[0]).toContain("AI first-pass score");
		expect(lines[0]).toContain("AI score overridden");
		const row = lines.find((l) => l.includes("Taming 40-Minute CI"));
		expect(row).toContain("3.33"); // human aggregate untouched
		expect(row).toContain("2.00"); // the override is the effective AI number
		expect(row).toContain("yes");
	});
});
