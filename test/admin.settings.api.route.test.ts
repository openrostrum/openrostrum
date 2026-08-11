import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "../app/db";
import {
	apiTokens,
	events,
	organizationMembers,
	organizations,
	users,
} from "../app/db/schema";
import { authenticateApiToken, sha256Hex } from "../app/lib/api-token";
import { createSession, hashPassword } from "../app/lib/auth";
import { action, loader } from "../app/routes/admin.settings.api";

// Org API tokens: minted show-once (only the SHA-256 persists), scoped to the
// caller's organization on every read and write, honoring per-token event
// restrictions — and a token another org minted can never be seen or revoked.

const CONTEXT = { cloudflare: { env, ctx: {} } };
const URL_ = "http://localhost/admin/settings/api";

async function seedOrg(
	suffix: "A" | "B",
	{ withEvent = true }: { withEvent?: boolean } = {},
) {
	const db = getDb(env);
	await db
		.insert(organizations)
		.values({ id: `org${suffix}`, name: `Org ${suffix}` });
	if (withEvent) {
		await db.insert(events).values({
			id: `e${suffix}`,
			organizationId: `org${suffix}`,
			name: `Event ${suffix}`,
			slug: `e${suffix.toLowerCase()}`,
		});
	}
	await db.insert(users).values({
		id: `u${suffix}`,
		email: `admin${suffix}@test.co`,
		passwordHash: await hashPassword("pw"),
		role: "admin",
		activeEventId: withEvent ? `e${suffix}` : null,
	});
	await db.insert(organizationMembers).values({
		id: `om${suffix}`,
		organizationId: `org${suffix}`,
		userId: `u${suffix}`,
	});
	return db;
}

async function authedRequest(
	userId: string,
	init?: RequestInit,
): Promise<Request> {
	const setCookie = await createSession(env, userId);
	const headers = new Headers(init?.headers);
	headers.set("Cookie", setCookie.split(";")[0] ?? "");
	return new Request(URL_, { ...init, headers });
}

function post(body: Record<string, string>) {
	return { method: "POST", body: new URLSearchParams(body) };
}

type ActionData = {
	created?: { name: string; raw: string };
	fieldErrors?: Record<string, string[] | undefined>;
	formError?: string;
	revoked?: boolean;
};

async function runAction(request: Request): Promise<Response | ActionData> {
	const result = await action({
		context: CONTEXT,
		request,
		params: {},
	} as unknown as Parameters<typeof action>[0]);
	if (result instanceof Response) return result;
	// Server-Timing-carrying results arrive wrapped by data(); unwrap them.
	const maybeWrapped = result as { data?: ActionData };
	return maybeWrapped.data ?? (result as ActionData);
}

async function runLoader(userId: string) {
	const result = (await loader({
		context: CONTEXT,
		request: await authedRequest(userId),
		params: {},
	} as unknown as Parameters<typeof loader>[0])) as {
		data: {
			org: { id: string } | null;
			tokens?: Array<{ id: string; name: string; scope: string }>;
		};
	};
	return result.data;
}

async function createToken(userId: string, body: Record<string, string>) {
	const result = await runAction(await authedRequest(userId, post(body)));
	if (result instanceof Response)
		throw new Error("expected data, got redirect");
	return result;
}

describe("API tokens settings", () => {
	it("mints a token shown once, storing only its SHA-256 — and the raw value authenticates", async () => {
		const db = await seedOrg("A");
		const result = await createToken("uA", { name: "CI export", eventId: "" });
		const raw = result.created?.raw;
		expect(raw).toMatch(/^or_[0-9a-f]{32}$/);

		const [row] = await db
			.select()
			.from(apiTokens)
			.where(eq(apiTokens.organizationId, "orgA"));
		expect(row?.name).toBe("CI export");
		expect(row?.tokenHash).toBe(await sha256Hex(raw as string));
		expect(row?.eventId).toBeNull();

		// The minted value is a working credential for the compat API.
		const principal = await authenticateApiToken(env, raw as string);
		expect(principal?.organizationId).toBe("orgA");
		expect(principal?.eventId).toBeNull();
	});

	it("honors a per-token event restriction, refusing another org's event id", async () => {
		await seedOrg("A");
		await seedOrg("B");

		const restricted = await createToken("uA", {
			name: "Event-only",
			eventId: "eA",
		});
		const principal = await authenticateApiToken(
			env,
			restricted.created?.raw as string,
		);
		expect(principal?.eventId).toBe("eA");

		const forged = await createToken("uA", {
			name: "Forged",
			eventId: "eB",
		});
		expect(forged.created).toBeUndefined();
		expect(forged.fieldErrors?.eventId?.[0]).toContain(
			"doesn't exist in this organization",
		);
	});

	it("requires a token name", async () => {
		await seedOrg("A");
		const result = await createToken("uA", { name: "   ", eventId: "" });
		expect(result.created).toBeUndefined();
		expect(result.fieldErrors?.name?.[0]).toBeTruthy();
	});

	it("revokes a token — the credential stops authenticating immediately", async () => {
		const db = await seedOrg("A");
		const created = await createToken("uA", { name: "Doomed", eventId: "" });
		const [row] = await db
			.select({ id: apiTokens.id })
			.from(apiTokens)
			.where(eq(apiTokens.organizationId, "orgA"));

		const result = await runAction(
			await authedRequest("uA", post({ revoke: row?.id as string })),
		);
		expect(result instanceof Response).toBe(false);
		if (!(result instanceof Response)) expect(result.revoked).toBe(true);
		expect(
			await authenticateApiToken(env, created.created?.raw as string),
		).toBeNull();
	});

	it("never lists another org's tokens", async () => {
		await seedOrg("A");
		await seedOrg("B");
		await createToken("uA", { name: "Org A only", eventId: "" });

		const orgB = await runLoader("uB");
		expect(orgB.org?.id).toBe("orgB");
		expect(orgB.tokens).toEqual([]);
	});

	it("refuses to revoke another org's token AND the row survives", async () => {
		const db = await seedOrg("A");
		await seedOrg("B");
		await createToken("uA", { name: "Org A only", eventId: "" });
		const [row] = await db
			.select({ id: apiTokens.id })
			.from(apiTokens)
			.where(eq(apiTokens.organizationId, "orgA"));

		const result = await runAction(
			await authedRequest("uB", post({ revoke: row?.id as string })),
		);
		expect(result instanceof Response).toBe(false);
		if (!(result instanceof Response)) {
			expect(result.formError).toContain("no longer exists");
		}
		const survivors = await db
			.select()
			.from(apiTokens)
			.where(eq(apiTokens.organizationId, "orgA"));
		expect(survivors).toHaveLength(1);
	});
});
