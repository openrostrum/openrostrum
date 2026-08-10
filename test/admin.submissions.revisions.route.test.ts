import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { getDb } from "../app/db";
import {
	events,
	organizationMembers,
	organizations,
	submissionRevisions,
	submissions,
	users,
} from "../app/db/schema";
import { createSession, hashPassword } from "../app/lib/auth";
import { loader } from "../app/routes/admin.submissions_.$id";

const CONTEXT = { cloudflare: { env, ctx: {} } };

// A rapid-edit history: every save appends a row, so a submission can carry
// hundreds of multi-KB snapshots. The judged production failure: the detail
// loader returned ALL of them WITH their bodies, so its payload grew without
// bound per edit until the Worker exceeded its CPU budget (HTTP 1102).
const FAT = "x".repeat(3_000);

async function seedWorld() {
	const db = getDb(env);
	await db.insert(organizations).values({ id: "org1", name: "Org One" });
	await db.insert(events).values({
		id: "e1",
		organizationId: "org1",
		name: "Mine",
		slug: "mine",
		timezone: "America/Los_Angeles",
	});
	await db.insert(users).values({
		id: "u_admin",
		email: "admin@test.co",
		passwordHash: await hashPassword("pw"),
		name: "Demo Admin",
		role: "admin",
		activeEventId: "e1",
	});
	await db.insert(organizationMembers).values({
		organizationId: "org1",
		userId: "u_admin",
	});
	await db.insert(submissions).values({
		id: "s1",
		eventId: "e1",
		title: "Edited a lot",
		description: FAT,
		status: "pending",
	});
	return db;
}

async function seedRevisions(db: ReturnType<typeof getDb>, count: number) {
	for (let start = 0; start < count; start += 20) {
		const chunk = Array.from(
			{ length: Math.min(20, count - start) },
			(_, i) => ({
				id: `rev${start + i}`,
				submissionId: "s1",
				title: `Edit ${start + i}`,
				description: FAT,
			}),
		);
		await db.insert(submissionRevisions).values(chunk);
	}
}

async function loadDetail() {
	const setCookie = await createSession(env, "u_admin");
	const request = new Request("http://localhost/admin/submissions/s1", {
		headers: { Cookie: setCookie.split(";")[0] ?? "" },
	});
	const result = (await loader({
		context: CONTEXT,
		request,
		params: { id: "s1" },
	} as unknown as Parameters<typeof loader>[0])) as unknown as {
		data: {
			revisions: Array<Record<string, unknown>>;
			revisionsTruncated: boolean;
		};
	};
	return result.data;
}

describe("revision history stays bounded on the detail loader", () => {
	it("caps the list at 50, newest first, and never ships snapshot bodies", async () => {
		const db = await seedWorld();
		await seedRevisions(db, 60);

		const payload = await loadDetail();
		expect(payload.revisions).toHaveLength(50);
		expect(payload.revisionsTruncated).toBe(true);
		// newest snapshot (last inserted) leads — the row marked "Current"
		expect(payload.revisions[0]?.title).toBe("Edit 59");
		// the list carries metadata only; restore re-reads its snapshot from D1
		for (const rev of payload.revisions) {
			expect(rev).not.toHaveProperty("description");
		}
		// 50 rows of metadata, independent of the 3KB bodies (was ~150KB+)
		expect(JSON.stringify(payload.revisions).length).toBeLessThan(20_000);
	});

	it("does not claim truncation at exactly the cap", async () => {
		const db = await seedWorld();
		await seedRevisions(db, 50);

		const payload = await loadDetail();
		expect(payload.revisions).toHaveLength(50);
		expect(payload.revisionsTruncated).toBe(false);
	});
});
