import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { getDb } from "../app/db";
import { apiTokens, events, organizations } from "../app/db/schema";
import {
	authenticateApiToken,
	resolveApiTokenEvent,
	sha256Hex,
} from "../app/lib/api-token";

// Token → tenant resolution for the compat API: tokens are organization-scoped,
// optionally restricted to one event; org A's token must never read org B's data.

// The seeded judge token from drizzle/seed.sql / docs/JUDGING.md — pinning the
// pair proves the documented raw value really resolves against the seed row.
const SEED_RAW = "kms-demo-api-token";
const SEED_HASH =
	"4d8bfefbee32ccc1ca5ac38e161464666eaba9ef881e1969de204aeab0470b43";

async function seedTokens(): Promise<void> {
	const db = getDb(env);
	await db.insert(organizations).values([
		{ id: "org_a", name: "Org A" },
		{ id: "org_b", name: "Org B" },
	]);
	await db.insert(events).values([
		{ id: "e_a1", organizationId: "org_a", name: "A1", slug: "a1" },
		{ id: "e_a2", organizationId: "org_a", name: "A2", slug: "a2" },
		{ id: "e_b1", organizationId: "org_b", name: "B1", slug: "b1" },
	]);
	await db.insert(apiTokens).values([
		{
			id: "tok_all",
			organizationId: "org_a",
			name: "all org A events",
			tokenHash: await sha256Hex("raw-token-all"),
		},
		{
			id: "tok_one",
			organizationId: "org_a",
			name: "restricted to e_a2",
			eventId: "e_a2",
			tokenHash: await sha256Hex("raw-token-one"),
		},
	]);
}

describe("sha256Hex", () => {
	it("matches the seeded judge token's stored hash", async () => {
		expect(await sha256Hex(SEED_RAW)).toBe(SEED_HASH);
	});
});

describe("authenticateApiToken", () => {
	it("resolves a valid raw token to its org and stamps lastUsedAt", async () => {
		await seedTokens();
		const principal = await authenticateApiToken(env, "raw-token-all");
		expect(principal).toEqual({
			id: "tok_all",
			organizationId: "org_a",
			eventId: null,
		});
		const row = await getDb(env).query.apiTokens.findFirst({
			where: (t, { eq }) => eq(t.id, "tok_all"),
		});
		expect(row?.lastUsedAt).not.toBeNull();
	});

	it("carries the per-token event restriction", async () => {
		await seedTokens();
		const principal = await authenticateApiToken(env, "raw-token-one");
		expect(principal?.eventId).toBe("e_a2");
	});

	it("returns null for an unknown token", async () => {
		await seedTokens();
		expect(await authenticateApiToken(env, "no-such-token")).toBeNull();
	});
});

describe("resolveApiTokenEvent", () => {
	it("unrestricted token resolves its org's events, never another org's", async () => {
		await seedTokens();
		const principal = await authenticateApiToken(env, "raw-token-all");
		expect((await resolveApiTokenEvent(env, principal!, "e_a1"))?.id).toBe(
			"e_a1",
		);
		expect((await resolveApiTokenEvent(env, principal!, "e_a2"))?.id).toBe(
			"e_a2",
		);
		expect(await resolveApiTokenEvent(env, principal!, "e_b1")).toBeNull();
	});

	it("event-restricted token resolves only that event", async () => {
		await seedTokens();
		const principal = await authenticateApiToken(env, "raw-token-one");
		expect((await resolveApiTokenEvent(env, principal!, "e_a2"))?.id).toBe(
			"e_a2",
		);
		expect(await resolveApiTokenEvent(env, principal!, "e_a1")).toBeNull();
	});

	it("fails closed when the restriction names another org's event", async () => {
		// api_tokens.event_id has no same-org constraint in SQL — a misconfigured
		// row must resolve nothing, never a cross-org grant.
		await seedTokens();
		const db = getDb(env);
		await db.insert(apiTokens).values({
			id: "tok_bad",
			organizationId: "org_a",
			name: "misconfigured",
			eventId: "e_b1",
			tokenHash: await sha256Hex("raw-token-bad"),
		});
		const principal = await authenticateApiToken(env, "raw-token-bad");
		expect(await resolveApiTokenEvent(env, principal!, "e_b1")).toBeNull();
	});
});
