import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "../app/db";
import { emailOutbox, emailSuppressions } from "../app/db/schema";
import { getEmailSender } from "../app/ports/email";

// Oracle: SCOPE K13 — suppression applies to announcements ("bulk") ONLY;
// everything that follows from the recipient's own submission/account is
// "transactional" and ALWAYS delivers. Runs the real port against real D1.
describe("suppression gate (K13 matrix)", () => {
	async function suppress(email: string) {
		await getDb(env)
			.insert(emailSuppressions)
			.values({ email, reason: "unsubscribe_link" });
	}

	it("skips a bulk send to a suppressed address BEFORE any outbox row", async () => {
		await suppress("leo@example.com");
		const res = await getEmailSender(env).send({
			to: "leo@example.com",
			subject: "Announcement",
			html: "<p>News</p>",
			kind: "bulk",
		});
		expect(res.suppressed).toBe(true);
		expect(res.id).toBe("");
		expect(await getDb(env).select().from(emailOutbox)).toHaveLength(0);
	});

	it("suppression matches case-insensitively on the address", async () => {
		await suppress("leo@example.com");
		const res = await getEmailSender(env).send({
			to: "Leo@Example.com",
			subject: "Announcement",
			html: "<p>News</p>",
			kind: "bulk",
		});
		expect(res.suppressed).toBe(true);
	});

	it("delivers bulk sends to everyone else in the same blast", async () => {
		await suppress("leo@example.com");
		const res = await getEmailSender(env).send({
			to: "priya@example.com",
			subject: "Announcement",
			html: "<p>News</p>",
			kind: "bulk",
		});
		expect(res.suppressed).toBe(false);
		const rows = await getDb(env).select().from(emailOutbox);
		expect(rows.map((r) => r.to)).toEqual(["priya@example.com"]);
	});

	it("ALWAYS delivers transactional mail — even to a suppressed address", async () => {
		await suppress("leo@example.com");
		const explicit = await getEmailSender(env).send({
			to: "leo@example.com",
			subject: "Your session was accepted",
			html: "<p>You are in</p>",
			kind: "transactional",
		});
		const defaulted = await getEmailSender(env).send({
			to: "leo@example.com",
			subject: "We received your submission",
			html: "<p>Thanks</p>",
		});
		expect(explicit.suppressed).toBe(false);
		expect(defaulted.suppressed).toBe(false);
		expect(await getDb(env).select().from(emailOutbox)).toHaveLength(2);
	});
});

describe("local sink adapter (the outbox oracle)", () => {
	it("maps replyTo and a non-ASCII subject onto the outbox row intact", async () => {
		await getEmailSender(env).send({
			to: "priya.sharma@example.com",
			replyTo: "organizer@example.com",
			subject: "You're in! 🎉",
			html: "<p>Congrats</p>",
		});
		const [row] = await getDb(env)
			.select()
			.from(emailOutbox)
			.where(eq(emailOutbox.to, "priya.sharma@example.com"));
		expect(row?.replyTo).toBe("organizer@example.com");
		expect(row?.subject).toBe("You're in! 🎉");
		expect(row?.status).toBe("sent");
		expect(row?.sentAt).toBeInstanceOf(Date);
	});

	it("dedupes on dedupeKey: the replay returns the ORIGINAL row id, no new row", async () => {
		const sender = getEmailSender(env);
		const msg = {
			to: "dana@example.com",
			subject: "Reminder",
			html: "<p>5 days left</p>",
			dedupeKey: "reminder_5day:form1:dana@example.com",
		};
		const first = await sender.send(msg);
		const replay = await sender.send(msg);
		expect(first.deduped).toBe(false);
		expect(replay.deduped).toBe(true);
		expect(replay.id).toBe(first.id);
		expect(await getDb(env).select().from(emailOutbox)).toHaveLength(1);
	});
});
