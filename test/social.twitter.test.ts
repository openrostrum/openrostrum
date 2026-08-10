import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "../app/db";
import { contacts, organizationMembers } from "../app/db/schema";
import { normalizeXUrl } from "../app/lib/social";
import { action as contactAction } from "../app/routes/admin.contacts_.$id";
import { action as profileAction } from "../app/routes/portals.$eventSlug.$portalId.profile";
import {
	authedRequest,
	BASE,
	CONTEXT,
	makeContact,
	makeUser,
	PORTAL_PARAMS,
	seedPortalWorld,
} from "./portal.helpers";

describe("normalizeXUrl", () => {
	it("canonicalizes handles and URL-ish input; flags the unrecognizable", () => {
		expect(normalizeXUrl("@priyabuilds")).toBe("https://x.com/priyabuilds");
		expect(normalizeXUrl("priyabuilds")).toBe("https://x.com/priyabuilds");
		expect(normalizeXUrl(" @priyabuilds ")).toBe("https://x.com/priyabuilds");
		expect(normalizeXUrl("https://x.com/priyabuilds")).toBe(
			"https://x.com/priyabuilds",
		);
		expect(normalizeXUrl("x.com/priyabuilds")).toBe(
			"https://x.com/priyabuilds",
		);
		expect(normalizeXUrl("twitter.com/priyabuilds")).toBe(
			"https://twitter.com/priyabuilds",
		);
		expect(normalizeXUrl("")).toBe("");
		expect(normalizeXUrl("   ")).toBe("");
		expect(normalizeXUrl("not a handle at all!!")).toBeNull();
		// 16+ chars: too long for a handle, no dot: not a URL either.
		expect(normalizeXUrl("sixteencharactersplus")).toBeNull();
	});
});

async function seedPriyaWith(twitterUrl: string | null) {
	await seedPortalWorld();
	await makeUser("u_priya", "priya@example.com");
	await makeContact(
		"c_priya",
		"e1",
		"priya@example.com",
		"u_priya",
		"Priya",
		"R",
	);
	if (twitterUrl !== null) {
		await getDb(env)
			.update(contacts)
			.set({ twitterUrl })
			.where(eq(contacts.id, "c_priya"));
	}
}

function profileBody(overrides: Record<string, string> = {}) {
	return new URLSearchParams({
		intent: "profile",
		firstName: "Priya",
		lastName: "Raman",
		bio: "",
		jobTitle: "Principal Engineer",
		...overrides,
	});
}

async function postProfile(body: URLSearchParams) {
	return profileAction({
		context: CONTEXT,
		request: await authedRequest("u_priya", `${BASE}/profile`, {
			method: "POST",
			body,
		}),
		params: PORTAL_PARAMS,
	} as unknown as Parameters<typeof profileAction>[0]);
}

describe("portal profile save with X handles (judge repro: '@priyabuilds')", () => {
	it("a stored bare handle no longer blocks an unrelated save, and gets canonicalized", async () => {
		await seedPriyaWith("@priyabuilds");
		const db = getDb(env);
		// The form round-trips the stored value untouched while the speaker
		// edits something else entirely.
		const response = await postProfile(
			profileBody({ twitterUrl: "@priyabuilds", jobTitle: "Staff Engineer" }),
		);
		expect((response as Response).status).toBe(302);
		const [row] = await db
			.select({ jobTitle: contacts.jobTitle, twitterUrl: contacts.twitterUrl })
			.from(contacts)
			.where(eq(contacts.id, "c_priya"));
		expect(row?.jobTitle).toBe("Staff Engineer");
		expect(row?.twitterUrl).toBe("https://x.com/priyabuilds");
	});

	it("fresh handle input saves canonically; full URLs keep working", async () => {
		await seedPriyaWith(null);
		const db = getDb(env);
		expect(
			(
				(await postProfile(
					profileBody({ twitterUrl: "priyabuilds" }),
				)) as Response
			).status,
		).toBe(302);
		let [row] = await db
			.select({ twitterUrl: contacts.twitterUrl })
			.from(contacts)
			.where(eq(contacts.id, "c_priya"));
		expect(row?.twitterUrl).toBe("https://x.com/priyabuilds");

		expect(
			(
				(await postProfile(
					profileBody({ twitterUrl: "https://x.com/priya_builds" }),
				)) as Response
			).status,
		).toBe(302);
		[row] = await db
			.select({ twitterUrl: contacts.twitterUrl })
			.from(contacts)
			.where(eq(contacts.id, "c_priya"));
		expect(row?.twitterUrl).toBe("https://x.com/priya_builds");
	});

	it("stored junk (any URL field) never blocks the save; NEW junk still gets a field error", async () => {
		await seedPriyaWith("my twitter lol");
		const db = getDb(env);
		await db
			.update(contacts)
			.set({ linkedinUrl: "linkedin: ask me" })
			.where(eq(contacts.id, "c_priya"));

		// Unchanged legacy values ride along; the unrelated edit lands.
		const ok = await postProfile(
			profileBody({
				twitterUrl: "my twitter lol",
				linkedinUrl: "linkedin: ask me",
				jobTitle: "Staff Engineer",
			}),
		);
		expect((ok as Response).status).toBe(302);
		const [row] = await db
			.select({
				jobTitle: contacts.jobTitle,
				twitterUrl: contacts.twitterUrl,
				linkedinUrl: contacts.linkedinUrl,
			})
			.from(contacts)
			.where(eq(contacts.id, "c_priya"));
		expect(row?.jobTitle).toBe("Staff Engineer");
		expect(row?.twitterUrl).toBe("my twitter lol");
		expect(row?.linkedinUrl).toBe("linkedin: ask me");

		// Typing NEW unrecognizable input is still a validation error.
		const bad = (await postProfile(
			profileBody({ twitterUrl: "not a handle at all!!", jobTitle: "CTO" }),
		)) as { fieldErrors?: Record<string, string[]> };
		expect(bad.fieldErrors?.twitterUrl?.[0]).toBeTruthy();
		const [after] = await db
			.select({ jobTitle: contacts.jobTitle })
			.from(contacts)
			.where(eq(contacts.id, "c_priya"));
		expect(after?.jobTitle).toBe("Staff Engineer"); // nothing half-saved
	});
});

describe("admin contact edit canonicalizes X handles", () => {
	it("an organizer entering @handle stores the canonical profile URL", async () => {
		await seedPortalWorld();
		await makeUser("u_admin", "admin@test.co", "admin");
		await getDb(env)
			.insert(organizationMembers)
			.values({ id: "om1", organizationId: "org1", userId: "u_admin" });
		await makeContact("c1", "e1", "priya@example.com", null, "Priya", "R");

		const body = new URLSearchParams({
			intent: "update",
			firstName: "Priya",
			lastName: "R",
			email: "priya@example.com",
			twitterUrl: "@priyabuilds",
			status: "pending",
		});
		const response = await contactAction({
			context: CONTEXT,
			request: await authedRequest(
				"u_admin",
				"http://localhost/admin/contacts/c1",
				{ method: "POST", body },
			),
			params: { id: "c1" },
		} as unknown as Parameters<typeof contactAction>[0]);
		expect((response as Response).status).toBe(302);
		const [row] = await getDb(env)
			.select({ twitterUrl: contacts.twitterUrl })
			.from(contacts)
			.where(eq(contacts.id, "c1"));
		expect(row?.twitterUrl).toBe("https://x.com/priyabuilds");
	});
});
