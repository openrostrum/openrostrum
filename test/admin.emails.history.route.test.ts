import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { getDb } from "../app/db";
import {
	emailOutbox,
	emailTemplates,
	events,
	organizationMembers,
	organizations,
	users,
} from "../app/db/schema";
import { createSession, hashPassword } from "../app/lib/auth";
import { loader } from "../app/routes/admin.emails_.history";

const CONTEXT = { cloudflare: { env, ctx: {} } };

async function seed() {
	const db = getDb(env);
	await db.insert(organizations).values({ id: "org1", name: "Org" });
	await db.insert(events).values([
		{ id: "e1", organizationId: "org1", name: "E1", slug: "e-one" },
		{ id: "e2", organizationId: "org1", name: "E2", slug: "e-two" },
	]);
	await db.insert(users).values({
		id: "u_admin",
		email: "admin@test.co",
		passwordHash: await hashPassword("pw"),
		role: "admin",
		activeEventId: "e1",
	});
	// Admin access resolves through org membership, not the role alone.
	await db
		.insert(organizationMembers)
		.values({ id: "om_admin", organizationId: "org1", userId: "u_admin" });
	await db.insert(emailTemplates).values({
		id: "et_accept",
		eventId: "e1",
		key: "accept",
		name: "Accept Sessions",
		category: "lifecycle",
		trigger: "manual",
	});
	// 30 rows on e1 (search/pagination), 1 on e2 (scoping), 1 literal-% subject.
	// Inserted in chunks — a single multi-row INSERT trips D1's bound-variable cap.
	const base = Date.now() - 1000 * 60 * 60;
	const bulk = Array.from({ length: 27 }, (_, i) => ({
		id: `m${String(i).padStart(2, "0")}`,
		eventId: "e1",
		to: `speaker${i}@example.com`,
		subject: `Update ${i}`,
		html: `<p>Update ${i}</p>`,
		status: "sent" as const,
		createdAt: new Date(base + i * 1000),
		sentAt: new Date(base + i * 1000),
	}));
	for (let i = 0; i < bulk.length; i += 9) {
		await db.insert(emailOutbox).values(bulk.slice(i, i + 9));
	}
	await db.insert(emailOutbox).values([
		{
			id: "m_dana",
			eventId: "e1",
			templateId: "et_accept",
			to: "dana.wu@example.com",
			subject: "You're in! 🎉",
			html: "<p>Congrats Dana</p>",
			status: "sent" as const,
			replyTo: "organizer@example.com",
			icsAttachment: "BEGIN:VCALENDAR\nEND:VCALENDAR",
			createdAt: new Date(base + 100_000),
			sentAt: new Date(base + 100_000),
		},
		{
			id: "m_failed",
			eventId: "e1",
			to: "bounce@example.com",
			subject: "Never arrived",
			html: "<p>x</p>",
			status: "failed" as const,
			error: "mailbox unavailable",
			createdAt: new Date(base + 101_000),
		},
		{
			id: "m_percent",
			eventId: "e1",
			to: "promo@example.com",
			subject: "Save 100% now",
			html: "<p>x</p>",
			status: "sent" as const,
			createdAt: new Date(base + 102_000),
			sentAt: new Date(base + 102_000),
		},
		{
			id: "m_other_event",
			eventId: "e2",
			to: "dana.wu@example.com",
			subject: "Other event mail",
			html: "<p>other</p>",
			status: "sent" as const,
			createdAt: new Date(base + 103_000),
			sentAt: new Date(base + 103_000),
		},
	]);
	const setCookie = await createSession(env, "u_admin");
	return setCookie.split(";")[0] ?? "";
}

type Result = {
	data: {
		rows: Array<{
			id: string;
			to: string;
			subject: string;
			kind: string;
			templateName: string;
		}>;
		total: number;
		detail: { to: string; html: string; hasIcs: boolean } | null;
	};
};

async function run(cookie: string, qs: string) {
	const headers = new Headers({ Cookie: cookie });
	return (await loader({
		context: CONTEXT,
		request: new Request(`http://localhost/admin/emails/history${qs}`, {
			headers,
		}),
		params: {},
	} as unknown as Parameters<typeof loader>[0])) as unknown as Result;
}

describe("email history log", () => {
	it("scopes to the active event, newest first, 25 per page", async () => {
		const cookie = await seed();
		const page1 = await run(cookie, "");
		expect(page1.data.total).toBe(30); // e2's row is excluded
		expect(page1.data.rows).toHaveLength(25);
		expect(page1.data.rows[0]?.id).toBe("m_percent"); // newest
		const page2 = await run(cookie, "?page=2");
		expect(page2.data.rows).toHaveLength(5);
	});

	it("search narrows by recipient AND by subject", async () => {
		const cookie = await seed();
		const byTo = await run(cookie, "?q=dana.wu");
		expect(byTo.data.rows.map((r) => r.id)).toEqual(["m_dana"]);
		const bySubject = await run(
			cookie,
			`?q=${encodeURIComponent("You're in")}`,
		);
		expect(bySubject.data.rows.map((r) => r.id)).toEqual(["m_dana"]);
	});

	it("treats LIKE wildcards in the query literally", async () => {
		const cookie = await seed();
		const result = await run(cookie, `?q=${encodeURIComponent("100%")}`);
		expect(result.data.rows.map((r) => r.id)).toEqual(["m_percent"]);
	});

	it("filters by status", async () => {
		const cookie = await seed();
		const failed = await run(cookie, "?status=failed");
		expect(failed.data.rows.map((r) => r.id)).toEqual(["m_failed"]);
		expect(failed.data.total).toBe(1);
	});

	it("labels the send kind from its template category", async () => {
		const cookie = await seed();
		const result = await run(cookie, "?q=dana.wu");
		expect(result.data.rows[0]?.kind).toBe("Transactional");
	});

	// Judge defect: system sends (reviewer invites, resets…) have no template
	// row, and both audit columns showed "—". Their dedupe-key prefix is the
	// send's identity — the columns must derive from it.
	it("labels template-less system sends from their dedupe-key prefix", async () => {
		const cookie = await seed();
		const db = getDb(env);
		await db.insert(emailOutbox).values([
			{
				id: "m_reviewer",
				eventId: "e1",
				to: "reviewer@example.com",
				subject: "You're invited to review for E1",
				html: "<p>invite</p>",
				status: "sent" as const,
				dedupeKey: "reviewer_invite:u9:tok123",
				sentAt: new Date(),
			},
			{
				id: "m_blast",
				eventId: "e1",
				to: "everyone@example.com",
				subject: "Schedule is live",
				html: "<p>blast</p>",
				status: "sent" as const,
				dedupeKey: "bulk:key1:c1",
				sentAt: new Date(),
			},
		]);

		const invite = await run(cookie, "?q=reviewer%40example.com");
		expect(invite.data.rows[0]?.templateName).toBe("Reviewer invite (system)");
		expect(invite.data.rows[0]?.kind).toBe("Transactional");

		const blast = await run(cookie, "?q=everyone%40example.com");
		expect(blast.data.rows[0]?.templateName).toBe("Composed announcement");
		expect(blast.data.rows[0]?.kind).toBe("Announcement");

		// A keyless, template-less row stays an honest "—", never a guess.
		const failed = await run(cookie, "?status=failed");
		expect(failed.data.rows[0]?.templateName).toBe("—");
	});

	it("opens a detail only for the active event's rows (frozen snapshot + ics flag)", async () => {
		const cookie = await seed();
		const own = await run(cookie, "?open=m_dana");
		expect(own.data.detail?.to).toBe("dana.wu@example.com");
		expect(own.data.detail?.html).toBe("<p>Congrats Dana</p>");
		expect(own.data.detail?.hasIcs).toBe(true);
		// Same id syntax, other tenant's event: nothing leaks.
		const foreign = await run(cookie, "?open=m_other_event");
		expect(foreign.data.detail).toBeNull();
	});
});
