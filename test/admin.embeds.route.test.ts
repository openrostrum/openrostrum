import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { getDb } from "../app/db";
import { embeds, users } from "../app/db/schema";
import { createSession, hashPassword } from "../app/lib/auth";
import {
	action as detailAction,
	loader as detailLoader,
} from "../app/routes/admin.embeds.$id";
import { action as listAction } from "../app/routes/admin.embeds";
import { CONTEXT, seedProgram, thrownStatus } from "./program.fixtures";

async function adminRequest(url: string, init?: RequestInit): Promise<Request> {
	const db = getDb(env);
	await db.insert(users).values({
		id: "u_admin",
		email: "admin@test.co",
		passwordHash: await hashPassword("pw"),
		role: "admin",
		activeEventId: "e1",
	});
	const setCookie = await createSession(env, "u_admin");
	const headers = new Headers(init?.headers);
	headers.set("Cookie", setCookie.split(";")[0] ?? "");
	return new Request(url, { ...init, headers });
}

describe("embeds admin", () => {
	it("rejects an unauthenticated create (redirects to login, writes nothing)", async () => {
		await seedProgram();
		const body = new URLSearchParams({
			intent: "create",
			name: "Sneaky",
			type: "sessions",
		});
		await listAction({
			context: CONTEXT,
			request: new Request("http://localhost/admin/embeds", {
				method: "POST",
				body,
			}),
			params: {},
		} as never).then(
			() => {
				throw new Error("expected an auth redirect");
			},
			(error) => {
				expect(error).toBeInstanceOf(Response);
				expect((error as Response).status).toBe(302);
				expect((error as Response).headers.get("Location")).toContain("/login");
			},
		);
		const rows = await getDb(env).select().from(embeds);
		expect(rows.map((r) => r.name)).not.toContain("Sneaky");
	});

	it("creates an embed with a minted publicId and a server-derived event", async () => {
		await seedProgram();
		const body = new URLSearchParams({
			intent: "create",
			name: "Homepage agenda",
			type: "agenda",
		});
		const request = await adminRequest("http://localhost/admin/embeds", {
			method: "POST",
			body,
		});
		const response = (await listAction({
			context: CONTEXT,
			request,
			params: {},
		} as never)) as Response;
		expect(response.status).toBe(302);
		expect(response.headers.get("Location")).toMatch(/^\/admin\/embeds\/.+/);
		const row = (await getDb(env).select().from(embeds)).find(
			(r) => r.name === "Homepage agenda",
		);
		expect(row?.eventId).toBe("e1");
		expect(row?.type).toBe("agenda");
		expect(row?.publicId).toBeTruthy();
		expect(row?.enabled).toBe(true);
	});

	it("rejects a blank name with a field error and writes nothing", async () => {
		await seedProgram();
		const body = new URLSearchParams({
			intent: "create",
			name: "",
			type: "sessions",
		});
		const request = await adminRequest("http://localhost/admin/embeds", {
			method: "POST",
			body,
		});
		const result = (await listAction({
			context: CONTEXT,
			request,
			params: {},
		} as never)) as { fieldErrors?: { name?: string[] } };
		expect(result.fieldErrors?.name?.[0]).toBeTruthy();
		const rows = await getDb(env).select().from(embeds);
		expect(rows).toHaveLength(2); // just the fixtures
	});

	it("toggle flips enabled; delete removes the row", async () => {
		await seedProgram();
		const toggleReq = await adminRequest("http://localhost/admin/embeds", {
			method: "POST",
			body: new URLSearchParams({ intent: "toggle", id: "emb1" }),
		});
		await listAction({
			context: CONTEXT,
			request: toggleReq,
			params: {},
		} as never);
		const db = getDb(env);
		let rows = await db.select().from(embeds);
		expect(rows.find((r) => r.id === "emb1")?.enabled).toBe(false);

		const deleteReq = new Request("http://localhost/admin/embeds", {
			method: "POST",
			body: new URLSearchParams({ intent: "delete", id: "emb1" }),
			headers: { Cookie: toggleReq.headers.get("Cookie") ?? "" },
		});
		await listAction({
			context: CONTEXT,
			request: deleteReq,
			params: {},
		} as never);
		rows = await db.select().from(embeds);
		expect(rows.map((r) => r.id)).not.toContain("emb1");
	});

	it("update persists config with only known ids/fields; junk is dropped", async () => {
		await seedProgram();
		const body = new URLSearchParams({
			name: "Filtered sessions v2",
			enabled: "on",
			accentColor: "#123abc",
		});
		body.append("trackIds", "t2");
		body.append("trackIds", "not-a-track");
		body.append("hiddenFields", "description");
		body.append("hiddenFields", "not-a-field");
		const request = await adminRequest("http://localhost/admin/embeds/emb1", {
			method: "POST",
			body,
		});
		const response = (await detailAction({
			context: CONTEXT,
			request,
			params: { id: "emb1" },
		} as never)) as Response;
		expect(response.status).toBe(302);
		const row = (await getDb(env).select().from(embeds)).find(
			(r) => r.id === "emb1",
		);
		expect(row?.name).toBe("Filtered sessions v2");
		expect(row?.config).toEqual({
			trackIds: ["t2"],
			hiddenFields: ["description"],
			accentColor: "#123abc",
		});
	});

	it("rejects a malformed brand color without writing", async () => {
		await seedProgram();
		const body = new URLSearchParams({
			name: "Filtered sessions",
			enabled: "on",
			accentColor: "petrol-ish",
		});
		const request = await adminRequest("http://localhost/admin/embeds/emb1", {
			method: "POST",
			body,
		});
		const result = (await detailAction({
			context: CONTEXT,
			request,
			params: { id: "emb1" },
		} as never)) as { fieldErrors?: { accentColor?: string[] } };
		expect(result.fieldErrors?.accentColor?.[0]).toBeTruthy();
		const row = (await getDb(env).select().from(embeds)).find(
			(r) => r.id === "emb1",
		);
		expect(row?.config).toEqual({ trackIds: ["t1"] }); // untouched
	});

	it("the editor is scoped to the active event — another event's embed 404s", async () => {
		await seedProgram();
		const db = getDb(env);
		await db.insert(users).values({
			id: "u_admin",
			email: "admin@test.co",
			passwordHash: await hashPassword("pw"),
			role: "admin",
			activeEventId: "e1",
		});
		const {
			organizations,
			events,
			embeds: embedsTable,
		} = await import("../app/db/schema");
		await db.insert(organizations).values({ id: "org2", name: "Other" });
		await db.insert(events).values({
			id: "e2",
			organizationId: "org2",
			name: "Other Event",
			slug: "other",
		});
		await db.insert(embedsTable).values({
			id: "emb_other",
			eventId: "e2",
			publicId: "pub-other",
			name: "Other's embed",
			type: "sessions",
		});
		const setCookie = await createSession(env, "u_admin");
		const request = new Request("http://localhost/admin/embeds/emb_other", {
			headers: { Cookie: setCookie.split(";")[0] ?? "" },
		});
		await detailLoader({
			context: CONTEXT,
			request,
			params: { id: "emb_other" },
		} as never).then(
			() => {
				throw new Error("expected 404");
			},
			(error) => expect(thrownStatus(error)).toBe(404),
		);
	});
});
