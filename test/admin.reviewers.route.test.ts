import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
	emailOutbox,
	evaluationPlans,
	evaluationRounds,
	evaluations,
	passwordResets,
	reviewerTracks,
	roundQuestions,
	users,
} from "../app/db/schema";
import {
	action as reviewersAction,
	loader as reviewersLoader,
} from "../app/routes/admin.reviewers";
import { CONTEXT_OF, seedEvalBase, sessionRequest } from "./eval-fixtures";

const CONTEXT = CONTEXT_OF(env);

type Fn = (args: unknown) => Promise<unknown>;
const call = (fn: unknown, request: Request) =>
	(fn as Fn)({ context: CONTEXT, request, params: {} });

const post = async (body: URLSearchParams) =>
	call(
		reviewersAction,
		await sessionRequest(env, "u_admin", "http://localhost/admin/reviewers", {
			method: "POST",
			body,
		}),
	);

describe("reviewer invites (G7 mechanics)", () => {
	it("add mints a sentinel user + NULL-org token + invite email with the set-password link", async () => {
		const { db } = await seedEvalBase(env, { withPlan: false });
		const response = (await post(
			new URLSearchParams([
				["intent", "add"],
				["name", "Rosa Delgado"],
				["email", "Rosa.Delgado@Example.com"],
				["trackIds", "t_ai"],
				["trackIds", "t_dx"],
			]),
		)) as Response;
		expect(response.status).toBe(302);

		const [rosa] = await db
			.select()
			.from(users)
			.where(eq(users.email, "rosa.delgado@example.com")); // normalized
		expect(rosa?.role).toBe("reviewer");
		// Sentinel hash: not a pbkdf2 value, so it can never verify at login.
		expect(rosa?.passwordHash.startsWith("pbkdf2$")).toBe(false);

		const trackRows = await db
			.select()
			.from(reviewerTracks)
			.where(eq(reviewerTracks.userId, rosa?.id ?? ""));
		expect(trackRows).toHaveLength(2);

		const [reset] = await db
			.select()
			.from(passwordResets)
			.where(eq(passwordResets.userId, rosa?.id ?? ""));
		expect(reset).toBeTruthy();
		// A reviewer token must NEVER carry an org — redeeming it must not
		// mint an organization membership.
		expect(reset?.organizationId).toBeNull();

		const outbox = await db.select().from(emailOutbox);
		expect(outbox).toHaveLength(1);
		expect(outbox[0]?.to).toBe("rosa.delgado@example.com");
		expect(outbox[0]?.html).toContain(`/set-password/${reset?.token}`);

		// the loader surfaces the same link as COPYABLE text (no-inbox harness rule)
		const loaded = (await call(
			reviewersLoader,
			await sessionRequest(env, "u_admin", "http://localhost/admin/reviewers"),
		)) as {
			data: {
				reviewers: Array<{ email: string; inviteLink: string | null }>;
			};
		};
		const row = loaded.data.reviewers.find(
			(r) => r.email === "rosa.delgado@example.com",
		);
		expect(row?.inviteLink).toBe(
			`http://localhost/set-password/${reset?.token}`,
		);
	});

	it("re-adding the same email never duplicates the user or demotes an admin", async () => {
		const { db } = await seedEvalBase(env, { withPlan: false });
		await post(
			new URLSearchParams([
				["intent", "add"],
				["name", "Rosa"],
				["email", "rosa@example.com"],
				["trackIds", "t_ai"],
			]),
		);
		await post(
			new URLSearchParams([
				["intent", "add"],
				["name", "Rosa"],
				["email", "rosa@example.com"],
				["trackIds", "t_dx"],
			]),
		);
		const rosaRows = await db
			.select()
			.from(users)
			.where(eq(users.email, "rosa@example.com"));
		expect(rosaRows).toHaveLength(1);

		// adding the org admin as a reviewer must not strip their admin role
		await post(
			new URLSearchParams([
				["intent", "add"],
				["name", "Jordan"],
				["email", "jordan@test.co"],
				["trackIds", "t_ai"],
			]),
		);
		const [jordan] = await db
			.select()
			.from(users)
			.where(eq(users.id, "u_admin"));
		expect(jordan?.role).toBe("admin");
	});

	it("rejects an add with no tracks — routing depends on them", async () => {
		const { db } = await seedEvalBase(env, { withPlan: false });
		const result = (await post(
			new URLSearchParams([
				["intent", "add"],
				["name", "No Tracks"],
				["email", "no.tracks@example.com"],
			]),
		)) as { fieldErrors?: Record<string, string[]> };
		expect(result.fieldErrors?.trackIds?.[0]).toBeTruthy();
		expect(
			await db
				.select()
				.from(users)
				.where(eq(users.email, "no.tracks@example.com")),
		).toHaveLength(0);
	});
});

describe("quick assignment from the reviewers page", () => {
	it("with no plans, assigning creates the Review plan + starter scorecard and mints the queue", async () => {
		const { db } = await seedEvalBase(env, { withPlan: false });
		const result = (await post(
			new URLSearchParams([
				["intent", "assign"],
				["userId", "u_rev"],
				["roundId", "auto"],
				["submissionIds", "s1"],
				["submissionIds", "s2"],
			]),
		)) as { ok?: string };
		expect(result.ok).toContain("Assigned 2");

		const plans = await db.select().from(evaluationPlans);
		expect(plans).toHaveLength(1);
		expect(plans[0]?.eventId).toBe("e1");
		const rounds = await db.select().from(evaluationRounds);
		expect(rounds).toHaveLength(1);
		// starter scorecard: a required rating + an optional comment, so the
		// reviewer can score without any organizer scorecard setup
		const questions = await db.select().from(roundQuestions);
		expect(questions.map((q) => q.type).sort()).toEqual(["rating", "text"]);
		const evals = await db.select().from(evaluations);
		expect(evals.map((e) => e.submissionId).sort()).toEqual(["s1", "s2"]);

		// double-submit: same assignment again mints nothing
		const again = (await post(
			new URLSearchParams([
				["intent", "assign"],
				["userId", "u_rev"],
				["roundId", "auto"],
				["submissionIds", "s1"],
				["submissionIds", "s2"],
			]),
		)) as { ok?: string };
		expect(again.ok).toContain("already assigned");
		expect(await db.select().from(evaluations)).toHaveLength(2);
	});
});

describe("removal", () => {
	it("remove drops tracks, pool rows, and pending work — completed reviews survive", async () => {
		const { db } = await seedEvalBase(env);
		// complete the seeded assignment first
		await db
			.update(evaluations)
			.set({ status: "completed", submittedAt: new Date() })
			.where(eq(evaluations.id, "ev1"));
		await db.insert(evaluations).values({
			id: "ev_pending",
			roundId: "r1",
			submissionId: "s2",
			evaluatorId: "u_rev",
		});
		await post(
			new URLSearchParams([
				["intent", "remove"],
				["userId", "u_rev"],
			]),
		);
		expect(
			await db
				.select()
				.from(reviewerTracks)
				.where(eq(reviewerTracks.userId, "u_rev")),
		).toHaveLength(0);
		const remaining = await db.select().from(evaluations);
		expect(remaining).toHaveLength(1);
		expect(remaining[0]?.status).toBe("completed"); // the record is kept
	});
});
