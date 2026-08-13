import { env } from "cloudflare:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";
import { EventSwitcherMenu } from "../app/components/event-switcher";
import { getDb } from "../app/db";
import {
	events,
	organizationMembers,
	organizations,
	submissions,
	users,
} from "../app/db/schema";
import { createSession, getActiveEvent, hashPassword } from "../app/lib/auth";
import { stayAfterSwitch } from "../app/lib/event-switch-path";
import { loader as adminLoader } from "../app/routes/admin";
import { action } from "../app/routes/admin.events.switch";
import { loader as submissionsLoader } from "../app/routes/admin.submissions";
import { unwrap } from "./route-data";

// The event switcher is a tenancy chokepoint: it may set users.activeEventId
// ONLY to an event of an org the caller belongs to (docs/multi-tenancy-design.md
// §Authorization — "the event switcher lists only your orgs' events").

const CONTEXT = { cloudflare: { env, ctx: {} } };

async function seed(): Promise<void> {
	const db = getDb(env);
	await db.insert(organizations).values([
		{ id: "org_a", name: "Org A" },
		{ id: "org_b", name: "Org B" },
	]);
	await db.insert(users).values({
		id: "u_a",
		email: "a@test.co",
		passwordHash: await hashPassword("pw"),
		role: "admin",
		activeEventId: null,
	});
	await db
		.insert(organizationMembers)
		.values({ id: "om_a", organizationId: "org_a", userId: "u_a" });
	await db.insert(events).values([
		{ id: "e_a1", organizationId: "org_a", name: "A1", slug: "a1" },
		{ id: "e_a2", organizationId: "org_a", name: "A2", slug: "a2" },
		{ id: "e_b1", organizationId: "org_b", name: "B1", slug: "b1" },
	]);
}

async function postSwitch(
	fields: Record<string, string>,
	userId?: string,
): Promise<Response> {
	const headers = new Headers();
	if (userId) {
		const setCookie = await createSession(env, userId);
		headers.set("Cookie", setCookie.split(";")[0] ?? "");
	}
	const request = new Request("http://localhost/admin/events/switch", {
		method: "POST",
		headers,
		body: new URLSearchParams(fields),
	});
	try {
		return (await action({
			context: CONTEXT,
			request,
			params: {},
		} as unknown as Parameters<typeof action>[0])) as Response;
	} catch (thrown) {
		if (thrown instanceof Response) return thrown; // requireUser throws redirects
		throw thrown;
	}
}

async function activeEventOf(userId: string): Promise<string | null> {
	const row = await getDb(env).query.users.findFirst({
		where: (u, { eq }) => eq(u.id, userId),
	});
	return row?.activeEventId ?? null;
}

async function cookieFor(userId: string): Promise<string> {
	const setCookie = await createSession(env, userId);
	return setCookie.split(";")[0] ?? "";
}

async function loadAdminShell(userId: string) {
	const request = new Request("http://localhost/admin", {
		headers: { Cookie: await cookieFor(userId) },
	});
	const result = await adminLoader({
		context: CONTEXT,
		request,
		params: {},
	} as unknown as Parameters<typeof adminLoader>[0]);
	return unwrap<{
		events: Array<{ id: string; name: string; isCurrent: boolean }>;
	}>(result);
}

async function loadSubmissions(userId: string) {
	const request = new Request("http://localhost/admin/submissions", {
		headers: { Cookie: await cookieFor(userId) },
	});
	const result = await submissionsLoader({
		context: CONTEXT,
		request,
		params: {},
	} as unknown as Parameters<typeof submissionsLoader>[0]);
	return unwrap<{
		eventName: string | null;
		submissions: Array<{ id: string; title: string }>;
		total: number;
	}>(result);
}

describe("admin.events.switch action", () => {
	it("switches to an own-org event and redirects to /admin by default", async () => {
		await seed();
		const response = await postSwitch({ eventId: "e_a2" }, "u_a");
		expect(response.status).toBe(302);
		expect(response.headers.get("Location")).toBe("/admin");
		expect(await activeEventOf("u_a")).toBe("e_a2");
	});

	it("the next getActiveEvent and admin loaders follow the switched event", async () => {
		await seed();
		await getDb(env).insert(submissions).values({
			id: "s_a1",
			eventId: "e_a1",
			title: "Seeded talk",
			status: "pending",
		});

		const switched = await postSwitch(
			{ eventId: "e_a2", redirectTo: "/admin/submissions" },
			"u_a",
		);
		expect(switched.headers.get("Location")).toBe("/admin/submissions");

		const user = await getDb(env).query.users.findFirst({
			where: (u, { eq }) => eq(u.id, "u_a"),
		});
		if (!user) throw new Error("expected seeded admin");
		expect((await getActiveEvent(env, user))?.id).toBe("e_a2");

		const empty = await loadSubmissions("u_a");
		expect(empty.eventName).toBe("A2");
		expect(empty.submissions).toEqual([]);
		expect(empty.total).toBe(0);

		const shell = await loadAdminShell("u_a");
		expect(shell.events.filter((e) => e.isCurrent).map((e) => e.id)).toEqual([
			"e_a2",
		]);

		await postSwitch(
			{ eventId: "e_a1", redirectTo: "/admin/submissions" },
			"u_a",
		);
		const populated = await loadSubmissions("u_a");
		expect(populated.eventName).toBe("A1");
		expect(populated.submissions.map((row) => row.id)).toEqual(["s_a1"]);
		expect(populated.total).toBe(1);
	});

	it("honors a same-origin redirectTo and rejects an external one", async () => {
		await seed();
		const ok = await postSwitch(
			{ eventId: "e_a1", redirectTo: "/admin/submissions" },
			"u_a",
		);
		expect(ok.headers.get("Location")).toBe("/admin/submissions");
		const evil = await postSwitch(
			{ eventId: "e_a2", redirectTo: "//evil.example" },
			"u_a",
		);
		expect(evil.headers.get("Location")).toBe("/admin");
	});
	it("collapses a record URL to its collection so the next event's list loads", async () => {
		await seed();
		const response = await postSwitch(
			{ eventId: "e_a2", redirectTo: "/admin/submissions/s_a1" },
			"u_a",
		);
		expect(response.headers.get("Location")).toBe("/admin/submissions");
		expect(await activeEventOf("u_a")).toBe("e_a2");
	});

	it("refuses another org's event with 403 and does not write (cross-tenant denial)", async () => {
		await seed();
		const response = await postSwitch({ eventId: "e_b1" }, "u_a");
		expect(response.status).toBe(403);
		expect(await activeEventOf("u_a")).toBeNull();
	});

	it("refuses an unknown event id with 403 (no existence disclosure) and does not write", async () => {
		await seed();
		const response = await postSwitch({ eventId: "e_nope" }, "u_a");
		expect(response.status).toBe(403);
		expect(await activeEventOf("u_a")).toBeNull();
	});

	it("rejects a blank eventId with 400", async () => {
		await seed();
		const response = await postSwitch({ eventId: "" }, "u_a");
		expect(response.status).toBe(400);
		expect(await activeEventOf("u_a")).toBeNull();
	});

	it("redirects an anonymous POST to /login and writes nothing", async () => {
		await seed();
		const response = await postSwitch({ eventId: "e_a1" });
		expect(response.status).toBe(302);
		expect(response.headers.get("Location")).toContain("/login");
		expect(await activeEventOf("u_a")).toBeNull();
	});

	it("denies a non-admin role with /403 and writes nothing", async () => {
		await seed();
		const db = getDb(env);
		await db.insert(users).values({
			id: "u_spk",
			email: "s@test.co",
			passwordHash: await hashPassword("pw"),
			role: "speaker",
		});
		const response = await postSwitch({ eventId: "e_a1" }, "u_spk");
		expect(response.status).toBe(302);
		expect(response.headers.get("Location")).toBe("/403");
		expect(await activeEventOf("u_spk")).toBeNull();
	});
});

describe("stayAfterSwitch", () => {
	it("keeps collection screens and their filters, and walks record URLs up", () => {
		expect(stayAfterSwitch("/admin/submissions?status=pending")).toBe(
			"/admin/submissions?status=pending",
		);
		expect(stayAfterSwitch("/admin/forms")).toBe("/admin/forms");
		expect(stayAfterSwitch("/admin/evaluation")).toBe("/admin/evaluation");
		expect(stayAfterSwitch("/admin/agenda")).toBe("/admin/agenda");
		expect(stayAfterSwitch("/admin/submissions/s_old")).toBe(
			"/admin/submissions",
		);
		expect(stayAfterSwitch("/admin/forms/form_1")).toBe("/admin/forms");
		expect(stayAfterSwitch("/admin/crm/person/ada@test.co")).toBe("/admin/crm");
	});

	it("rejects off-admin and external targets", () => {
		expect(stayAfterSwitch("")).toBe("/admin");
		expect(stayAfterSwitch("/portal")).toBe("/admin");
		expect(stayAfterSwitch("//evil.example")).toBe("/admin");
		expect(stayAfterSwitch("https://evil.example/admin")).toBe("/admin");
	});
});

describe("event switcher menu submission", () => {
	it("renders one form root with a submit control per event", () => {
		const RoutesStub = createRoutesStub([
			{
				id: "root",
				path: "/",
				Component: () =>
					createElement(EventSwitcherMenu, {
						Form: "form",
						events: [
							{
								id: "e_old",
								name: "DevFlow Conf 2027",
								type: "Conference",
								dates: null,
								isCurrent: true,
							},
							{
								id: "e_new",
								name: "Forward Summit 2028",
								type: "Conference",
								dates: null,
								isCurrent: false,
							},
						],
						redirectTo: "/admin/submissions",
						busy: false,
						onSubmit: () => {},
						onCreate: () => {},
					}),
			},
		]);
		const html = renderToString(
			createElement(RoutesStub, { initialEntries: ["/"] }),
		);

		expect(html).toContain("<form");
		expect(html).toContain('method="post"');
		expect(html).toContain('action="/admin/events/switch"');
		expect(html.match(/type="submit"/g)).toHaveLength(2);
		expect(html.match(/name="eventId"/g)).toHaveLength(2);
		expect(html).toContain('value="e_old"');
		expect(html).toContain('value="e_new"');
	});
});
