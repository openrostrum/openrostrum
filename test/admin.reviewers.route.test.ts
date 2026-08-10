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

const post = async (body: URLSearchParams) => {
	// The real forms always echo the loader-minted sendKey; tests that don't
	// pin replay behavior get a fresh one, exactly like a fresh page render.
	if (!body.has("sendKey")) body.set("sendKey", crypto.randomUUID());
	return call(
		reviewersAction,
		await sessionRequest(env, "u_admin", "http://localhost/admin/reviewers", {
			method: "POST",
			body,
		}),
	);
};

describe("reviewer invites (sentinel-hash users + org-less tokens)", () => {
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

	it("a replayed add POST (same sendKey) writes ONE token and sends ONE email", async () => {
		const { db } = await seedEvalBase(env, { withPlan: false });
		const body = new URLSearchParams([
			["intent", "add"],
			["name", "Rosa Delgado"],
			["email", "rosa@example.com"],
			["trackIds", "t_ai"],
			["sendKey", "11111111-2222-4333-8444-555555555555"],
		]);
		await post(body);
		await post(body);

		const [rosa] = await db
			.select()
			.from(users)
			.where(eq(users.email, "rosa@example.com"));
		const tokens = await db
			.select()
			.from(passwordResets)
			.where(eq(passwordResets.userId, rosa?.id ?? ""));
		expect(tokens).toHaveLength(1);
		const outbox = await db.select().from(emailOutbox);
		expect(outbox).toHaveLength(1);
		// The one email carries the one stored token — the copyable link in the
		// table and the emailed link can never diverge on a replay.
		expect(outbox[0]?.html).toContain(`/set-password/${tokens[0]?.token}`);
	});

	it("a replayed re-invite dedupes; a FRESH re-invite (new sendKey) still sends a new link", async () => {
		const { db } = await seedEvalBase(env, { withPlan: false });
		await post(
			new URLSearchParams([
				["intent", "add"],
				["name", "Rosa"],
				["email", "rosa@example.com"],
				["trackIds", "t_ai"],
				["sendKey", "aaaaaaaa-0000-4000-8000-000000000001"],
			]),
		);
		const [rosa] = await db
			.select()
			.from(users)
			.where(eq(users.email, "rosa@example.com"));
		const reinvite = (key: string) =>
			post(
				new URLSearchParams([
					["intent", "reinvite"],
					["userId", rosa?.id ?? ""],
					["sendKey", key],
				]),
			);

		await reinvite("bbbbbbbb-0000-4000-8000-000000000001");
		await reinvite("bbbbbbbb-0000-4000-8000-000000000001"); // the double-click replay
		const afterReplay = await db
			.select()
			.from(passwordResets)
			.where(eq(passwordResets.userId, rosa?.id ?? ""));
		expect(afterReplay).toHaveLength(2); // add's token + ONE re-invite token
		expect(await db.select().from(emailOutbox)).toHaveLength(2);

		// A deliberate later re-send arrives under a fresh loader-minted key.
		await reinvite("bbbbbbbb-0000-4000-8000-000000000002");
		expect(
			await db
				.select()
				.from(passwordResets)
				.where(eq(passwordResets.userId, rosa?.id ?? "")),
		).toHaveLength(3);
		expect(await db.select().from(emailOutbox)).toHaveLength(3);
	});

	it("fails closed on a non-UUID sendKey — a weak key must never derive a guessable token", async () => {
		const { db } = await seedEvalBase(env, { withPlan: false });
		const body = new URLSearchParams([
			["intent", "add"],
			["name", "Weak Key"],
			["email", "weak.key@example.com"],
			["trackIds", "t_ai"],
			["sendKey", "AAAAAAAAAAAAAAAA"],
		]);
		const result = (await call(
			reviewersAction,
			await sessionRequest(env, "u_admin", "http://localhost/admin/reviewers", {
				method: "POST",
				body,
			}),
		)) as { formError?: string };
		expect(result.formError).toBeTruthy();
		expect(
			await db
				.select()
				.from(users)
				.where(eq(users.email, "weak.key@example.com")),
		).toHaveLength(0);
		expect(await db.select().from(emailOutbox)).toHaveLength(0);
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

describe("quick assignment never targets a locked round", () => {
	it("with only a CLOSED plan, auto-assign creates a fresh writable round", async () => {
		const { db } = await seedEvalBase(env); // plan1/r1 exist and are open
		await db
			.update(evaluationPlans)
			.set({ status: "closed" })
			.where(eq(evaluationPlans.id, "plan1"));
		const result = (await post(
			new URLSearchParams([
				["intent", "assign"],
				["userId", "u_rev"],
				["roundId", "auto"],
				["submissionIds", "s2"],
			]),
		)) as { ok?: string };
		expect(result.ok).toContain("Assigned 1");
		const [row] = await db
			.select()
			.from(evaluations)
			.where(eq(evaluations.submissionId, "s2"));
		// minted into a NEW writable round, not the locked plan's r1
		expect(row?.roundId).not.toBe("r1");
		const plans = await db.select().from(evaluationPlans);
		expect(plans).toHaveLength(2);
	});

	it("rejects a principal outside the event reviewer registry", async () => {
		const { db } = await seedEvalBase(env);
		const result = (await post(
			new URLSearchParams([
				["intent", "assign"],
				["userId", "u_speaker"], // not a reviewer on this event
				["roundId", "r1"],
				["submissionIds", "s2"],
			]),
		)) as { formError?: string };
		expect(result.formError).toBeTruthy();
		expect(
			await db
				.select()
				.from(evaluations)
				.where(eq(evaluations.evaluatorId, "u_speaker")),
		).toHaveLength(0);
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
