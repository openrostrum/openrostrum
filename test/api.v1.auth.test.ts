import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "../app/db";
import {
	apiTokens,
	events,
	organizations,
	submissions,
} from "../app/db/schema";
import { api, apiJson, RAW_TOKENS, seedApiFixtures } from "./api-v1-fixtures";

// Auth + tenancy law for /api/v1 (docs/multi-tenancy-design.md): the
// x-access-token resolves an org-scoped principal; anything outside the
// token's readable set is an existence-hiding 404, never an empty 200.

beforeEach(seedApiFixtures);

describe("token auth matrix", () => {
	it("rejects a request without a token with 401 and the spec error envelope", async () => {
		const { status, json } = await apiJson("/api/v1/events");
		expect(status).toBe(401);
		expect(json).toMatchObject({ error: "unauthorized" });
		expect(typeof json.message).toBe("string");
	});

	it("rejects an unknown token with 401", async () => {
		const { status } = await apiJson("/api/v1/events", {
			token: "no-such-token",
		});
		expect(status).toBe(401);
	});

	it("serves an authenticated read with a valid token", async () => {
		const { status } = await apiJson("/api/v1/event/e_a1/sessions", {
			token: RAW_TOKENS.orgA,
			body: {},
		});
		expect(status).toBe(200);
	});

	it("authenticates even unknown paths — no surface enumeration without credentials", async () => {
		const anon = await api("/api/v1/gdpr/requests");
		expect(anon.status).toBe(401);
		const authed = await api("/api/v1/gdpr/requests", {
			token: RAW_TOKENS.orgA,
		});
		expect(authed.status).toBe(404);
	});

	it("stamps lastUsedAt on a successful request", async () => {
		await api("/api/v1/events", { token: RAW_TOKENS.orgA });
		const row = await getDb(env).query.apiTokens.findFirst({
			where: (t, { eq }) => eq(t.id, "tok_a"),
		});
		expect(row?.lastUsedAt).not.toBeNull();
	});
});

describe("org scoping", () => {
	it("org A's token reading org B's event gets the same 404 as a nonexistent event", async () => {
		const crossOrg = await apiJson("/api/v1/event/e_b1/sessions", {
			token: RAW_TOKENS.orgA,
			body: {},
		});
		const missing = await apiJson("/api/v1/event/no_such_event/sessions", {
			token: RAW_TOKENS.orgA,
			body: {},
		});
		expect(crossOrg.status).toBe(404);
		expect(missing.status).toBe(404);
		// Existence-hiding: the two denials must be indistinguishable.
		expect(crossOrg.json).toEqual(missing.json);
	});

	it("org B's token cannot read org A records by id through its own surface", async () => {
		const { status } = await apiJson(
			"/api/v1/event/e_a1/sessions/sub_accepted",
			{ token: RAW_TOKENS.orgB },
		);
		expect(status).toBe(404);
	});

	it("GET /events lists only the token's org's events", async () => {
		const a = await apiJson<{ results: { id: string }[] }>("/api/v1/events", {
			token: RAW_TOKENS.orgA,
		});
		expect(a.json.results.map((e) => e.id).sort()).toEqual(["e_a1", "e_a2"]);
		const b = await apiJson<{ results: { id: string }[] }>("/api/v1/events", {
			token: RAW_TOKENS.orgB,
		});
		expect(b.json.results.map((e) => e.id)).toEqual(["e_b1"]);
	});
});

describe("per-token event restriction", () => {
	it("restricted token reads its event and 404s on a sibling event of the SAME org", async () => {
		const allowed = await api("/api/v1/event/e_a2/sessions", {
			token: RAW_TOKENS.restrictedToA2,
			body: {},
		});
		expect(allowed.status).toBe(200);
		const denied = await api("/api/v1/event/e_a1/sessions", {
			token: RAW_TOKENS.restrictedToA2,
			body: {},
		});
		expect(denied.status).toBe(404);
	});

	it("restricted token's /events lists only the restricted event", async () => {
		const { json } = await apiJson<{ results: { id: string }[] }>(
			"/api/v1/events",
			{ token: RAW_TOKENS.restrictedToA2 },
		);
		expect(json.results.map((e) => e.id)).toEqual(["e_a2"]);
	});
});

describe("seeded judge token", () => {
	it("the documented raw value resolves against the seed row and reads e_demo", async () => {
		// Same rows as drizzle/seed.sql — raw value documented in docs/JUDGING.md.
		const db = getDb(env);
		await db.insert(organizations).values({ id: "org_demo", name: "Demo" });
		await db.insert(events).values({
			id: "e_demo",
			organizationId: "org_demo",
			name: "AI.Engineer Sandbox Event",
			slug: "ai-engineer-sandbox",
		});
		await db.insert(apiTokens).values({
			id: "apitok_demo",
			organizationId: "org_demo",
			name: "Demo token",
			tokenHash:
				"4d8bfefbee32ccc1ca5ac38e161464666eaba9ef881e1969de204aeab0470b43",
		});
		const { status, json } = await apiJson<{ results: { id: string }[] }>(
			"/api/v1/events",
			{ token: "kms-demo-api-token" },
		);
		expect(status).toBe(200);
		expect(json.results.map((e) => e.id)).toEqual(["e_demo"]);
	});
});

describe("read-only surface", () => {
	it("PUT/PATCH/DELETE get 405 and mutate nothing", async () => {
		for (const method of ["PUT", "PATCH", "DELETE"]) {
			const { status, json } = await apiJson(
				"/api/v1/event/e_a1/sessions/sub_accepted",
				{
					method,
					token: RAW_TOKENS.orgA,
					body: method === "DELETE" ? undefined : { title: "Hacked" },
				},
			);
			expect(status).toBe(405);
			expect(json).toMatchObject({ error: "method_not_allowed" });
		}
		const row = await getDb(env).query.submissions.findFirst({
			where: (s, { eq }) => eq(s.id, "sub_accepted"),
		});
		expect(row?.title).toBe("Accepted talk");
	});

	it("Sessionboard's POST write suffixes (/create, /bulk, /restore) get 405 and create nothing", async () => {
		const db = getDb(env);
		const before = await db.$count(submissions);
		for (const path of [
			"/api/v1/event/e_a1/sessions/create",
			"/api/v1/event/e_a1/sessions/bulk",
			"/api/v1/event/e_a1/contacts/create",
			"/api/v1/event/e_a1/sessions/sub_accepted/restore",
		]) {
			const { status } = await apiJson(path, {
				method: "POST",
				token: RAW_TOKENS.orgA,
				body: { title: "Injected" },
			});
			expect(status).toBe(405);
		}
		expect(await db.$count(submissions)).toBe(before);
	});

	it("write attempts without a token still fail closed with 401", async () => {
		const { status } = await apiJson(
			"/api/v1/event/e_a1/sessions/sub_accepted",
			{ method: "PUT", body: { title: "Hacked" } },
		);
		expect(status).toBe(401);
	});
});
