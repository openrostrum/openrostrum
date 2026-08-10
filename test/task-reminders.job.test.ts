import { env } from "cloudflare:test";
import { eq, isNotNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
	contacts,
	emailOutbox,
	emailSuppressions,
	taskAssignments,
} from "../app/db/schema";
import { runTaskDueReminders } from "../app/jobs/task-reminders.scheduled";
import { fixedClock } from "../app/ports/clock";
import { DAY_MS, seedTasksBaseline } from "./tasks-fixtures";

// Contract under test: reminderSentAt guards double-fire; an edited dueAt
// re-arms; the dedupeKey embeds the due date; task reminders are transactional
// (always deliver). Window = 3 days (REMINDER_WINDOW_DAYS).

const NOW = new Date("2026-09-01T09:00:00Z");

async function seedJobFixture() {
	const db = await seedTasksBaseline();
	await db.insert(contacts).values([
		{
			id: "c_dave",
			eventId: "e1",
			email: "dave@example.com",
			firstName: "Dave",
			lastName: "Lee",
		},
		{
			id: "c_erin",
			eventId: "e1",
			email: "erin@example.com",
			firstName: "Erin",
			lastName: "Moss",
		},
		{
			id: "c_finn",
			eventId: "e1",
			email: "finn@example.com",
			firstName: "Finn",
			lastName: "Ove",
		},
		{
			id: "c_gina",
			eventId: "e1",
			email: "gina@example.com",
			firstName: "Gina",
			lastName: "Paz",
		},
	]);
	await db.insert(taskAssignments).values([
		// due tomorrow, never reminded → SENDS
		{
			id: "a_due",
			taskId: "t_hotel",
			contactId: "c_priya",
			status: "incomplete",
			dueAt: new Date(NOW.getTime() + 1 * DAY_MS),
		},
		// overdue, never reminded → SENDS (overdue copy)
		{
			id: "a_overdue",
			taskId: "t_hotel",
			contactId: "c_bob",
			status: "incomplete",
			dueAt: new Date(NOW.getTime() - 2 * DAY_MS),
		},
		// due beyond the 3-day window → silent
		{
			id: "a_far",
			taskId: "t_hotel",
			contactId: "c_carol",
			status: "incomplete",
			dueAt: new Date(NOW.getTime() + 10 * DAY_MS),
		},
		// no due date → silent
		{
			id: "a_none",
			taskId: "t_hotel",
			contactId: "c_dave",
			status: "incomplete",
			dueAt: null,
		},
		// complete → silent
		{
			id: "a_done",
			taskId: "t_hotel",
			contactId: "c_erin",
			status: "complete",
			dueAt: new Date(NOW.getTime() + 1 * DAY_MS),
			completedAt: NOW,
		},
		// uploaded, waiting on the organizer → silent
		{
			id: "a_pf",
			taskId: "t_hotel",
			contactId: "c_finn",
			status: "pending_feedback",
			dueAt: new Date(NOW.getTime() + 1 * DAY_MS),
		},
		// already reminded for this due date → silent
		{
			id: "a_stamped",
			taskId: "t_hotel",
			contactId: "c_gina",
			status: "incomplete",
			dueAt: new Date(NOW.getTime() + 1 * DAY_MS),
			reminderSentAt: new Date(NOW.getTime() - 1 * DAY_MS),
		},
	]);
	return db;
}

describe("task-due reminder cron", () => {
	it("reminds exactly the incomplete assignments due within the window, and stamps the guard", async () => {
		const db = await seedJobFixture();
		const { sent, failed } = await runTaskDueReminders(env, fixedClock(NOW));
		expect(sent).toBe(2);
		expect(failed).toBe(0);

		const outbox = await db.select().from(emailOutbox);
		expect(outbox.map((o) => o.to).sort()).toEqual([
			"bob@example.com",
			"priya.sharma@example.com",
		]);
		const overdueMail = outbox.find((o) => o.to === "bob@example.com");
		expect(overdueMail?.subject).toContain("Overdue");
		const dueMail = outbox.find((o) => o.to === "priya.sharma@example.com");
		expect(dueMail?.subject).toContain("Hotel Stay Requirements");
		// The dedupe key embeds assignment + due date, so a later extension
		// mints a NEW key instead of colliding with this send.
		const dueEpoch = Math.floor((NOW.getTime() + 1 * DAY_MS) / 1000);
		expect(dueMail?.dedupeKey).toBe(`task-due:a_due:${dueEpoch}`);

		const stamped = await db
			.select()
			.from(taskAssignments)
			.where(isNotNull(taskAssignments.reminderSentAt));
		expect(stamped.map((s) => s.id).sort()).toEqual([
			"a_due",
			"a_overdue",
			"a_stamped",
		]);
	});

	it("double-run sends once", async () => {
		const db = await seedJobFixture();
		await runTaskDueReminders(env, fixedClock(NOW));
		const second = await runTaskDueReminders(env, fixedClock(NOW));
		expect(second.sent).toBe(0);
		const outbox = await db.select().from(emailOutbox);
		expect(outbox).toHaveLength(2);
	});

	it("an extended due date re-arms the reminder and re-sends under a new dedupe key", async () => {
		const db = await seedJobFixture();
		await runTaskDueReminders(env, fixedClock(NOW));
		// The admin's due-date edit clears the stamp (the set-due action's contract).
		await db
			.update(taskAssignments)
			.set({
				dueAt: new Date(NOW.getTime() + 2 * DAY_MS),
				reminderSentAt: null,
			})
			.where(eq(taskAssignments.id, "a_due"));
		const { sent } = await runTaskDueReminders(env, fixedClock(NOW));
		expect(sent).toBe(1);
		const priyaMail = await db
			.select()
			.from(emailOutbox)
			.where(eq(emailOutbox.to, "priya.sharma@example.com"));
		expect(priyaMail).toHaveLength(2);
		expect(new Set(priyaMail.map((m) => m.dedupeKey)).size).toBe(2);
	});

	it("delivers to unsubscribed addresses — task reminders are transactional", async () => {
		const db = await seedJobFixture();
		await db
			.insert(emailSuppressions)
			.values({ email: "priya.sharma@example.com" });
		await runTaskDueReminders(env, fixedClock(NOW));
		const priyaMail = await db
			.select()
			.from(emailOutbox)
			.where(eq(emailOutbox.to, "priya.sharma@example.com"));
		expect(priyaMail).toHaveLength(1);
	});

	it("fails loudly when a real mail provider is configured without APP_ORIGIN", async () => {
		await seedJobFixture();
		const prodLike = { ...env, RESEND_API_KEY: "re_test" } as typeof env;
		await expect(
			runTaskDueReminders(prodLike, fixedClock(NOW)),
		).rejects.toThrow(/APP_ORIGIN/);
	});

	it("links to the speaker portal when APP_ORIGIN is configured", async () => {
		const db = await seedJobFixture();
		const withOrigin = {
			...env,
			APP_ORIGIN: "https://rostrum.example",
		} as typeof env;
		await runTaskDueReminders(withOrigin, fixedClock(NOW));
		const [mail] = await db
			.select()
			.from(emailOutbox)
			.where(eq(emailOutbox.to, "priya.sharma@example.com"));
		expect(mail?.html).toContain(
			"https://rostrum.example/portals/democonf/portal-public-1",
		);
	});
});
