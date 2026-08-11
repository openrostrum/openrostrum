import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "../app/db";
import {
	emailOutbox,
	emailSuppressions,
	emailTemplates,
	events,
	forms,
	organizations,
	submissions,
	users,
} from "../app/db/schema";
import {
	reminderWindow,
	runDraftCloseReminders,
} from "../app/jobs/draft-reminders.scheduled";
import { fixedClock } from "../app/ports/clock";
import type { EmailSender } from "../app/ports/email";

// Contract under test: reminders fire five days and one day before the form's
// close date, counted in CALENDAR DAYS IN THE EVENT'S TIMEZONE (close
// 2026-09-15 23:59 PDT = 2026-09-16 06:59Z, and the 5-day occurrence is
// Sep 10 — naive UTC day-diff says 6 and skips it). Only draft holders are
// reminded, once per (form, holder, occurrence); replays add nothing; the
// toggle and the form status gate everything.

/** 2026-09-15 23:59 America/Los_Angeles (PDT = UTC-7). */
const CLOSE_AT = new Date("2026-09-16T06:59:00Z");
const FIVE_DAY_TICK = new Date("2026-09-10T09:00:00Z");
const ONE_DAY_TICK = new Date("2026-09-14T09:00:00Z");

async function seedBaseline(formOverrides = {}) {
	const db = getDb(env);
	await db.insert(organizations).values({ id: "org1", name: "Org" });
	await db.insert(events).values({
		id: "e1",
		organizationId: "org1",
		name: "DemoConf",
		slug: "democonf",
		timezone: "America/Los_Angeles",
	});
	await db.insert(forms).values({
		id: "form1",
		eventId: "e1",
		publicId: "form-public-1",
		type: "session",
		status: "open",
		internalName: "Sessions CFP",
		externalTitle: "Call for Sessions",
		closeAt: CLOSE_AT,
		sendReminders: true,
		...formOverrides,
	});
	await db.insert(users).values([
		{
			id: "u_dana",
			email: "dana.wu@example.com",
			passwordHash: "x",
			name: "Dana Wu",
		},
		{
			id: "u_priya",
			email: "priya@example.com",
			passwordHash: "x",
			name: "Priya Sharma",
		},
	]);
	await db.insert(submissions).values([
		{
			id: "s_dana_draft",
			eventId: "e1",
			formId: "form1",
			title: "Latency Budgets in RAG",
			status: "draft",
			submitterId: "u_dana",
		},
		// Priya has only a COMPLETED submission — she must never be nagged.
		{
			id: "s_priya_done",
			eventId: "e1",
			formId: "form1",
			title: "Shipped Talk",
			status: "pending",
			submitterId: "u_priya",
		},
	]);
	await db.insert(emailTemplates).values([
		{
			id: "et_rem5",
			eventId: "e1",
			key: "reminder_5day",
			name: "Five Days Reminder",
			subject: "Five days left for {{form_title}}",
			bodyHtml:
				"<p>Hi {{first_name}}, {{form_title}} closes {{form_close_date}}.</p>",
			replyTo: "organizers@demo.co",
			category: "lifecycle",
			trigger: "auto",
		},
		{
			id: "et_rem1",
			eventId: "e1",
			key: "reminder_1day",
			name: "One Day Reminder",
			subject: "Last day for {{form_title}}",
			bodyHtml: "<p>Hi {{first_name}}, tomorrow is the deadline.</p>",
			category: "lifecycle",
			trigger: "auto",
		},
	]);
	return db;
}

const withOrigin = { ...env, APP_ORIGIN: "https://rostrum.example" } as Env;

describe("reminderWindow — event-timezone day math", () => {
	const TZ = "America/Los_Angeles";
	it("counts calendar days in the event timezone, not UTC", () => {
		// Close is Sep 15 in PDT but already Sep 16 in UTC: at the Sep 10 tick a
		// UTC day-diff reads 6 (silent) — event-tz reads 5 (fires).
		expect(reminderWindow(FIVE_DAY_TICK, CLOSE_AT, TZ)).toBe("reminder_5day");
		// Positive-offset mirror: 2026-09-09 13:00Z is already Sep 10 in Auckland
		// (NZST +12); close Sep 15 23:59 NZST = Sep 15 11:59Z. UTC diff = 6.
		expect(
			reminderWindow(
				new Date("2026-09-09T13:00:00Z"),
				new Date("2026-09-15T11:59:00Z"),
				"Pacific/Auckland",
			),
		).toBe("reminder_5day");
	});

	it("window edges: 6 days silent, 5→2 five-day, 1→0 one-day, past close silent", () => {
		// Sep 9 23:58 PDT — six days out.
		expect(reminderWindow(new Date("2026-09-10T06:58:00Z"), CLOSE_AT, TZ)).toBe(
			null,
		);
		// Sep 10 00:01 PDT — the 5-day window opens with the calendar day.
		expect(reminderWindow(new Date("2026-09-10T07:01:00Z"), CLOSE_AT, TZ)).toBe(
			"reminder_5day",
		);
		// Sep 13 23:58 PDT — two days out, still the 5-day occurrence.
		expect(reminderWindow(new Date("2026-09-14T06:58:00Z"), CLOSE_AT, TZ)).toBe(
			"reminder_5day",
		);
		// Sep 14 00:01 PDT — the 1-day occurrence.
		expect(reminderWindow(new Date("2026-09-14T07:01:00Z"), CLOSE_AT, TZ)).toBe(
			"reminder_1day",
		);
		// Sep 15 23:58 PDT — closes "today"; the 1-day reminder still goes out.
		expect(reminderWindow(new Date("2026-09-16T06:58:00Z"), CLOSE_AT, TZ)).toBe(
			"reminder_1day",
		);
		// The close instant and after: nothing.
		expect(reminderWindow(CLOSE_AT, CLOSE_AT, TZ)).toBe(null);
		expect(reminderWindow(new Date("2026-09-16T07:30:00Z"), CLOSE_AT, TZ)).toBe(
			null,
		);
	});
});

describe("draft-close reminder job", () => {
	it("5-day occurrence: one rendered reminder to the draft holder, none to completed submitters", async () => {
		const db = await seedBaseline();
		const result = await runDraftCloseReminders(
			withOrigin,
			fixedClock(FIVE_DAY_TICK),
		);
		expect(result).toEqual({ sent: 1, deduped: 0, failed: 0 });

		const outbox = await db.select().from(emailOutbox);
		expect(outbox).toHaveLength(1);
		const mail = outbox[0];
		expect(mail?.to).toBe("dana.wu@example.com");
		// Rendered through the template pipeline the preview uses — merge tags
		// resolve to the form title and the close date in EVENT time (Sep 15,
		// not the UTC Sep 16).
		expect(mail?.subject).toBe("Five days left for Call for Sessions");
		expect(mail?.html).toContain("Hi Dana,");
		expect(mail?.html).toContain("Sep 15, 2026");
		expect(mail?.html).toContain("11:59");
		expect(mail?.html).not.toContain("{{");
		// The body must link the holder back to resume THE draft.
		expect(mail?.html).toContain("Latency Budgets in RAG");
		expect(mail?.html).toContain(
			"https://rostrum.example/submit/democonf/form-public-1/step/session?sid=s_dana_draft",
		);
		expect(mail?.replyTo).toBe("organizers@demo.co");
		expect(mail?.templateId).toBe("et_rem5");
		const closeEpoch = Math.floor(CLOSE_AT.getTime() / 1000);
		expect(mail?.dedupeKey).toBe(`reminder_5day:form1:u_dana:${closeEpoch}`);
	});

	it("replaying an occurrence never adds a row; the 1-day occurrence adds exactly one more", async () => {
		const db = await seedBaseline();
		await runDraftCloseReminders(env, fixedClock(FIVE_DAY_TICK));
		const replay5 = await runDraftCloseReminders(
			env,
			fixedClock(FIVE_DAY_TICK),
		);
		expect(replay5).toEqual({ sent: 0, deduped: 1, failed: 0 });
		expect(await db.select().from(emailOutbox)).toHaveLength(1);

		const oneDay = await runDraftCloseReminders(env, fixedClock(ONE_DAY_TICK));
		expect(oneDay.sent).toBe(1);
		const replay1 = await runDraftCloseReminders(env, fixedClock(ONE_DAY_TICK));
		expect(replay1).toEqual({ sent: 0, deduped: 1, failed: 0 });

		const outbox = await db.select().from(emailOutbox);
		expect(outbox).toHaveLength(2);
		expect(new Set(outbox.map((o) => o.dedupeKey)).size).toBe(2);
		expect(outbox.map((o) => o.templateId).sort()).toEqual([
			"et_rem1",
			"et_rem5",
		]);
	});

	it("outside both windows nothing sends — too early and after close", async () => {
		const db = await seedBaseline();
		await runDraftCloseReminders(
			env,
			fixedClock(new Date("2026-09-09T09:00:00Z")),
		);
		await runDraftCloseReminders(
			env,
			fixedClock(new Date("2026-09-16T09:00:00Z")),
		);
		expect(await db.select().from(emailOutbox)).toHaveLength(0);
	});

	it("the per-form toggle OFF means silence, even in-window with drafts", async () => {
		const db = await seedBaseline({ sendReminders: false });
		const result = await runDraftCloseReminders(env, fixedClock(FIVE_DAY_TICK));
		expect(result).toEqual({ sent: 0, deduped: 0, failed: 0 });
		expect(await db.select().from(emailOutbox)).toHaveLength(0);
	});

	it("a closed form never nags — its drafts are dead, not due", async () => {
		const db = await seedBaseline({ status: "closed" });
		await runDraftCloseReminders(env, fixedClock(FIVE_DAY_TICK));
		expect(await db.select().from(emailOutbox)).toHaveLength(0);
	});

	it("a holder of several drafts gets ONE email linking to the drafts list", async () => {
		const db = await seedBaseline();
		await db.insert(submissions).values({
			id: "s_dana_draft2",
			eventId: "e1",
			formId: "form1",
			title: "Second Idea",
			status: "draft",
			submitterId: "u_dana",
		});
		await runDraftCloseReminders(withOrigin, fixedClock(FIVE_DAY_TICK));
		const outbox = await db.select().from(emailOutbox);
		expect(outbox).toHaveLength(1);
		expect(outbox[0]?.html).toContain("2 drafts");
		// No single draft to deep-link — land on the wizard's resume list.
		expect(outbox[0]?.html).toContain(
			"https://rostrum.example/submit/democonf/form-public-1/step/session",
		);
		expect(outbox[0]?.html).not.toContain("?sid=");
	});

	it("delivers to unsubscribed addresses — a draft reminder is transactional", async () => {
		const db = await seedBaseline();
		await db
			.insert(emailSuppressions)
			.values({ email: "dana.wu@example.com", reason: "unsubscribe_link" });
		const result = await runDraftCloseReminders(env, fixedClock(FIVE_DAY_TICK));
		expect(result.sent).toBe(1);
		expect(await db.select().from(emailOutbox)).toHaveLength(1);
	});

	it("reports an aggregate failure only after attempting every due recipient", async () => {
		const db = await seedBaseline();
		await db.insert(submissions).values({
			id: "s_priya_draft",
			eventId: "e1",
			formId: "form1",
			title: "Second Draft Holder",
			status: "draft",
			submitterId: "u_priya",
		});
		const attempted: string[] = [];
		const sender: EmailSender = {
			async send(message) {
				attempted.push(message.to);
				if (attempted.length === 1) throw new Error("provider unavailable");
				return { id: "sent-after-failure", deduped: false, suppressed: false };
			},
		};

		await expect(
			runDraftCloseReminders(env, fixedClock(FIVE_DAY_TICK), sender),
		).rejects.toThrow("Draft close reminders failed: 1 recipient.");
		expect(attempted).toHaveLength(2);
		expect(attempted.sort()).toEqual([
			"dana.wu@example.com",
			"priya@example.com",
		]);
	});

	it("an extended close date re-arms the occurrence under a new dedupe key", async () => {
		const db = await seedBaseline();
		await runDraftCloseReminders(env, fixedClock(FIVE_DAY_TICK));
		// Organizer pushes the deadline out a month: 2026-10-15 23:59 PDT.
		const extended = new Date("2026-10-16T06:59:00Z");
		await db
			.update(forms)
			.set({ closeAt: extended })
			.where(eq(forms.id, "form1"));
		const rearmed = await runDraftCloseReminders(
			env,
			fixedClock(new Date("2026-10-10T09:00:00Z")),
		);
		expect(rearmed.sent).toBe(1);
		const danaMail = await db
			.select()
			.from(emailOutbox)
			.where(eq(emailOutbox.to, "dana.wu@example.com"));
		expect(danaMail).toHaveLength(2);
		expect(new Set(danaMail.map((m) => m.dedupeKey)).size).toBe(2);
	});

	it("one event's missing template never starves another tenant's send", async () => {
		const db = await seedBaseline();
		await db.insert(events).values({
			id: "e2",
			organizationId: "org1",
			name: "OtherConf",
			slug: "otherconf",
			timezone: "America/Los_Angeles",
		});
		// e2's form is due with a draft, but the event has NO reminder templates.
		await db.insert(forms).values({
			id: "form2",
			eventId: "e2",
			publicId: "form-public-2",
			status: "open",
			internalName: "Other CFP",
			closeAt: CLOSE_AT,
			sendReminders: true,
		});
		await db.insert(submissions).values({
			id: "s_priya_draft",
			eventId: "e2",
			formId: "form2",
			title: "Cross-Tenant Draft",
			status: "draft",
			submitterId: "u_priya",
		});
		const result = await runDraftCloseReminders(env, fixedClock(FIVE_DAY_TICK));
		expect(result).toEqual({ sent: 1, deduped: 0, failed: 0 });
		const outbox = await db.select().from(emailOutbox);
		expect(outbox.map((o) => o.to)).toEqual(["dana.wu@example.com"]);
	});

	it("a malformed event timezone degrades that form's day math to UTC, never crashing the tick", async () => {
		const db = await seedBaseline();
		await db.insert(events).values({
			id: "e_badtz",
			organizationId: "org1",
			name: "BadTzConf",
			slug: "badtzconf",
			timezone: "Not/AZone",
		});
		await db.insert(forms).values({
			id: "form_badtz",
			eventId: "e_badtz",
			publicId: "form-public-badtz",
			status: "open",
			internalName: "BadTz CFP",
			closeAt: CLOSE_AT,
			sendReminders: true,
		});
		await db.insert(submissions).values({
			id: "s_badtz_draft",
			eventId: "e_badtz",
			formId: "form_badtz",
			title: "Doomed Draft",
			status: "draft",
			submitterId: "u_priya",
		});
		await db.insert(emailTemplates).values({
			id: "et_rem5_badtz",
			eventId: "e_badtz",
			key: "reminder_5day",
			name: "Five Days Reminder",
			subject: "Closing soon",
			bodyHtml: "<p>Closing.</p>",
			category: "lifecycle",
			trigger: "auto",
		});
		// Under UTC day math the Sep 16 06:59Z close is 6 days out on Sep 10 —
		// the healthy PDT tenant sends, the degraded one is not yet due...
		const early = await runDraftCloseReminders(env, fixedClock(FIVE_DAY_TICK));
		expect(early).toEqual({ sent: 1, deduped: 0, failed: 0 });
		// ...and becomes due one UTC day later instead of never sending.
		const utcDue = await runDraftCloseReminders(
			env,
			fixedClock(new Date("2026-09-11T09:00:00Z")),
		);
		expect(utcDue.sent).toBe(1);
		const outbox = await db.select().from(emailOutbox);
		expect(outbox.map((o) => o.to).sort()).toEqual([
			"dana.wu@example.com",
			"priya@example.com",
		]);
	});

	it("fails loudly when a real mail provider is configured without APP_ORIGIN", async () => {
		await seedBaseline();
		const prodLike = { ...env, RESEND_API_KEY: "re_test" } as typeof env;
		await expect(
			runDraftCloseReminders(prodLike, fixedClock(FIVE_DAY_TICK)),
		).rejects.toThrow(/APP_ORIGIN/);
	});
});
