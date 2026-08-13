import { env } from "cloudflare:test";
import { createElement, type ComponentType } from "react";
import { renderToString } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "../app/db";
import {
	contacts,
	events,
	files,
	organizationMembers,
	organizations,
} from "../app/db/schema";
import { loader as rosterLoader } from "../app/routes/admin.contacts";
import {
	default as ContactRecord,
	action as contactAction,
	loader as contactLoader,
} from "../app/routes/admin.contacts_.$id";
import { loader as headshotLoader } from "../app/routes/admin.contacts_.$id.headshot";
import { action as portalProfileAction } from "../app/routes/portals.$eventSlug.$portalId.profile";
import {
	authedRequest,
	BASE,
	catchThrown,
	CONTEXT,
	makeContact,
	makeUser,
	PORTAL_PARAMS,
	seedPortalWorld,
	thrownStatus,
	unwrap,
} from "./portal.helpers";

const PNG_BYTES = "fake-png-bytes-for-roundtrip";

async function seedWorldWithAdmin() {
	await seedPortalWorld();
	await makeUser("u_admin", "admin@test.co", "admin");
	const db = getDb(env);
	await db
		.insert(organizationMembers)
		.values({ id: "om1", organizationId: "org1", userId: "u_admin" });
	await makeContact(
		"c_priya",
		"e1",
		"priya@example.com",
		null,
		"Priya",
		"Raman",
	);
}

async function adminHeadshotUpload(contactId: string, file: File) {
	const form = new FormData();
	form.set("intent", "headshot");
	form.set("headshot", file);
	return contactAction({
		context: CONTEXT,
		request: await authedRequest(
			"u_admin",
			`http://localhost/admin/contacts/${contactId}`,
			{ method: "POST", body: form },
		),
		params: { id: contactId },
	} as unknown as Parameters<typeof contactAction>[0]);
}

describe("speaker headshot on the organizer surfaces", () => {
	it("a portal-uploaded headshot reaches the roster and the contact record (the admin sees the photo, not initials)", async () => {
		await seedWorldWithAdmin();
		await makeUser("u_priya", "priya@example.com");
		const db = getDb(env);
		await db
			.update(contacts)
			.set({ userId: "u_priya" })
			.where(eq(contacts.id, "c_priya"));

		const form = new FormData();
		form.set("intent", "profile");
		form.set("firstName", "Priya");
		form.set("lastName", "Raman");
		form.set("bio", "");
		form.set("linkedinUrl", "");
		form.set("twitterUrl", "");
		form.set("facebookUrl", "");
		form.set("websiteUrl", "");
		form.set(
			"headshot",
			new File([PNG_BYTES], "priya.png", { type: "image/png" }),
		);
		const uploaded = await portalProfileAction({
			context: CONTEXT,
			request: await authedRequest("u_priya", `${BASE}/profile`, {
				method: "POST",
				body: form,
			}),
			params: PORTAL_PARAMS,
		} as unknown as Parameters<typeof portalProfileAction>[0]);
		expect((uploaded as Response).status).toBe(302);

		// …the roster row now carries the authz'd image URL…
		const roster = unwrap<{
			rows: Array<{ id: string; headshotUrl: string | null }>;
		}>(
			await rosterLoader({
				context: CONTEXT,
				request: await authedRequest(
					"u_admin",
					"http://localhost/admin/contacts",
				),
				params: {},
			} as unknown as Parameters<typeof rosterLoader>[0]),
		);
		const row = roster.rows.find((r) => r.id === "c_priya");
		expect(row?.headshotUrl).toMatch(
			/^\/admin\/contacts\/c_priya\/headshot\?v=/,
		);

		// …the contact record does too…
		const record = unwrap<{ headshotUrl: string | null }>(
			await contactLoader({
				context: CONTEXT,
				request: await authedRequest(
					"u_admin",
					"http://localhost/admin/contacts/c_priya",
				),
				params: { id: "c_priya" },
			} as unknown as Parameters<typeof contactLoader>[0]),
		);
		expect(record.headshotUrl).toMatch(
			/^\/admin\/contacts\/c_priya\/headshot\?v=/,
		);

		// …and the admin route serves the exact uploaded bytes.
		const served = (await headshotLoader({
			context: CONTEXT,
			request: await authedRequest(
				"u_admin",
				"http://localhost/admin/contacts/c_priya/headshot",
			),
			params: { id: "c_priya" },
		} as unknown as Parameters<typeof headshotLoader>[0])) as Response;
		expect(served.status).toBe(200);
		expect(served.headers.get("Content-Type")).toBe("image/png");
		expect(await served.text()).toBe(PNG_BYTES);
	});

	it("Save profile with a chosen file writes the headshot and the organizer record renders it as an img, not initials", async () => {
		await seedWorldWithAdmin();
		await makeUser("u_priya", "priya@example.com");
		const db = getDb(env);
		await db
			.update(contacts)
			.set({ userId: "u_priya" })
			.where(eq(contacts.id, "c_priya"));

		const form = new FormData();
		form.set("intent", "profile");
		form.set("firstName", "Priya");
		form.set("lastName", "Raman");
		form.set("bio", "<p>SBEK-PORTAL-BIO-01</p>");
		form.set("linkedinUrl", "");
		form.set("twitterUrl", "");
		form.set("facebookUrl", "");
		form.set("websiteUrl", "");
		form.set(
			"headshot",
			new File([PNG_BYTES], "headshot.png", { type: "image/png" }),
		);
		const saved = await portalProfileAction({
			context: CONTEXT,
			request: await authedRequest("u_priya", `${BASE}/profile`, {
				method: "POST",
				body: form,
			}),
			params: PORTAL_PARAMS,
		} as unknown as Parameters<typeof portalProfileAction>[0]);
		expect((saved as Response).status).toBe(302);

		const [row] = await db
			.select({ headshotKey: contacts.headshotKey, bio: contacts.bio })
			.from(contacts)
			.where(eq(contacts.id, "c_priya"));
		expect(row?.bio).toContain("SBEK-PORTAL-BIO-01");
		expect(row?.headshotKey).toBeTruthy();

		const record = unwrap<{
			contact: { firstName: string; lastName: string };
			sessions: unknown[];
			assignments: unknown[];
			emails: unknown[];
			hasAccount: boolean;
			hasPassword: boolean;
			inviteUrl: string | null;
			inviteKey: string;
			saved: string | null;
			headshotUrl: string | null;
		}>(
			await contactLoader({
				context: CONTEXT,
				request: await authedRequest(
					"u_admin",
					"http://localhost/admin/contacts/c_priya",
				),
				params: { id: "c_priya" },
			} as unknown as Parameters<typeof contactLoader>[0]),
		);
		expect(record.headshotUrl).toMatch(
			/^\/admin\/contacts\/c_priya\/headshot\?v=/,
		);

		const Record = ContactRecord as unknown as ComponentType<{
			loaderData: typeof record;
			actionData: undefined;
		}>;
		const RoutesStub = createRoutesStub([
			{
				path: "/admin/contacts/:id",
				Component: () =>
					createElement(Record, {
						loaderData: record,
						actionData: undefined,
					}),
			},
		]);
		const html = renderToString(
			createElement(RoutesStub, {
				initialEntries: ["/admin/contacts/c_priya"],
			}),
		);
		expect(html).toMatch(/src="\/admin\/contacts\/c_priya\/headshot\?v=[^"]+"/);
		expect(html).not.toMatch(/>PR<\/span>/);

		const served = (await headshotLoader({
			context: CONTEXT,
			request: await authedRequest(
				"u_admin",
				"http://localhost/admin/contacts/c_priya/headshot",
			),
			params: { id: "c_priya" },
		} as unknown as Parameters<typeof headshotLoader>[0])) as Response;
		expect(served.status).toBe(200);
		expect(await served.text()).toBe(PNG_BYTES);
	});

	it("the organizer can upload then replace a headshot from the contact record (versioned, pointer moves)", async () => {
		await seedWorldWithAdmin();
		const db = getDb(env);

		const first = await adminHeadshotUpload(
			"c_priya",
			new File([PNG_BYTES], "priya.png", { type: "image/png" }),
		);
		expect((first as Response).status).toBe(302);
		expect((first as Response).headers.get("Location")).toBe(
			"/admin/contacts/c_priya?saved=headshot",
		);
		const [afterFirst] = await db
			.select({ headshotKey: contacts.headshotKey })
			.from(contacts)
			.where(eq(contacts.id, "c_priya"));
		expect(afterFirst?.headshotKey).toBeTruthy();
		expect(
			await (await env.BLOBS.get(afterFirst?.headshotKey ?? ""))?.text(),
		).toBe(PNG_BYTES);

		const second = await adminHeadshotUpload(
			"c_priya",
			new File(["replacement-bytes"], "priya2.png", { type: "image/png" }),
		);
		expect((second as Response).status).toBe(302);
		const [afterSecond] = await db
			.select({ headshotKey: contacts.headshotKey })
			.from(contacts)
			.where(eq(contacts.id, "c_priya"));
		expect(afterSecond?.headshotKey).toBeTruthy();
		expect(afterSecond?.headshotKey).not.toBe(afterFirst?.headshotKey);

		const versions = await db
			.select({ version: files.version })
			.from(files)
			.where(and(eq(files.contactId, "c_priya"), eq(files.kind, "headshot")));
		expect(versions.map((v) => v.version).sort()).toEqual([1, 2]);
	});

	it("rejects a non-image and an oversize file without touching the current headshot", async () => {
		await seedWorldWithAdmin();
		const db = getDb(env);

		const bmp = (await adminHeadshotUpload(
			"c_priya",
			new File(["BM..."], "priya.bmp", { type: "image/bmp" }),
		)) as { fieldErrors?: Record<string, string[]> };
		expect(bmp.fieldErrors?.headshot?.[0]).toMatch(/PNG|JPEG/);

		const huge = (await adminHeadshotUpload(
			"c_priya",
			new File([new Uint8Array(5 * 1024 * 1024 + 1)], "big.png", {
				type: "image/png",
			}),
		)) as { fieldErrors?: Record<string, string[]> };
		expect(huge.fieldErrors?.headshot?.[0]).toMatch(/5 MB/);

		const [row] = await db
			.select({ headshotKey: contacts.headshotKey })
			.from(contacts)
			.where(eq(contacts.id, "c_priya"));
		expect(row?.headshotKey).toBeNull();
	});

	it("headshot bytes are admin-gated, org-scoped, and 404 when absent", async () => {
		await seedWorldWithAdmin();
		const db = getDb(env);

		// No headshot yet → 404 (never a broken stream).
		const absent = await catchThrown(async () =>
			headshotLoader({
				context: CONTEXT,
				request: await authedRequest(
					"u_admin",
					"http://localhost/admin/contacts/c_priya/headshot",
				),
				params: { id: "c_priya" },
			} as unknown as Parameters<typeof headshotLoader>[0]),
		);
		expect(thrownStatus(absent)).toBe(404);

		// A contact in ANOTHER org's event 404s even with a real headshot.
		await db.insert(organizations).values({ id: "org3", name: "Other" });
		await db.insert(events).values({
			id: "e3",
			organizationId: "org3",
			name: "Other",
			slug: "other",
		});
		await env.BLOBS.put("headshots/e3/c_foreign/x.png", "FOREIGN-BYTES");
		await db.insert(contacts).values({
			id: "c_foreign",
			eventId: "e3",
			email: "foreign@example.com",
			firstName: "Not",
			lastName: "Yours",
			headshotKey: "headshots/e3/c_foreign/x.png",
		});
		const foreign = await catchThrown(async () =>
			headshotLoader({
				context: CONTEXT,
				request: await authedRequest(
					"u_admin",
					"http://localhost/admin/contacts/c_foreign/headshot",
				),
				params: { id: "c_foreign" },
			} as unknown as Parameters<typeof headshotLoader>[0]),
		);
		expect(thrownStatus(foreign)).toBe(404);

		// A speaker session cannot read the organizer surface at all.
		await makeUser("u_speaker", "speaker@test.co");
		const denied = await catchThrown(async () =>
			headshotLoader({
				context: CONTEXT,
				request: await authedRequest(
					"u_speaker",
					"http://localhost/admin/contacts/c_priya/headshot",
				),
				params: { id: "c_priya" },
			} as unknown as Parameters<typeof headshotLoader>[0]),
		);
		expect(denied).toBeInstanceOf(Response);
		expect((denied as Response).status).toBe(302);
		expect((denied as Response).headers.get("Location")).toBe("/403");
	});
});
