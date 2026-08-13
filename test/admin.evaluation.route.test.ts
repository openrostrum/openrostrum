import { env } from "cloudflare:test";
import { and, eq, like } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "../app/db";
import {
	emailOutbox,
	evaluationAnswers,
	evaluationPlans,
	evaluationRounds,
	evaluations,
	events,
	organizations,
	reviews,
	reviewerTracks,
	roundEvaluators,
	roundQuestions,
	submissions,
	users,
} from "../app/db/schema";
import {
	action as listAction,
	loader as listLoader,
} from "../app/routes/admin.evaluation";
import {
	action as planAction,
	loader as planLoader,
} from "../app/routes/admin.evaluation.$planId";
import { loader as exportLoader } from "../app/routes/admin.evaluation.export[.csv]";
import { action as reviewAction } from "../app/routes/reviews.$id";
import {
	CONTEXT_OF,
	sampleScorecardBody,
	seedEvalBase,
	sessionRequest,
} from "./eval-fixtures";

const CONTEXT = CONTEXT_OF(env);

type Fn = (args: unknown) => Promise<unknown>;
const call = (fn: unknown, request: Request, planId?: string) =>
	(fn as Fn)({
		context: CONTEXT,
		request,
		params: planId ? { planId } : {},
	});

// reviews.$id needs params.id, not planId — small dedicated caller.
const callReview = async (body: URLSearchParams, id: string) =>
	(reviewAction as unknown as Fn)({
		context: CONTEXT,
		request: await sessionRequest(
			env,
			"u_rev",
			`http://localhost/reviews/${id}`,
			{
				method: "POST",
				body,
			},
		),
		params: { id },
	});

describe("plan results (weighted aggregate, sortable)", () => {
	it("shows the WEIGHTED aggregate (≈3.33) and sorts both directions", async () => {
		const { db } = await seedEvalBase(env);
		await callReview(sampleScorecardBody("ev1"), "s1");
		// second submission scored 5/5 → aggregate 5.00, must outrank 3.33
		await db.insert(evaluations).values({
			id: "ev2",
			roundId: "r1",
			submissionId: "s2",
			evaluatorId: "u_rev",
		});
		const top = sampleScorecardBody("ev2");
		top.set("q_q_orig", "5");
		top.set("q_q_rel", "5");
		await callReview(top, "s2");

		const load = async (sort: string) =>
			(await call(
				planLoader,
				await sessionRequest(
					env,
					"u_admin",
					`http://localhost/admin/evaluation/plan1?tab=results&sort=${sort}`,
				),
				"plan1",
			)) as {
				data: {
					results: {
						rows: Array<{ title: string; aggregate: number | null }>;
					};
				};
			};
		const desc = await load("score_desc");
		expect(desc.data.results.rows.map((r) => r.title)).toEqual([
			"Your AI Pair Programmer Is Lying to You",
			"Taming 40-Minute CI",
		]);
		expect(desc.data.results.rows[0]?.aggregate).toBeCloseTo(5, 5);
		// Weighted arithmetic: 10/3 ≈ 3.33, NOT the flat 3.0 mean.
		expect(desc.data.results.rows[1]?.aggregate).toBeCloseTo(10 / 3, 5);
		const asc = await load("score_asc");
		expect(asc.data.results.rows.map((r) => r.title)).toEqual([
			"Taming 40-Minute CI",
			"Your AI Pair Programmer Is Lying to You",
		]);
	});

	it("organizer results detail exposes identity even for an anonymized round", async () => {
		await seedEvalBase(env); // r1 is anonymized — reviewers are blinded, organizers never are
		await callReview(sampleScorecardBody("ev1"), "s1");
		const result = (await call(
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
					detail: {
						speakers: string;
						evaluations: Array<{
							evaluator: string;
							answers: Array<{ question: string; value: string }>;
						}>;
					} | null;
				};
			};
		};
		const detail = result.data.results.detail;
		expect(detail?.speakers).toContain("Priya Raman (speaker)");
		expect(detail?.speakers).toContain("Marcus Okafor (secondary)");
		expect(detail?.evaluations[0]?.evaluator).toBe("Sam Whitfield");
		expect(detail?.evaluations[0]?.answers).toContainEqual({
			question: "Recommendation",
			value: "Accept",
		});
	});
});

describe("assignment tooling", () => {
	it("auto-distribute honors caps and re-running mints nothing new", async () => {
		const { db } = await seedEvalBase(env);
		// a second pooled reviewer so distribution has someone to balance across
		await db.insert(users).values({
			id: "u_rev2",
			email: "riley@test.co",
			passwordHash: "x",
			name: "Riley Second",
			role: "reviewer",
		});
		await db
			.insert(roundEvaluators)
			.values({ roundId: "r1", userId: "u_rev2" });
		const post = async () =>
			(await call(
				planAction,
				await sessionRequest(
					env,
					"u_admin",
					"http://localhost/admin/evaluation/plan1",
					{
						method: "POST",
						body: new URLSearchParams([
							["intent", "assign-bulk"],
							["roundId", "r1"],
							["scope", "all"],
							["reviewersPerSubmission", "1"],
						]),
					},
				),
				"plan1",
			)) as { ok?: string; formError?: string };
		const first = await post();
		expect(first.ok).toBeTruthy();
		// 3 submissions × 1 reviewer each; s1 was pre-assigned to u_rev (seed).
		const rows = await db.select().from(evaluations);
		expect(rows).toHaveLength(3);
		const bySub = new Map<string, number>();
		for (const row of rows) {
			bySub.set(row.submissionId, (bySub.get(row.submissionId) ?? 0) + 1);
		}
		expect([...bySub.values()]).toEqual([1, 1, 1]);
		// idempotency: the same distribution again adds nothing
		await post();
		expect(await db.select().from(evaluations)).toHaveLength(3);
	});

	it("track-filtered scope assigns only overlapping submissions", async () => {
		const { db } = await seedEvalBase(env);
		await db.delete(evaluations); // start clean
		const result = (await call(
			planAction,
			await sessionRequest(
				env,
				"u_admin",
				"http://localhost/admin/evaluation/plan1",
				{
					method: "POST",
					body: new URLSearchParams([
						["intent", "assign-bulk"],
						["roundId", "r1"],
						["scope", "tracks"],
						["trackIds", "t_dx"],
					]),
				},
			),
			"plan1",
		)) as { ok?: string };
		expect(result.ok).toBeTruthy();
		const rows = await db.select().from(evaluations);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.submissionId).toBe("s3"); // the only Developer Experience submission
	});

	it("assign-one rejects a principal outside the event reviewer registry", async () => {
		const { db } = await seedEvalBase(env);
		const result = (await call(
			planAction,
			await sessionRequest(
				env,
				"u_admin",
				"http://localhost/admin/evaluation/plan1",
				{
					method: "POST",
					body: new URLSearchParams([
						["intent", "assign-one"],
						["roundId", "r1"],
						["submissionId", "s2"],
						["evaluatorId", "u_speaker"], // not a reviewer on this event
					]),
				},
			),
			"plan1",
		)) as { formError?: string };
		expect(result.formError).toBeTruthy();
		expect(
			await db
				.select()
				.from(evaluations)
				.where(eq(evaluations.evaluatorId, "u_speaker")),
		).toHaveLength(0);
	});

	it("another org's plan is unreachable from this admin (404)", async () => {
		const { db } = await seedEvalBase(env);
		await db.insert(organizations).values({ id: "org2", name: "Other" });
		await db.insert(events).values({
			id: "e2",
			organizationId: "org2",
			name: "Other Conf",
			slug: "other",
		});
		await db
			.insert(evaluationPlans)
			.values({ id: "plan2", eventId: "e2", name: "Their plan" });
		const thrown = await call(
			planLoader,
			await sessionRequest(
				env,
				"u_admin",
				"http://localhost/admin/evaluation/plan2",
			),
			"plan2",
		).then(
			() => null,
			(e: unknown) => e,
		);
		expect(thrown).toBeInstanceOf(Response);
		expect((thrown as Response).status).toBe(404);
	});
});

describe("scorecard integrity", () => {
	it("a question with recorded answers cannot be deleted; an unanswered one can", async () => {
		const { db } = await seedEvalBase(env);
		await callReview(sampleScorecardBody("ev1"), "s1"); // records answers
		const del = async (questionId: string) =>
			(await call(
				planAction,
				await sessionRequest(
					env,
					"u_admin",
					"http://localhost/admin/evaluation/plan1",
					{
						method: "POST",
						body: new URLSearchParams([
							["intent", "delete-question"],
							["roundId", "r1"],
							["questionId", questionId],
						]),
					},
				),
				"plan1",
			)) as { ok?: string; formError?: string };
		const answered = await del("q_orig");
		expect(answered.formError).toMatch(/recorded answers/);
		// the row survived
		expect(
			await db
				.select()
				.from(roundQuestions)
				.where(eq(roundQuestions.id, "q_orig")),
		).toHaveLength(1);
		// a question nobody answered deletes cleanly
		await db.insert(roundQuestions).values({
			id: "q_fresh",
			roundId: "r1",
			label: "Fresh",
			type: "text",
			weight: 1,
			required: false,
			position: 9,
		});
		const fresh = await del("q_fresh");
		expect(fresh.ok).toBeTruthy();
		expect(
			await db
				.select()
				.from(roundQuestions)
				.where(eq(roundQuestions.id, "q_fresh")),
		).toHaveLength(0);
	});
});

describe("destructive paths with recorded reviews", () => {
	// The answers table RESTRICTs question deletion, which also aborts the
	// parent cascade — plan/round deletion must keep working after real
	// reviews exist, exactly as the confirm copy promises.
	it("deleting a ROUND that has recorded answers deletes it and its answers", async () => {
		const { db } = await seedEvalBase(env);
		await callReview(sampleScorecardBody("ev1"), "s1");
		expect((await db.select().from(evaluationAnswers)).length).toBeGreaterThan(
			0,
		);
		const result = (await call(
			planAction,
			await sessionRequest(
				env,
				"u_admin",
				"http://localhost/admin/evaluation/plan1",
				{
					method: "POST",
					body: new URLSearchParams([
						["intent", "delete-round"],
						["roundId", "r1"],
					]),
				},
			),
			"plan1",
		)) as { ok?: string; formError?: string };
		expect(result.ok).toBeTruthy();
		expect(await db.select().from(evaluationRounds)).toHaveLength(0);
		expect(await db.select().from(evaluationAnswers)).toHaveLength(0);
	});

	it("the plan LIST delete also survives recorded answers (both surfaces share one path)", async () => {
		const { db } = await seedEvalBase(env);
		await callReview(sampleScorecardBody("ev1"), "s1");
		const result = (await call(
			listAction,
			await sessionRequest(
				env,
				"u_admin",
				"http://localhost/admin/evaluation",
				{
					method: "POST",
					body: new URLSearchParams([
						["intent", "delete-plan"],
						["planId", "plan1"],
					]),
				},
			),
		)) as { ok?: string; formError?: string };
		expect(result.ok).toBeTruthy();
		expect(await db.select().from(evaluationPlans)).toHaveLength(0);
		expect(await db.select().from(evaluationAnswers)).toHaveLength(0);
	});

	it("deleting a PLAN that has recorded answers deletes everything", async () => {
		const { db } = await seedEvalBase(env);
		await callReview(sampleScorecardBody("ev1"), "s1");
		const response = (await call(
			planAction,
			await sessionRequest(
				env,
				"u_admin",
				"http://localhost/admin/evaluation/plan1",
				{
					method: "POST",
					body: new URLSearchParams([["intent", "delete-plan"]]),
				},
			),
			"plan1",
		)) as Response;
		expect(response.status).toBe(302); // redirect back to the plan list
		expect(await db.select().from(evaluationPlans)).toHaveLength(0);
		expect(await db.select().from(evaluations)).toHaveLength(0);
		expect(await db.select().from(evaluationAnswers)).toHaveLength(0);
	});
});

describe("decisions tally at scale", () => {
	it("survives 120 reviewed submissions (chunked under D1's parameter cap)", async () => {
		const { db } = await seedEvalBase(env, { withPlan: false });
		const subs = Array.from({ length: 120 }, (_, i) => ({
			id: `bulk${i}`,
			eventId: "e1",
			title: `Bulk talk ${i}`,
			status: "pending" as const,
		}));
		for (let i = 0; i < subs.length; i += 10) {
			await db.insert(submissions).values(subs.slice(i, i + 10));
		}
		const revs = subs.map((s, i) => ({
			id: `rev${i}`,
			submissionId: s.id,
			reviewerId: "u_rev",
			decision: "approve" as const,
		}));
		for (let i = 0; i < revs.length; i += 10) {
			await db.insert(reviews).values(revs.slice(i, i + 10));
		}
		const result = (await call(
			listLoader,
			await sessionRequest(
				env,
				"u_admin",
				"http://localhost/admin/evaluation?tab=decisions",
			),
		)) as { data: { decisions: { total: number } | null } };
		expect(result.data.decisions?.total).toBe(120);
	});
});

describe("reminders", () => {
	it("reminds lagging reviewers once per day — the double-click never double-sends", async () => {
		const { db } = await seedEvalBase(env);
		const remind = async () =>
			(await call(
				planAction,
				await sessionRequest(
					env,
					"u_admin",
					"http://localhost/admin/evaluation/plan1",
					{
						method: "POST",
						body: new URLSearchParams([
							["intent", "remind"],
							["roundId", "all"],
						]),
					},
				),
				"plan1",
			)) as { ok?: string };
		const first = await remind();
		expect(first.ok).toContain("Sent 1 reminder");
		const second = await remind();
		expect(second.ok).toContain("already reminded today");
		const outbox = await db
			.select()
			.from(emailOutbox)
			.where(eq(emailOutbox.to, "sam@test.co"));
		expect(outbox).toHaveLength(1); // dedupe held
		expect(outbox[0]?.subject).toContain("Reminder");
	});

	it("fully caught-up reviewers get no reminder", async () => {
		const { db } = await seedEvalBase(env);
		await callReview(sampleScorecardBody("ev1"), "s1"); // completes the only assignment
		const result = (await call(
			planAction,
			await sessionRequest(
				env,
				"u_admin",
				"http://localhost/admin/evaluation/plan1",
				{
					method: "POST",
					body: new URLSearchParams([
						["intent", "remind"],
						["roundId", "all"],
					]),
				},
			),
			"plan1",
		)) as { ok?: string };
		expect(result.ok).toMatch(/caught up/i);
		expect(await db.select().from(emailOutbox)).toHaveLength(0);
	});
});

describe("CSV export", () => {
	it("individual report carries the criterion answers and the weighted score", async () => {
		await seedEvalBase(env);
		await callReview(sampleScorecardBody("ev1"), "s1");
		const response = (await call(
			exportLoader,
			await sessionRequest(
				env,
				"u_admin",
				"http://localhost/admin/evaluation/export.csv?plan=plan1&report=individual",
			),
		)) as Response;
		expect(response.headers.get("Content-Type")).toContain("text/csv");
		expect(response.headers.get("Content-Disposition")).toContain("attachment");
		const text = await response.text();
		const lines = text.split("\r\n");
		expect(lines[0]).toContain("Initial Review — Originality");
		expect(lines[0]).toContain("Weighted score");
		const row = lines.find((l) => l.includes("Taming 40-Minute CI"));
		expect(row).toBeTruthy();
		expect(row).toContain("3.33"); // the weighted aggregate, not 3.00
		expect(row).toContain("Accept"); // the recommendation dropdown
	});

	it("cumulative report aggregates one row per submission", async () => {
		await seedEvalBase(env);
		await callReview(sampleScorecardBody("ev1"), "s1");
		const response = (await call(
			exportLoader,
			await sessionRequest(
				env,
				"u_admin",
				"http://localhost/admin/evaluation/export.csv?plan=plan1&report=cumulative",
			),
		)) as Response;
		const text = await response.text();
		const lines = text.split("\r\n");
		expect(lines[0]).toContain("Aggregate score");
		expect(lines.filter((l) => l.includes("Taming 40-Minute CI"))).toHaveLength(
			1,
		);
	});
});

describe("plan list actions", () => {
	it("create-plan server-derives the event and redirects into the editor", async () => {
		const { db } = await seedEvalBase(env, { withPlan: false });
		const response = (await call(
			listAction,
			await sessionRequest(
				env,
				"u_admin",
				"http://localhost/admin/evaluation",
				{
					method: "POST",
					body: new URLSearchParams([
						["intent", "create-plan"],
						["name", "Fresh plan"],
					]),
				},
			),
		)) as Response;
		expect(response.status).toBe(302);
		const [plan] = await db
			.select()
			.from(evaluationPlans)
			.where(like(evaluationPlans.name, "Fresh plan"));
		expect(plan?.eventId).toBe("e1");
		expect(response.headers.get("Location")).toBe(
			`/admin/evaluation/${plan?.id}`,
		);
	});

	it("closing a plan locks reviewer writes", async () => {
		const { db } = await seedEvalBase(env);
		await db
			.update(evaluationPlans)
			.set({ status: "closed" })
			.where(eq(evaluationPlans.id, "plan1"));
		const result = (await callReview(sampleScorecardBody("ev1"), "s1")) as {
			formError?: string;
		};
		expect(result.formError).toBeTruthy();
		const [ev] = await db
			.select()
			.from(evaluations)
			.where(and(eq(evaluations.id, "ev1"), eq(evaluations.status, "pending")));
		expect(ev).toBeTruthy();
	});
});

// The round and question forms post every input on the row whatever the type,
// so the schema is what decides which of them this row actually uses.
describe("round and question forms at the boundary", () => {
	const post = async (fields: Record<string, string>) =>
		(await call(
			planAction,
			await sessionRequest(
				env,
				"u_admin",
				"http://localhost/admin/evaluation/plan1",
				{ method: "POST", body: new URLSearchParams(fields) },
			),
			"plan1",
		)) as {
			ok?: string;
			formError?: string;
			fieldErrors?: Record<string, string[]>;
		};

	const addQuestion = (fields: Record<string, string>) =>
		post({ intent: "add-question", roundId: "r1", ...fields });

	const questions = async () =>
		await getDb(env)
			.select()
			.from(roundQuestions)
			.where(eq(roundQuestions.roundId, "r1"))
			.orderBy(roundQuestions.position);

	const lastQuestion = async () => (await questions()).at(-1);

	it("the yes/no round selects are stored as booleans, and absent means no", async () => {
		const { db } = await seedEvalBase(env);
		const round = async () => {
			const rows = await db
				.select()
				.from(evaluationRounds)
				.where(eq(evaluationRounds.planId, "plan1"))
				.orderBy(evaluationRounds.position);
			return rows.at(-1);
		};
		expect(
			await post({
				intent: "add-round",
				name: "Blind round",
				anonymized: "yes",
				showOtherScores: "no",
			}),
		).toMatchObject({ ok: expect.any(String) });
		expect(await round()).toMatchObject({
			anonymized: true,
			showOtherScores: false,
		});
		// The checkboxes post nothing when off, which is a "no", not a failure.
		await post({ intent: "add-round", name: "Plain round" });
		expect(await round()).toMatchObject({
			anonymized: false,
			showOtherScores: false,
		});
	});

	it("a round select outside yes/no is refused by field", async () => {
		await seedEvalBase(env);
		const result = await post({
			intent: "add-round",
			name: "Tampered",
			anonymized: "maybe",
		});
		expect(result.fieldErrors?.anonymized?.[0]).toBeTruthy();
		expect(result.ok).toBeUndefined();
	});

	it("a rating question keeps its scale, and defaults to 1–5 when unset", async () => {
		await seedEvalBase(env);
		await addQuestion({ label: "Depth", type: "rating", min: "0", max: "10" });
		expect(await lastQuestion()).toMatchObject({
			type: "rating",
			config: { min: 0, max: 10 },
			required: true,
			weight: 1,
		});
		await addQuestion({ label: "Fit", type: "rating", weight: "2" });
		expect(await lastQuestion()).toMatchObject({
			config: { min: 1, max: 5 },
			weight: 2,
		});
	});

	it("stores organizer-authored rating labels in the question config", async () => {
		await seedEvalBase(env);
		await addQuestion({
			label: "Stage readiness",
			type: "rating",
			min: "1",
			max: "5",
			labels:
				"Not ready for the stage\n\nProgrammable as-is\n\nMust-see keynote",
		});
		expect(await lastQuestion()).toMatchObject({
			config: {
				min: 1,
				max: 5,
				labels: {
					"1": "Not ready for the stage",
					"3": "Programmable as-is",
					"5": "Must-see keynote",
				},
			},
		});
	});

	it("an inverted rating scale is refused on the max field", async () => {
		await seedEvalBase(env);
		const before = (await questions()).length;
		const result = await addQuestion({
			label: "Backwards",
			type: "rating",
			min: "5",
			max: "3",
		});
		expect(result.fieldErrors?.max?.[0]).toMatch(/greater than min/);
		expect(await questions()).toHaveLength(before); // nothing was written
	});

	it("a dropdown keeps its choices and needs at least two of them", async () => {
		await seedEvalBase(env);
		const thin = await addQuestion({
			label: "Track",
			type: "dropdown",
			options: "  only  ",
		});
		expect(thin.fieldErrors?.options?.[0]).toMatch(/two/);
		await addQuestion({
			label: "Track",
			type: "dropdown",
			options: " AI , Infra ,, ",
		});
		expect(await lastQuestion()).toMatchObject({
			type: "dropdown",
			config: { options: ["AI", "Infra"] },
		});
	});

	it("fields another type owns are ignored, not fatal", async () => {
		await seedEvalBase(env);
		// The row's hidden scale inputs still post when the type is dropdown.
		await addQuestion({
			label: "Track",
			type: "dropdown",
			options: "AI, Infra",
			min: "9",
			max: "2",
		});
		expect(await lastQuestion()).toMatchObject({
			type: "dropdown",
			config: { options: ["AI", "Infra"] },
		});
		await addQuestion({
			label: "Notes",
			type: "text",
			min: "9",
			max: "2",
			options: "one",
			required: "no",
		});
		expect(await lastQuestion()).toMatchObject({
			type: "text",
			config: null,
			required: false,
		});
	});

	it("a question type nobody offers is refused, and the label is still checked", async () => {
		await seedEvalBase(env);
		const before = (await questions()).length;
		const bogus = await addQuestion({ label: "Nope", type: "slider" });
		expect(bogus.fieldErrors?.type?.[0]).toBeTruthy();
		const unlabelled = await addQuestion({ label: "", type: "text" });
		expect(unlabelled.fieldErrors?.label?.[0]).toMatch(/required/i);
		// the fields every type shares are still checked on the branch that won
		const negative = await addQuestion({
			label: "Fit",
			type: "rating",
			weight: "-1",
		});
		expect(negative.fieldErrors?.weight?.[0]).toBeTruthy();
		expect(await questions()).toHaveLength(before); // none was written
	});
});

describe("plan editor mutation replay", () => {
	const KEY = "aaaaaaaa-0000-4000-8000-000000000001";

	const post = async (fields: Record<string, string>) =>
		(await call(
			planAction,
			await sessionRequest(
				env,
				"u_admin",
				"http://localhost/admin/evaluation/plan1",
				{ method: "POST", body: new URLSearchParams(fields) },
			),
			"plan1",
		)) as {
			ok?: string;
			formError?: string;
			fieldErrors?: Record<string, string[]>;
		};

	it("posting add-round twice with the same key creates one round", async () => {
		const { db } = await seedEvalBase(env);
		const fields = {
			intent: "add-round",
			name: "Committee",
			idempotencyKey: KEY,
		};
		expect(await post(fields)).toMatchObject({ ok: expect.any(String) });
		expect(await post(fields)).toMatchObject({ ok: expect.any(String) });
		const rows = await db
			.select()
			.from(evaluationRounds)
			.where(eq(evaluationRounds.planId, "plan1"));
		expect(rows.filter((row) => row.name === "Committee")).toHaveLength(1);
	});

	it("posting add-question twice with the same key creates one question", async () => {
		const { db } = await seedEvalBase(env);
		const fields = {
			intent: "add-question",
			roundId: "r1",
			label: "Stage craft",
			type: "text",
			idempotencyKey: KEY,
		};
		expect(await post(fields)).toMatchObject({ ok: expect.any(String) });
		expect(await post(fields)).toMatchObject({ ok: expect.any(String) });
		expect(
			await db
				.select()
				.from(roundQuestions)
				.where(
					and(
						eq(roundQuestions.roundId, "r1"),
						eq(roundQuestions.label, "Stage craft"),
					),
				),
		).toHaveLength(1);
	});

	it("posting add-evaluator twice with the same key keeps one pool row", async () => {
		const { db } = await seedEvalBase(env);
		await db.insert(users).values({
			id: "u_rev2",
			email: "riley@test.co",
			passwordHash: "x",
			name: "Riley Second",
			role: "reviewer",
		});
		await db
			.insert(reviewerTracks)
			.values({ userId: "u_rev2", trackId: "t_ai" });
		const fields = {
			intent: "add-evaluator",
			roundId: "r1",
			userId: "u_rev2",
			idempotencyKey: KEY,
		};
		expect(await post(fields)).toMatchObject({ ok: expect.any(String) });
		expect(await post(fields)).toMatchObject({ ok: expect.any(String) });
		expect(
			await db
				.select()
				.from(roundEvaluators)
				.where(
					and(
						eq(roundEvaluators.roundId, "r1"),
						eq(roundEvaluators.userId, "u_rev2"),
					),
				),
		).toHaveLength(1);
	});

	it("delete-round removes the round after confirmation", async () => {
		const { db } = await seedEvalBase(env);
		const result = await post({ intent: "delete-round", roundId: "r1" });
		expect(result.ok).toBeTruthy();
		expect(result.formError).toBeUndefined();
		expect(
			await db
				.select()
				.from(evaluationRounds)
				.where(eq(evaluationRounds.id, "r1")),
		).toHaveLength(0);
	});
});
