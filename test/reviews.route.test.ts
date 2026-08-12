import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "../app/db";
import {
	emailOutbox,
	evaluationRounds,
	evaluations,
	reviews,
	submissions,
} from "../app/db/schema";
import { loader as adminEvalLoader } from "../app/routes/admin.evaluation";
import { loader as queueLoader } from "../app/routes/reviews";
import {
	action as reviewAction,
	loader as reviewLoader,
} from "../app/routes/reviews.$id";
import {
	CONTEXT_OF,
	sampleScorecardBody,
	seedEvalBase,
	sessionRequest,
} from "./eval-fixtures";

const CONTEXT = CONTEXT_OF(env);

type LoaderFn = (args: unknown) => Promise<unknown>;
const call = async (fn: unknown, request: Request, id?: string) =>
	(fn as LoaderFn)({
		context: CONTEXT,
		request,
		params: id ? { id } : {},
	});

describe("reviewer queue (/reviews)", () => {
	it("assigned tab is EXACTLY the assigned set — track-matched but unassigned stays out", async () => {
		await seedEvalBase(env);
		const request = await sessionRequest(
			env,
			"u_rev",
			"http://localhost/reviews?tab=assigned",
		);
		const result = (await call(queueLoader, request)) as {
			data: {
				assignedItems: { total: number; rows: Array<{ title: string }> };
			};
		};
		const titles = result.data.assignedItems.rows.map((r) => r.title);
		// s1 assigned; s2 shares the reviewer's track but was NOT assigned; s3 neither.
		expect(titles).toEqual(["Taming 40-Minute CI"]);
		expect(result.data.assignedItems.total).toBe(1);
	});

	it("track queue routes by overlap: covered submissions in, uncovered out", async () => {
		await seedEvalBase(env);
		const request = await sessionRequest(
			env,
			"u_rev",
			"http://localhost/reviews?tab=tracks",
		);
		const result = (await call(queueLoader, request)) as {
			data: { trackItems: { rows: Array<{ title: string }> } };
		};
		const titles = result.data.trackItems.rows.map((r) => r.title).sort();
		expect(titles).toEqual([
			"Taming 40-Minute CI",
			"Your AI Pair Programmer Is Lying to You",
		]);
		expect(titles).not.toContain("Docs That Answer Back");
	});

	it("draft and withdrawn submissions never enter the track queue", async () => {
		const { db } = await seedEvalBase(env);
		await db
			.update(submissions)
			.set({ status: "draft" })
			.where(eq(submissions.id, "s2"));
		const request = await sessionRequest(
			env,
			"u_rev",
			"http://localhost/reviews?tab=tracks",
		);
		const result = (await call(queueLoader, request)) as {
			data: { trackItems: { rows: Array<{ title: string }> } };
		};
		expect(result.data.trackItems.rows.map((r) => r.title)).toEqual([
			"Taming 40-Minute CI",
		]);
	});
});

describe("role separation", () => {
	it("a reviewer cannot reach the admin evaluation surface (403 redirect)", async () => {
		await seedEvalBase(env);
		const request = await sessionRequest(
			env,
			"u_rev",
			"http://localhost/admin/evaluation",
		);
		const thrown = await call(adminEvalLoader, request).then(
			() => null,
			(e: unknown) => e,
		);
		expect(thrown).toBeInstanceOf(Response);
		expect((thrown as Response).status).toBe(302);
		expect((thrown as Response).headers.get("Location")).toBe("/403");
	});

	it("an unassigned, non-track submission 404s for the reviewer (no URL guessing)", async () => {
		await seedEvalBase(env);
		const request = await sessionRequest(
			env,
			"u_rev",
			"http://localhost/reviews/s3",
		);
		const thrown = await call(reviewLoader, request, "s3").then(
			() => null,
			(e: unknown) => e,
		);
		expect(thrown).toBeInstanceOf(Response);
		expect((thrown as Response).status).toBe(404);
	});
});

describe("anonymized review projection (/reviews/:id)", () => {
	it("anonymized round: participant identity absent from the ENTIRE payload", async () => {
		await seedEvalBase(env); // r1.anonymized = true
		const request = await sessionRequest(
			env,
			"u_rev",
			"http://localhost/reviews/s1",
		);
		const result = (await call(reviewLoader, request, "s1")) as {
			data: { anonymized: boolean; identity: unknown };
		};
		expect(result.data.anonymized).toBe(true);
		expect(result.data.identity).toBeNull();
		const payload = JSON.stringify(result.data);
		expect(payload).not.toContain("Priya");
		expect(payload).not.toContain("Okafor");
		expect(payload).not.toContain("Latticework");
	});

	it("non-anonymized round: identity present, with role labels", async () => {
		const { db } = await seedEvalBase(env);
		await db
			.update(evaluationRounds)
			.set({ anonymized: false })
			.where(eq(evaluationRounds.id, "r1"));
		const request = await sessionRequest(
			env,
			"u_rev",
			"http://localhost/reviews/s1",
		);
		const result = (await call(reviewLoader, request, "s1")) as {
			data: {
				anonymized: boolean;
				identity: {
					participants: Array<{ name: string; role: string }>;
				} | null;
			};
		};
		expect(result.data.anonymized).toBe(false);
		expect(result.data.identity?.participants).toEqual([
			expect.objectContaining({ name: "Priya Raman", role: "speaker" }),
			expect.objectContaining({ name: "Marcus Okafor", role: "secondary" }),
		]);
	});
});

describe("scoring, recusal, and the round lock", () => {
	it("saves the sample scorecard, marks completed, and stays editable", async () => {
		const { db } = await seedEvalBase(env);
		const post = async (body: URLSearchParams) =>
			call(
				reviewAction,
				await sessionRequest(env, "u_rev", "http://localhost/reviews/s1", {
					method: "POST",
					body,
				}),
				"s1",
			);
		const result = (await post(sampleScorecardBody("ev1"))) as { ok?: string };
		expect(result.ok).toBeTruthy();
		const [ev] = await db
			.select()
			.from(evaluations)
			.where(eq(evaluations.id, "ev1"));
		expect(ev?.status).toBe("completed");
		expect(ev?.submittedAt).not.toBeNull();
		// edit: change Relevance 2 → 5; the stored answer must follow
		const edited = sampleScorecardBody("ev1");
		edited.set("q_q_rel", "5");
		await post(edited);
		const loaded = (await call(
			reviewLoader,
			await sessionRequest(env, "u_rev", "http://localhost/reviews/s1"),
			"s1",
		)) as {
			data: {
				scorecards: Array<{
					questions: Array<{ id: string; myNumber: number | null }>;
				}>;
			};
		};
		const rel = loaded.data.scorecards[0]?.questions.find(
			(q) => q.id === "q_rel",
		);
		expect(rel?.myNumber).toBe(5);
	});

	it("rejects a missing required question with a field error and writes nothing", async () => {
		const { db } = await seedEvalBase(env);
		const body = sampleScorecardBody("ev1");
		body.set("q_q_orig", ""); // required rating left blank
		const result = (await call(
			reviewAction,
			await sessionRequest(env, "u_rev", "http://localhost/reviews/s1", {
				method: "POST",
				body,
			}),
			"s1",
		)) as { fieldErrors?: Record<string, string[]> };
		expect(result.fieldErrors?.q_q_orig?.[0]).toBeTruthy();
		const [ev] = await db
			.select()
			.from(evaluations)
			.where(eq(evaluations.id, "ev1"));
		expect(ev?.status).toBe("pending");
	});

	it("abstain records the recusal + reason; resume reopens it", async () => {
		const { db } = await seedEvalBase(env);
		const post = async (body: URLSearchParams) =>
			call(
				reviewAction,
				await sessionRequest(env, "u_rev", "http://localhost/reviews/s1", {
					method: "POST",
					body,
				}),
				"s1",
			);
		await post(
			new URLSearchParams([
				["intent", "abstain"],
				["evaluationId", "ev1"],
				["reason", "Former colleague"],
			]),
		);
		let [ev] = await db
			.select()
			.from(evaluations)
			.where(eq(evaluations.id, "ev1"));
		expect(ev?.status).toBe("abstained");
		expect(ev?.abstainReason).toBe("Former colleague");
		await post(
			new URLSearchParams([
				["intent", "resume"],
				["evaluationId", "ev1"],
			]),
		);
		[ev] = await db.select().from(evaluations).where(eq(evaluations.id, "ev1"));
		expect(ev?.status).toBe("pending");
		expect(ev?.abstainReason).toBeNull();
	});

	it("a closed round locks every write path (save, abstain)", async () => {
		const { db } = await seedEvalBase(env);
		await db
			.update(evaluationRounds)
			.set({ closesAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) })
			.where(eq(evaluationRounds.id, "r1"));
		const post = async (body: URLSearchParams) =>
			call(
				reviewAction,
				await sessionRequest(env, "u_rev", "http://localhost/reviews/s1", {
					method: "POST",
					body,
				}),
				"s1",
			);
		const save = (await post(sampleScorecardBody("ev1"))) as {
			formError?: string;
		};
		expect(save.formError).toMatch(/locked|closed/i);
		const abstain = (await post(
			new URLSearchParams([
				["intent", "abstain"],
				["evaluationId", "ev1"],
			]),
		)) as { formError?: string };
		expect(abstain.formError).toMatch(/locked|closed/i);
		const [ev] = await db
			.select()
			.from(evaluations)
			.where(eq(evaluations.id, "ev1"));
		expect(ev?.status).toBe("pending"); // nothing was written
	});
});

describe("track decision + feedback email", () => {
	it("decision persists; feedback goes out verbatim; submission status untouched", async () => {
		const { db } = await seedEvalBase(env);
		const feedback =
			"Promising topic — add production benchmarks before Aug 30?";
		const result = (await call(
			reviewAction,
			await sessionRequest(env, "u_rev", "http://localhost/reviews/s1", {
				method: "POST",
				body: new URLSearchParams([
					["intent", "decide"],
					["decision", "maybe"],
					["comment", "Needs benchmarks"],
					["feedback", feedback],
				]),
			}),
			"s1",
		)) as { ok?: string };
		expect(result.ok).toBeTruthy();
		const [review] = await db
			.select()
			.from(reviews)
			.where(eq(reviews.submissionId, "s1"));
		expect(review?.decision).toBe("maybe");
		expect(review?.comment).toBe("Needs benchmarks");
		const outbox = await db.select().from(emailOutbox);
		expect(outbox).toHaveLength(1);
		expect(outbox[0]?.to).toBe("priya@test.co"); // the submitter's account email
		expect(outbox[0]?.html).toContain(feedback);
		expect(outbox[0]?.html).not.toContain("Sam Whitfield"); // reviewer stays anonymous
		const [sub] = await db
			.select({ status: submissions.status })
			.from(submissions)
			.where(eq(submissions.id, "s1"));
		expect(sub?.status).toBe("pending"); // a reviewer decision is never a status change
	});

	it("identical feedback double-submit sends once; different feedback still sends", async () => {
		const { db } = await seedEvalBase(env);
		const decide = async (feedback: string) =>
			call(
				reviewAction,
				await sessionRequest(env, "u_rev", "http://localhost/reviews/s1", {
					method: "POST",
					body: new URLSearchParams([
						["intent", "decide"],
						["decision", "maybe"],
						["feedback", feedback],
					]),
				}),
				"s1",
			);
		await decide("Please add benchmarks.");
		await decide("Please add benchmarks."); // double-submit replay
		expect(await db.select().from(emailOutbox)).toHaveLength(1);
		await decide("Second, different note.");
		expect(await db.select().from(emailOutbox)).toHaveLength(2);
	});

	it("a decision WITHOUT feedback sends no email", async () => {
		await seedEvalBase(env);
		await call(
			reviewAction,
			await sessionRequest(env, "u_rev", "http://localhost/reviews/s2", {
				method: "POST",
				body: new URLSearchParams([
					["intent", "decide"],
					["decision", "deny"],
				]),
			}),
			"s2",
		);
		expect(await getDb(env).select().from(emailOutbox)).toHaveLength(0);
	});

	it("deciding on a submission outside the reviewer's tracks is forbidden", async () => {
		const { db } = await seedEvalBase(env);
		// assign s3 (Developer Experience — NOT covered) so the page is reachable,
		// then attempt the track-scoped decision on it.
		await db.insert(evaluations).values({
			id: "ev_s3",
			roundId: "r1",
			submissionId: "s3",
			evaluatorId: "u_rev",
		});
		const thrown = await call(
			reviewAction,
			await sessionRequest(env, "u_rev", "http://localhost/reviews/s3", {
				method: "POST",
				body: new URLSearchParams([
					["intent", "decide"],
					["decision", "approve"],
				]),
			}),
			"s3",
		).then(
			() => null,
			(e: unknown) => e,
		);
		expect(thrown).toBeInstanceOf(Response);
		expect((thrown as Response).status).toBe(403);
		expect(await db.select().from(reviews)).toHaveLength(0); // and no write
	});
});

// The comment and feedback boxes are nullable columns, so the schema decides
// once what an empty box means instead of every read and write re-deciding.
describe("decision text at the boundary", () => {
	const decide = async (fields: Record<string, string>) =>
		call(
			reviewAction,
			await sessionRequest(env, "u_rev", "http://localhost/reviews/s1", {
				method: "POST",
				body: new URLSearchParams({
					intent: "decide",
					decision: "maybe",
					...fields,
				}),
			}),
			"s1",
		);

	const storedComment = async () => {
		const [review] = await getDb(env)
			.select()
			.from(reviews)
			.where(eq(reviews.submissionId, "s1"));
		return review?.comment;
	};

	it("an omitted, empty, or whitespace-only comment is stored as null", async () => {
		await seedEvalBase(env);
		expect(await decide({})).toMatchObject({ ok: expect.any(String) });
		expect(await storedComment()).toBeNull();
		await decide({ comment: "" });
		expect(await storedComment()).toBeNull();
		await decide({ comment: "   \n\t " });
		expect(await storedComment()).toBeNull();
	});

	it("a comment is stored trimmed, and everything valid still gets through", async () => {
		await seedEvalBase(env);
		await decide({ comment: "  Needs benchmarks  " });
		expect(await storedComment()).toBe("Needs benchmarks");
		await decide({ comment: "line\nbreak" });
		expect(await storedComment()).toBe("line\nbreak");
		await decide({ comment: "x".repeat(5000) }); // the ceiling itself is fine
		expect(await storedComment()).toBe("x".repeat(5000));
	});

	it("an over-long comment or feedback is rejected by field, and nothing is written", async () => {
		await seedEvalBase(env);
		const tooLong = "x".repeat(5001);
		expect(await decide({ comment: tooLong })).toMatchObject({
			formError: expect.stringMatching(/comment under 5,000/),
		});
		expect(await decide({ feedback: tooLong })).toMatchObject({
			formError: expect.stringMatching(/feedback under 5,000/),
		});
		const db = getDb(env);
		expect(await db.select().from(reviews)).toHaveLength(0);
		expect(await db.select().from(emailOutbox)).toHaveLength(0);
	});

	it("whitespace-only feedback is not feedback — no email goes out", async () => {
		await seedEvalBase(env);
		await decide({ feedback: "  \n " });
		expect(await getDb(env).select().from(emailOutbox)).toHaveLength(0);
		await decide({ feedback: "  Real note.  " });
		const outbox = await getDb(env).select().from(emailOutbox);
		expect(outbox).toHaveLength(1);
		expect(outbox[0]?.html).toContain("Real note.");
	});
});
