import { env } from "cloudflare:test";
import { createElement, type ComponentType } from "react";
import { renderToString } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
	contacts,
	emailOutbox,
	evaluationPlans,
	evaluationRounds,
	evaluations,
	events,
	organizationMembers,
	organizations,
	passwordResets,
	reviewerTracks,
	roundQuestions,
	tracks,
	users,
} from "../app/db/schema";
import { hashPassword, verifyPassword } from "../app/lib/auth";
import Reviewers, {
	action as reviewersAction,
	loader as reviewersLoader,
} from "../app/routes/admin.reviewers";
import { action as setPasswordAction } from "../app/routes/set-password.$token";
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

	it("the invite cell shows the full https token, not a 28-character prefix", async () => {
		const { db } = await seedEvalBase(env, { withPlan: false });
		await post(
			new URLSearchParams([
				["intent", "add"],
				["name", "Rosa Delgado"],
				["email", "rosa.delgado@example.com"],
				["trackIds", "t_ai"],
			]),
		);
		const [reset] = await db.select().from(passwordResets);
		const loaded = (await call(
			reviewersLoader,
			await sessionRequest(env, "u_admin", "http://localhost/admin/reviewers"),
		)) as { data: unknown };
		const RouteComponent = Reviewers as unknown as ComponentType<{
			loaderData: unknown;
			actionData: undefined;
		}>;
		const RoutesStub = createRoutesStub([
			{
				path: "/admin/reviewers",
				Component: () =>
					createElement(RouteComponent, {
						loaderData: loaded.data,
						actionData: undefined,
					}),
			},
		]);
		const html = renderToString(
			createElement(RoutesStub, {
				initialEntries: ["/admin/reviewers"],
			}),
		);
		const full = `http://localhost/set-password/${reset?.token}`;
		expect(html).toContain(full);
		expect(html).not.toMatch(/size="28"/);
		expect(html).not.toMatch(/size={28}/);
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

	it("adds a reviewer with zero tracks and does not 4xx", async () => {
		const { db } = await seedEvalBase(env, { withPlan: false });
		const response = (await post(
			new URLSearchParams([
				["intent", "add"],
				["name", "Lena Fischer"],
				["email", "lena.fischer@example.com"],
			]),
		)) as Response;
		expect(response.status).toBe(302);

		const [lena] = await db
			.select()
			.from(users)
			.where(eq(users.email, "lena.fischer@example.com"));
		expect(lena?.role).toBe("reviewer");
		expect(
			await db
				.select()
				.from(reviewerTracks)
				.where(eq(reviewerTracks.userId, lena?.id ?? "")),
		).toHaveLength(0);

		const loaded = (await call(
			reviewersLoader,
			await sessionRequest(env, "u_admin", "http://localhost/admin/reviewers"),
		)) as {
			data: {
				reviewers: Array<{ email: string; tracks: unknown[] }>;
			};
		};
		const row = loaded.data.reviewers.find(
			(r) => r.email === "lena.fischer@example.com",
		);
		expect(row).toBeTruthy();
		expect(row?.tracks).toEqual([]);
	});

	it("adds a reviewer when the event has no tracks at all", async () => {
		const { db } = await seedEvalBase(env, { withPlan: false });
		await db.delete(tracks);
		const response = (await post(
			new URLSearchParams([
				["intent", "add"],
				["name", "No Library"],
				["email", "no.library@example.com"],
			]),
		)) as Response;
		expect(response.status).toBe(302);
		expect(
			await db
				.select()
				.from(users)
				.where(eq(users.email, "no.library@example.com")),
		).toHaveLength(1);
	});
});

// A reviewer who already has a working password used to render a bare "—" in
// the invite-link column with no action anywhere on the row — an organizer
// with no access to that person's inbox had no way to get them signed in. The
// credential path must never dead-end.
describe("active reviewers can still be handed a working link", () => {
	const activate = async (
		db: Awaited<ReturnType<typeof seedEvalBase>>["db"],
		userId: string,
	) =>
		db
			.update(users)
			.set({ passwordHash: await hashPassword("OldPassword1") })
			.where(eq(users.id, userId));

	const signinLink = (userId: string, sendKey?: string) =>
		post(
			new URLSearchParams([
				["intent", "signin-link"],
				["userId", userId],
				...(sendKey ? [["sendKey", sendKey]] : []),
			]),
		) as Promise<{
			ok?: string;
			formError?: string;
			link?: string;
			userId?: string;
		}>;

	const loadReviewers = async () => {
		const loaded = (await call(
			reviewersLoader,
			await sessionRequest(env, "u_admin", "http://localhost/admin/reviewers"),
		)) as {
			data: {
				reviewers: Array<{
					id: string;
					invited: boolean;
					inviteLink: string | null;
				}>;
			};
		};
		return loaded.data.reviewers;
	};

	it("mints a copyable, redeemable link that also lands in their inbox", async () => {
		const { db } = await seedEvalBase(env, { withPlan: false });
		await activate(db, "u_rev");
		// Precondition: today this row shows no link at all.
		expect(
			(await loadReviewers()).find((r) => r.id === "u_rev")?.inviteLink,
		).toBeNull();

		const result = await signinLink("u_rev");
		expect(result.formError).toBeUndefined();
		expect(result.userId).toBe("u_rev");
		expect(result.link).toMatch(
			/^http:\/\/localhost\/set-password\/[0-9a-f]{64}$/,
		);

		const [reset] = await db
			.select()
			.from(passwordResets)
			.where(eq(passwordResets.userId, "u_rev"));
		// NULL org: redeeming it must never mint an organization membership.
		expect(reset?.organizationId).toBeNull();
		expect(result.link).toContain(reset?.token ?? "no-token");

		const outbox = await db.select().from(emailOutbox);
		expect(outbox).toHaveLength(1);
		expect(outbox[0]?.to).toBe("sam@test.co");
		expect(outbox[0]?.html).toContain(`/set-password/${reset?.token}`);

		// The link actually works: it signs them in on the reviewer surface.
		const redeemed = (await setPasswordAction({
			context: CONTEXT,
			request: new Request(
				`http://localhost/set-password/${reset?.token ?? ""}`,
				{
					method: "POST",
					body: new URLSearchParams({
						password: "BrandNewPass1",
						confirm: "BrandNewPass1",
					}),
				},
			),
			params: { token: reset?.token ?? "" },
		} as never)) as Response;
		expect(redeemed.status).toBe(302);
		expect(redeemed.headers.get("Location")).toBe("/reviews");
		expect(await db.select().from(organizationMembers)).toHaveLength(1); // u_admin's only
		const [sam] = await db.select().from(users).where(eq(users.id, "u_rev"));
		expect(await verifyPassword("BrandNewPass1", sam?.passwordHash ?? "")).toBe(
			true,
		);
	});

	it("refuses an account that also has standing in another organization", async () => {
		const { db } = await seedEvalBase(env, { withPlan: false });
		await activate(db, "u_rev");
		// Sam is an admin of somebody else's org. Minting a reset link here would
		// hand THIS org's admin a takeover of THAT org.
		await db.insert(organizations).values({ id: "org2", name: "Other Org" });
		await db
			.insert(organizationMembers)
			.values({ organizationId: "org2", userId: "u_rev" });

		const result = await signinLink("u_rev");
		expect(result.link).toBeUndefined();
		expect(result.formError).toContain("outside");
		expect(await db.select().from(passwordResets)).toHaveLength(0);
		expect(await db.select().from(emailOutbox)).toHaveLength(0);
	});

	it("refuses when the account speaks at another organization's event", async () => {
		const { db } = await seedEvalBase(env, { withPlan: false });
		await activate(db, "u_rev");
		await db.insert(organizations).values({ id: "org2", name: "Other Org" });
		await db.insert(events).values({
			id: "e2",
			organizationId: "org2",
			name: "Other Conf",
			slug: "other",
		});
		await db.insert(contacts).values({
			id: "c_sam_other",
			eventId: "e2",
			userId: "u_rev",
			email: "sam@test.co",
			firstName: "Sam",
			lastName: "Whitfield",
		});

		const result = await signinLink("u_rev");
		expect(result.link).toBeUndefined();
		expect(result.formError).toContain("outside");
		expect(await db.select().from(passwordResets)).toHaveLength(0);
	});

	it("refuses when the account reviews for another organization's event", async () => {
		const { db } = await seedEvalBase(env, { withPlan: false });
		await activate(db, "u_rev");
		await db.insert(organizations).values({ id: "org2", name: "Other Org" });
		await db.insert(events).values({
			id: "e2",
			organizationId: "org2",
			name: "Other Conf",
			slug: "other",
		});
		await db
			.insert(tracks)
			.values({ id: "t_other", eventId: "e2", name: "Other", color: "#000" });
		await db
			.insert(reviewerTracks)
			.values({ userId: "u_rev", trackId: "t_other" });

		const result = await signinLink("u_rev");
		expect(result.link).toBeUndefined();
		expect(result.formError).toContain("outside");
		expect(await db.select().from(passwordResets)).toHaveLength(0);
	});

	it("refuses a principal who is not a reviewer on this event", async () => {
		const { db } = await seedEvalBase(env, { withPlan: false });
		await activate(db, "u_speaker");
		const result = await signinLink("u_speaker");
		expect(result.formError).toBe("Reviewer not found.");
		expect(await db.select().from(passwordResets)).toHaveLength(0);
		expect(await db.select().from(emailOutbox)).toHaveLength(0);
	});

	it("points an invited reviewer at their invite link instead", async () => {
		const { db } = await seedEvalBase(env, { withPlan: false });
		const result = await signinLink("u_rev"); // still on the sentinel hash
		expect(result.link).toBeUndefined();
		expect(result.formError).toContain("invite");
		expect(await db.select().from(passwordResets)).toHaveLength(0);
	});

	it("fails closed on a non-UUID sendKey", async () => {
		const { db } = await seedEvalBase(env, { withPlan: false });
		await activate(db, "u_rev");
		const result = await signinLink("u_rev", "AAAAAAAAAAAAAAAA");
		expect(result.formError).toContain("stale");
		expect(result.link).toBeUndefined();
		expect(await db.select().from(passwordResets)).toHaveLength(0);
		expect(await db.select().from(emailOutbox)).toHaveLength(0);
	});

	it("a replayed click (same sendKey) writes ONE token and sends ONE email", async () => {
		const { db } = await seedEvalBase(env, { withPlan: false });
		await activate(db, "u_rev");
		const key = "cccccccc-0000-4000-8000-000000000001";
		const first = await signinLink("u_rev", key);
		const second = await signinLink("u_rev", key);
		expect(await db.select().from(passwordResets)).toHaveLength(1);
		expect(await db.select().from(emailOutbox)).toHaveLength(1);
		// The replay shows the SAME link, so a double-click can't strand the
		// organizer with a link that was never delivered.
		expect(second.link).toBe(first.link);
	});
});

describe("invite links expire and get consumed", () => {
	it("an expired invite token stops being offered as a copyable link", async () => {
		const { db } = await seedEvalBase(env, { withPlan: false });
		await post(
			new URLSearchParams([
				["intent", "add"],
				["name", "Rosa"],
				["email", "rosa@example.com"],
				["trackIds", "t_ai"],
			]),
		);
		const [rosa] = await db
			.select()
			.from(users)
			.where(eq(users.email, "rosa@example.com"));
		const read = async () => {
			const loaded = (await call(
				reviewersLoader,
				await sessionRequest(
					env,
					"u_admin",
					"http://localhost/admin/reviewers",
				),
			)) as {
				data: {
					reviewers: Array<{
						id: string;
						invited: boolean;
						inviteLink: string | null;
					}>;
				};
			};
			return loaded.data.reviewers.find((r) => r.id === rosa?.id);
		};
		expect((await read())?.inviteLink).toBeTruthy();

		await db
			.update(passwordResets)
			.set({ expiresAt: new Date(Date.now() - 1000) })
			.where(eq(passwordResets.userId, rosa?.id ?? ""));
		const expired = await read();
		expect(expired?.inviteLink).toBeNull();
		// …and the row still offers a way back: they remain "Invited", which is
		// what renders the Re-invite control.
		expect(expired?.invited).toBe(true);
	});

	it("a consumed invite token stops being offered, and the reviewer reads as active", async () => {
		const { db } = await seedEvalBase(env, { withPlan: false });
		await post(
			new URLSearchParams([
				["intent", "add"],
				["name", "Rosa"],
				["email", "rosa@example.com"],
				["trackIds", "t_ai"],
			]),
		);
		const [rosa] = await db
			.select()
			.from(users)
			.where(eq(users.email, "rosa@example.com"));
		const [reset] = await db
			.select()
			.from(passwordResets)
			.where(eq(passwordResets.userId, rosa?.id ?? ""));

		const redeemed = (await setPasswordAction({
			context: CONTEXT,
			request: new Request(
				`http://localhost/set-password/${reset?.token ?? ""}`,
				{
					method: "POST",
					body: new URLSearchParams({
						password: "FirstPassword1",
						confirm: "FirstPassword1",
					}),
				},
			),
			params: { token: reset?.token ?? "" },
		} as never)) as Response;
		expect(redeemed.headers.get("Location")).toBe("/reviews");

		const loaded = (await call(
			reviewersLoader,
			await sessionRequest(env, "u_admin", "http://localhost/admin/reviewers"),
		)) as {
			data: {
				reviewers: Array<{
					id: string;
					invited: boolean;
					inviteLink: string | null;
				}>;
			};
		};
		const row = loaded.data.reviewers.find((r) => r.id === rosa?.id);
		expect(row?.invited).toBe(false);
		expect(row?.inviteLink).toBeNull();
	});
});

describe("adding someone who already has an account", () => {
	it("keeps their password, marks them active, and tells them they're a reviewer", async () => {
		const { db } = await seedEvalBase(env, { withPlan: false });
		await db.insert(users).values({
			id: "u_existing",
			email: "dana@test.co",
			passwordHash: await hashPassword("TheirOwnPass1"),
			name: "Dana Kowalski",
			role: "speaker",
		});
		const response = (await post(
			new URLSearchParams([
				["intent", "add"],
				["name", "Dana K."],
				["email", "Dana@Test.co"],
				["trackIds", "t_ai"],
			]),
		)) as Response;
		expect(response.status).toBe(302);

		const rows = await db
			.select()
			.from(users)
			.where(eq(users.email, "dana@test.co"));
		expect(rows).toHaveLength(1);
		expect(
			await verifyPassword("TheirOwnPass1", rows[0]?.passwordHash ?? ""),
		).toBe(true);
		// No invite token — their existing password still works.
		expect(await db.select().from(passwordResets)).toHaveLength(0);
		const outbox = await db.select().from(emailOutbox);
		expect(outbox).toHaveLength(1);
		expect(outbox[0]?.subject).toContain("now a reviewer");

		// …and the organizer is not stranded: the row offers a fresh link.
		const result = (await post(
			new URLSearchParams([
				["intent", "signin-link"],
				["userId", "u_existing"],
			]),
		)) as { link?: string; formError?: string };
		expect(result.formError).toBeUndefined();
		expect(result.link).toContain("/set-password/");
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
