import { describe, expect, it } from "vitest";
import { contacts, events, organizations, portals } from "../app/db/schema";
import { action, loader } from "../app/routes/admin.portals";
import {
	authedRequest,
	CONTEXT,
	postForm,
	seedTasksBaseline,
	unwrap,
} from "./tasks-fixtures";

type LoaderData = {
	eventName: string | null;
	portals: Array<{ publicId: string; name: string; url: string }>;
	contacts: Array<{ id: string; email: string; hasAccount: boolean }>;
	contactsTotal: number;
	previewing: { contactName: string } | null;
};

/** Baseline + a second tenant (org2/e2) for cross-event forgery probes. */
async function seedWithForeignTenant() {
	const db = await seedTasksBaseline();
	await db.insert(organizations).values({ id: "org2", name: "Other Org" });
	await db.insert(events).values({
		id: "e2",
		organizationId: "org2",
		name: "OtherConf",
		slug: "otherconf",
	});
	await db.insert(portals).values({
		id: "portal2",
		eventId: "e2",
		publicId: "portal-public-2",
	});
	await db.insert(contacts).values({
		id: "c_foreign",
		eventId: "e2",
		email: "foreign@example.com",
		firstName: "Fern",
		lastName: "Other",
	});
	return db;
}

describe("portals admin — list", () => {
	it("lists only the active event's portals and contacts, with the portal login URL", async () => {
		await seedWithForeignTenant();
		const data = unwrap<LoaderData>(
			await loader({
				context: CONTEXT,
				request: await authedRequest("http://localhost/admin/portals"),
				params: {},
			} as unknown as Parameters<typeof loader>[0]),
		);
		expect(data.portals.map((p) => p.publicId)).toEqual(["portal-public-1"]);
		expect(data.portals[0]?.url).toBe(
			"http://localhost/portals/democonf/portal-public-1",
		);
		const emails = data.contacts.map((c) => c.email);
		expect(emails).toContain("priya.sharma@example.com");
		expect(emails).not.toContain("foreign@example.com");
	});

	it("search narrows the contact list and reports the true total", async () => {
		await seedTasksBaseline();
		const data = unwrap<LoaderData>(
			await loader({
				context: CONTEXT,
				request: await authedRequest("http://localhost/admin/portals?q=priya"),
				params: {},
			} as unknown as Parameters<typeof loader>[0]),
		);
		expect(data.contacts.map((c) => c.email)).toEqual([
			"priya.sharma@example.com",
		]);
		expect(data.contactsTotal).toBe(1);
	});

	it("refuses non-admins", async () => {
		await seedTasksBaseline();
		const thrown = await loader({
			context: CONTEXT,
			request: await authedRequest("http://localhost/admin/portals", {
				role: "speaker",
			}),
			params: {},
		} as unknown as Parameters<typeof loader>[0]).catch((e: unknown) => e);
		expect((thrown as Response).status).toBe(302);
		expect((thrown as Response).headers.get("Location")).toBe("/403");
	});
});

describe("portals admin — start/exit preview", () => {
	it("starts a preview for an own-event contact: cookie set, redirected into the portal", async () => {
		await seedTasksBaseline();
		const result = (await action({
			context: CONTEXT,
			request: await authedRequest(
				"http://localhost/admin/portals",
				{},
				postForm({
					intent: "start-preview",
					contactId: "c_priya",
					portalPublicId: "portal-public-1",
				}),
			),
			params: {},
		} as unknown as Parameters<typeof action>[0])) as Response;
		expect(result.status).toBe(302);
		expect(result.headers.get("Location")).toBe(
			"/portals/democonf/portal-public-1/home",
		);
		expect(result.headers.get("Set-Cookie")).toContain(
			"__portal_preview=c_priya",
		);
	});

	it("refuses a forged contact or portal from another event — no cookie is set", async () => {
		await seedWithForeignTenant();
		for (const forged of [
			{ contactId: "c_foreign", portalPublicId: "portal-public-1" },
			{ contactId: "c_priya", portalPublicId: "portal-public-2" },
		]) {
			const result = await action({
				context: CONTEXT,
				request: await authedRequest(
					"http://localhost/admin/portals",
					{},
					postForm({
						intent: "start-preview",
						...forged,
					}),
				),
				params: {},
			} as unknown as Parameters<typeof action>[0]);
			expect(result).not.toBeInstanceOf(Response);
			expect((result as { formError?: string }).formError).toMatch(
				/no longer exists/,
			);
		}
	});

	it("exit-preview clears the cookie and returns to the portals page", async () => {
		await seedTasksBaseline();
		const result = (await action({
			context: CONTEXT,
			request: await authedRequest(
				"http://localhost/admin/portals",
				{},
				postForm({
					intent: "exit-preview",
				}),
			),
			params: {},
		} as unknown as Parameters<typeof action>[0])) as Response;
		expect(result.status).toBe(302);
		expect(result.headers.get("Location")).toBe("/admin/portals");
		const cookie = result.headers.get("Set-Cookie") ?? "";
		expect(cookie).toContain("__portal_preview=");
		expect(cookie).toContain("Max-Age=0");
	});

	it("refuses non-admin preview attempts", async () => {
		await seedTasksBaseline();
		const thrown = await action({
			context: CONTEXT,
			request: await authedRequest(
				"http://localhost/admin/portals",
				{ role: "speaker" },
				postForm({
					intent: "start-preview",
					contactId: "c_priya",
					portalPublicId: "portal-public-1",
				}),
			),
			params: {},
		} as unknown as Parameters<typeof action>[0]).catch((e: unknown) => e);
		expect((thrown as Response).status).toBe(302);
		expect((thrown as Response).headers.get("Location")).toBe("/403");
	});

	it("the loader names who is being previewed from the cookie", async () => {
		await seedTasksBaseline();
		const base = await authedRequest("http://localhost/admin/portals");
		const headers = new Headers(base.headers);
		headers.set(
			"Cookie",
			`${base.headers.get("Cookie")}; __portal_preview=c_priya`,
		);
		const data = unwrap<LoaderData>(
			await loader({
				context: CONTEXT,
				request: new Request("http://localhost/admin/portals", { headers }),
				params: {},
			} as unknown as Parameters<typeof loader>[0]),
		);
		expect(data.previewing).toEqual({ contactName: "Priya Sharma" });
	});
});
