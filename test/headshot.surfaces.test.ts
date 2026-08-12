import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "../app/db";
import {
	contacts,
	events,
	organizations,
	participants,
	submissions,
	users,
} from "../app/db/schema";
import { loader as adminHeadshotLoader } from "../app/routes/admin.contacts_.$id.headshot";
import { loader as directoryLoader } from "../app/routes/admin.crm.directory";
import { loader as portalHeadshotLoader } from "../app/routes/portals.$eventSlug.$portalId.headshot";
import { loader as portalHomeLoader } from "../app/routes/portals.$eventSlug.$portalId.home";
import { loader as portalSubmissionLoader } from "../app/routes/portals.$eventSlug.$portalId.submissions_.$submissionId";
import { requestAs, seedCrmBaseline } from "./crm-fixtures";
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

const PRIYA_BYTES = "priya-headshot-bytes";
const DANA_BYTES = "dana-headshot-bytes";

/** Stores real bytes and points the contact at them, exactly as an upload does. */
async function giveHeadshot(contactId: string, eventId: string, bytes: string) {
	const key = `headshots/${eventId}/${contactId}/${contactId}-photo.png`;
	await env.BLOBS.put(key, bytes, {
		httpMetadata: { contentType: "image/png" },
	});
	await getDb(env)
		.update(contacts)
		.set({ headshotKey: key })
		.where(eq(contacts.id, contactId));
	return key;
}

describe("the CRM directory renders the photo the org already has", () => {
	it("carries a headshot URL for a person whose photo lives on a non-active event", async () => {
		await seedCrmBaseline();
		const db = getDb(env);
		// The newest appearance (c_priya_e2) has no photo; the older one does —
		// the directory must fall through to the appearance that actually has it.
		await giveHeadshot("c_priya_e1", "e1", PRIYA_BYTES);
		await db
			.update(users)
			.set({ activeEventId: "e2" })
			.where(eq(users.id, "u_admin1"));

		const result = (await directoryLoader({
			context: CONTEXT,
			request: await requestAs(
				"u_admin1",
				"http://localhost/admin/crm/directory",
			),
			params: {},
		} as unknown as Parameters<typeof directoryLoader>[0])) as unknown as {
			data: {
				people: Array<{ email: string; headshotUrl: string | null }>;
			};
		};
		const priya = result.data.people.find(
			(p) => p.email === "priya@example.com",
		);
		expect(priya?.headshotUrl).toMatch(
			/^\/admin\/contacts\/c_priya_e1\/headshot\?v=/,
		);
		expect(
			result.data.people.find((p) => p.email === "marcus@example.com")
				?.headshotUrl,
		).toBeNull();
	});

	it("serves those bytes for any contact in the admin's org, not just the active event", async () => {
		await seedCrmBaseline();
		const db = getDb(env);
		await giveHeadshot("c_priya_e1", "e1", PRIYA_BYTES);
		await db
			.update(users)
			.set({ activeEventId: "e2" })
			.where(eq(users.id, "u_admin1"));

		const served = (await adminHeadshotLoader({
			context: CONTEXT,
			request: await requestAs(
				"u_admin1",
				"http://localhost/admin/contacts/c_priya_e1/headshot",
			),
			params: { id: "c_priya_e1" },
		} as unknown as Parameters<typeof adminHeadshotLoader>[0])) as Response;
		expect(served.status).toBe(200);
		expect(served.headers.get("Content-Type")).toBe("image/png");
		expect(await served.text()).toBe(PRIYA_BYTES);
	});

	it("still refuses a contact belonging to another organization", async () => {
		await seedCrmBaseline();
		// Same email as the org1 person — org scoping, not identity, must decide.
		await giveHeadshot("c_priya_org2", "e3", "rival-bytes");

		const denied = await catchThrown(async () =>
			adminHeadshotLoader({
				context: CONTEXT,
				request: await requestAs(
					"u_admin1",
					"http://localhost/admin/contacts/c_priya_org2/headshot",
				),
				params: { id: "c_priya_org2" },
			} as unknown as Parameters<typeof adminHeadshotLoader>[0]),
		);
		expect(thrownStatus(denied)).toBe(404);
	});
});

/** Priya and Dana share one accepted panel; Ravi is in the event but not on it. */
async function seedPortalPanel() {
	await seedPortalWorld();
	const db = getDb(env);
	await makeUser("u_priya", "priya@example.com");
	await makeUser("u_dana", "dana@example.com");
	await makeContact(
		"c_priya",
		"e1",
		"priya@example.com",
		"u_priya",
		"Priya",
		"R",
	);
	await makeContact("c_dana", "e1", "dana@example.com", "u_dana", "Dana", "O");
	await makeContact("c_ravi", "e1", "ravi@example.com", null, "Ravi", "N");
	await db.insert(submissions).values({
		id: "s_panel",
		eventId: "e1",
		title: "Practitioners Panel",
		status: "accepted",
	});
	await db.insert(participants).values([
		{ id: "p_priya", submissionId: "s_panel", contactId: "c_priya" },
		{ id: "p_dana", submissionId: "s_panel", contactId: "c_dana" },
	]);
	return db;
}

describe("the speaker portal renders the photos it stores", () => {
	it("shows the speaker their own photo on the portal home profile card", async () => {
		await seedPortalPanel();
		await giveHeadshot("c_priya", "e1", PRIYA_BYTES);

		const home = unwrap<{
			profile: { name: string; photoUrl: string | null } | null;
		}>(
			await portalHomeLoader({
				context: CONTEXT,
				request: await authedRequest("u_priya", `${BASE}/home`),
				params: PORTAL_PARAMS,
			} as unknown as Parameters<typeof portalHomeLoader>[0]),
		);
		expect(home.profile?.photoUrl).toMatch(
			/^\/portals\/testconf\/portal-pub-1\/headshot\?v=/,
		);
	});

	it("shows a co-speaker's photo on the shared submission, and serves those bytes", async () => {
		await seedPortalPanel();
		await giveHeadshot("c_dana", "e1", DANA_BYTES);

		const detail = unwrap<{
			participants: Array<{ name: string; photoUrl: string | null }>;
		}>(
			await portalSubmissionLoader({
				context: CONTEXT,
				request: await authedRequest("u_priya", `${BASE}/submissions/s_panel`),
				params: { ...PORTAL_PARAMS, submissionId: "s_panel" },
			} as unknown as Parameters<typeof portalSubmissionLoader>[0]),
		);
		const dana = detail.participants.find((p) => p.name === "Dana O");
		expect(dana?.photoUrl).toMatch(/\/headshot\?contact=c_dana&v=/);

		const served = (await portalHeadshotLoader({
			context: CONTEXT,
			request: await authedRequest(
				"u_priya",
				`${BASE}/headshot?contact=c_dana`,
			),
			params: PORTAL_PARAMS,
		} as unknown as Parameters<typeof portalHeadshotLoader>[0])) as Response;
		expect(served.status).toBe(200);
		expect(await served.text()).toBe(DANA_BYTES);
	});

	it("refuses a contact the caller shares no submission with, and one from another event", async () => {
		const db = await seedPortalPanel();
		// The caller has a photo of their own: a refusal must be a refusal, never
		// a silent fallback that serves the caller's face under someone's name.
		await giveHeadshot("c_priya", "e1", PRIYA_BYTES);
		await giveHeadshot("c_ravi", "e1", "ravi-bytes");
		await db.insert(organizations).values({ id: "org3", name: "Third" });
		await db.insert(events).values({
			id: "e3",
			organizationId: "org3",
			name: "ThirdConf",
			slug: "thirdconf",
		});
		await makeContact("c_out", "e3", "out@example.com", null, "Out", "Sider");
		await giveHeadshot("c_out", "e3", "outsider-bytes");

		for (const contactId of ["c_ravi", "c_out"]) {
			const denied = await catchThrown(async () =>
				portalHeadshotLoader({
					context: CONTEXT,
					request: await authedRequest(
						"u_priya",
						`${BASE}/headshot?contact=${contactId}`,
					),
					params: PORTAL_PARAMS,
				} as unknown as Parameters<typeof portalHeadshotLoader>[0]),
			);
			expect(thrownStatus(denied)).toBe(404);
		}
	});
});
