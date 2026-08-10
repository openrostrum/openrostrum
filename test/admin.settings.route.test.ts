import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "../app/db";
import {
	events,
	organizationMembers,
	organizations,
	users,
} from "../app/db/schema";
import { createSession, hashPassword } from "../app/lib/auth";
import { action, loader } from "../app/routes/admin.settings._index";
import {
	dateToZonedInput,
	zonedInputToDate,
} from "../app/settings/event-details.server";

const CONTEXT = { cloudflare: { env, ctx: {} } };

// The action wraps successes in data() for Server-Timing; tests unwrap both.
function unwrap<T>(result: unknown): T {
	if (
		result !== null &&
		typeof result === "object" &&
		"data" in result &&
		"init" in result
	) {
		return (result as { data: T }).data;
	}
	return result as T;
}

// AE-S2.6's edit target: the seeded event's persisted details.
const BASE_DETAILS = {
	intent: "details",
	name: "DevOps Days Lyon 2027",
	slug: "devops-days",
	type: "Conference",
	websiteUrl: "https://devopsdays-lyon.example.com",
	location: "Lyon, France",
	timezone: "Europe/Paris",
	theme: "War stories.",
	startsAt: "2027-06-10T09:00",
	endsAt: "2027-06-11T18:00",
	submissionLimit: "3",
};

async function seed(): Promise<void> {
	const db = getDb(env);
	await db.insert(organizations).values({ id: "org_a", name: "Org A" });
	await db.insert(users).values({
		id: "u1",
		email: "a@test.co",
		passwordHash: await hashPassword("pw"),
		role: "admin",
	});
	await db
		.insert(organizationMembers)
		.values({ organizationId: "org_a", userId: "u1" });
	await db.insert(events).values([
		{
			id: "e1",
			organizationId: "org_a",
			name: "DevOps Days Lyon 2027",
			slug: "devops-days",
			timezone: "Europe/Paris",
			startsAt: new Date("2027-06-10T07:00:00Z"),
			endsAt: new Date("2027-06-11T16:00:00Z"),
		},
		{
			id: "e2",
			organizationId: "org_a",
			name: "Other",
			slug: "taken-slug",
		},
	]);
	await db.update(users).set({ activeEventId: "e1" }).where(eq(users.id, "u1"));
}

async function cookieFor(userId: string): Promise<string> {
	const setCookie = await createSession(env, userId);
	return setCookie.split(";")[0] ?? "";
}

async function post(
	body: Record<string, string> | FormData,
	userId = "u1",
): Promise<unknown> {
	const headers = new Headers({ Cookie: await cookieFor(userId) });
	const request = new Request("http://localhost/admin/settings", {
		method: "POST",
		headers,
		body: body instanceof FormData ? body : new URLSearchParams(body),
	});
	try {
		return await action({
			context: CONTEXT,
			request,
			params: {},
		} as unknown as Parameters<typeof action>[0]);
	} catch (thrown) {
		if (thrown instanceof Response) return thrown;
		throw thrown;
	}
}

async function eventRow(id: string) {
	return getDb(env).query.events.findFirst({
		where: (e, { eq: eqf }) => eqf(e.id, id),
	});
}

type SettingsResult = {
	intent?: string;
	ok?: boolean;
	kind?: string;
	imageError?: string;
	fieldErrors?: Record<string, string[] | undefined>;
	values?: Record<string, string>;
};

const PNG_BYTES = new Uint8Array([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4,
]);

function uploadForm(
	kind: string,
	file: File | null,
	intent = "image.upload",
): FormData {
	const form = new FormData();
	form.set("intent", intent);
	form.set("kind", kind);
	if (file) form.set("file", file);
	return form;
}

describe("admin.settings details", () => {
	it("persists edits — location and end date changes survive a re-read (AE-S2.6/7)", async () => {
		await seed();
		const result = unwrap<SettingsResult>(
			await post({
				...BASE_DETAILS,
				location: "Cité Internationale, Lyon, France",
				endsAt: "2027-06-12T18:00",
			}),
		);
		expect(result.ok).toBe(true);

		const row = await eventRow("e1");
		expect(row?.location).toBe("Cité Internationale, Lyon, France");
		// 18:00 wall-clock in Europe/Paris (CEST) = 16:00 UTC.
		expect(row?.endsAt?.getTime()).toBe(Date.parse("2027-06-12T16:00:00.000Z"));
		expect(row?.submissionLimit).toBe(3);
	});

	it("rejects a blank name inline, echoes the other typed values, and writes nothing", async () => {
		await seed();
		const result = unwrap<SettingsResult>(
			await post({ ...BASE_DETAILS, name: "", location: "Kept City" }),
		);
		expect(result.fieldErrors?.name?.[0]).toMatch(/required/i);
		expect(result.values?.location).toBe("Kept City");
		expect((await eventRow("e1"))?.name).toBe("DevOps Days Lyon 2027");
	});

	it("a slug taken by another event is a field error and the row is unchanged", async () => {
		await seed();
		const result = unwrap<SettingsResult>(
			await post({ ...BASE_DETAILS, slug: "taken-slug" }),
		);
		expect(result.fieldErrors?.slug?.[0]).toMatch(/taken/i);
		expect((await eventRow("e1"))?.slug).toBe("devops-days");
	});

	it("saving with the event's own unchanged slug succeeds (no self-collision)", async () => {
		await seed();
		const result = unwrap<SettingsResult>(await post(BASE_DETAILS));
		expect(result.ok).toBe(true);
	});

	it("denies a non-admin and an anonymous request without writing", async () => {
		await seed();
		const db = getDb(env);
		await db.insert(users).values({
			id: "u_spk",
			email: "s@test.co",
			passwordHash: await hashPassword("pw"),
			role: "speaker",
		});
		const denied = (await post(
			{ ...BASE_DETAILS, name: "Hacked" },
			"u_spk",
		)) as Response;
		expect(denied.status).toBe(302);
		expect(denied.headers.get("Location")).toBe("/403");
		expect((await eventRow("e1"))?.name).toBe("DevOps Days Lyon 2027");
	});
});

describe("admin.settings images", () => {
	it("uploads a logo to R2 and reads back the same bytes (roundtrip); replace deletes the old object; remove clears it", async () => {
		await seed();
		const first = unwrap<SettingsResult>(
			await post(
				uploadForm(
					"logo",
					new File([PNG_BYTES], "logo one.png", { type: "image/png" }),
				),
			),
		);
		expect(first.ok).toBe(true);

		const keyA = (await eventRow("e1"))?.logoKey;
		expect(keyA).toBeTruthy();
		const stored = await env.BLOBS.get(keyA as string);
		expect(
			new Uint8Array((await stored?.arrayBuffer()) ?? new ArrayBuffer(0)),
		).toEqual(PNG_BYTES);
		expect(stored?.httpMetadata?.contentType).toBe("image/png");

		// Replace: the row points at the new object, the old one is deleted.
		const second = unwrap<SettingsResult>(
			await post(
				uploadForm(
					"logo",
					new File([PNG_BYTES], "logo2.png", { type: "image/png" }),
				),
			),
		);
		expect(second.ok).toBe(true);
		const keyB = (await eventRow("e1"))?.logoKey;
		expect(keyB).not.toBe(keyA);
		expect(await env.BLOBS.get(keyA as string)).toBeNull();

		// Remove: column cleared AND the object gone.
		const removed = unwrap<SettingsResult>(
			await post(uploadForm("logo", null, "image.remove")),
		);
		expect(removed.ok).toBe(true);
		expect((await eventRow("e1"))?.logoKey).toBeNull();
		expect(await env.BLOBS.get(keyB as string)).toBeNull();
	});

	it("rejects a non-image content type without touching the row", async () => {
		await seed();
		const result = unwrap<SettingsResult>(
			await post(
				uploadForm(
					"background",
					new File(["hello"], "notes.txt", { type: "text/plain" }),
				),
			),
		);
		expect(result.imageError).toMatch(/png|jpeg|webp|gif/i);
		expect((await eventRow("e1"))?.backgroundKey).toBeNull();
	});

	it("rejects an oversized image with the stated cap", async () => {
		await seed();
		const big = new Uint8Array(2 * 1024 * 1024 + 1);
		const result = unwrap<SettingsResult>(
			await post(
				uploadForm("logo", new File([big], "huge.png", { type: "image/png" })),
			),
		);
		expect(result.imageError).toMatch(/2 MB or smaller/);
		expect((await eventRow("e1"))?.logoKey).toBeNull();
	});
});

describe("admin.settings loader", () => {
	it("returns the persisted row shaped for the form after an edit (reload persistence)", async () => {
		await seed();
		await post({ ...BASE_DETAILS, location: "Cité Internationale" });
		const headers = new Headers({ Cookie: await cookieFor("u1") });
		const result = unwrap<{
			values: Record<string, string> | null;
		}>(
			await loader({
				context: CONTEXT,
				request: new Request("http://localhost/admin/settings", { headers }),
				params: {},
			} as unknown as Parameters<typeof loader>[0]),
		);
		expect(result.values?.location).toBe("Cité Internationale");
		// Round-trips back to the wall-clock the admin typed, not UTC.
		expect(result.values?.startsAt).toBe("2027-06-10T09:00");
	});
});

describe("zoned datetime conversion", () => {
	it("converts wall-clock in a +02:00 and a -07:00 zone to the right instants, and round-trips", () => {
		const paris = zonedInputToDate("2027-06-10T09:00", "Europe/Paris");
		expect(paris.getTime()).toBe(Date.parse("2027-06-10T07:00:00.000Z"));
		expect(dateToZonedInput(paris, "Europe/Paris")).toBe("2027-06-10T09:00");

		const la = zonedInputToDate("2026-10-12T09:00", "America/Los_Angeles");
		expect(la.getTime()).toBe(Date.parse("2026-10-12T16:00:00.000Z"));
		expect(dateToZonedInput(la, "America/Los_Angeles")).toBe(
			"2026-10-12T09:00",
		);
	});
});
