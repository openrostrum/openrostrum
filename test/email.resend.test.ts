import { env as workerEnv } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getDb } from "../app/db";
import { emailOutbox } from "../app/db/schema";
import { createResendEmailSender } from "../app/ports/email";

// Oracle: the Resend Send API contract (endpoint, payload field names, the
// Idempotency-Key header) — from Resend's docs, not read off the adapter —
// PLUS the outbox ledger contract: every prod attempt is a queryable
// email_outbox row, resolved to `sent` (provider id) or `failed` (reason).
// `/admin/emails/history` is the delivery evidence in prod, so a provider
// rejection must be a `failed` row, never a vanished send. fetch (the process
// boundary) is the only thing mocked; the outbox asserts run on real D1.
const FROM = "OpenRostrum <noreply@test.example>";
const env = {
	...workerEnv,
	RESEND_API_KEY: "re_test",
	EMAIL_FROM: FROM,
} as unknown as Env;

function mockFetch(status: number, json: unknown) {
	return vi.fn(async () => new Response(JSON.stringify(json), { status }));
}

async function outboxRows() {
	return getDb(env).select().from(emailOutbox);
}

afterEach(() => vi.restoreAllMocks());

describe("Resend email adapter", () => {
	it("posts the mapped payload and returns the provider id", async () => {
		const fetchMock = mockFetch(200, { id: "resend-123" });
		vi.stubGlobal("fetch", fetchMock);

		const res = await createResendEmailSender(env).send({
			to: "a@b.com",
			subject: "Hi",
			html: "<p>x</p>",
			replyTo: "org@e.com",
			dedupeKey: "k1",
		});

		expect(res).toEqual({
			id: "resend-123",
			deduped: false,
			suppressed: false,
		});
		const [url, init] = fetchMock.mock.calls[0] as unknown as [
			string,
			RequestInit,
		];
		expect(url).toBe("https://api.resend.com/emails");
		expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBe(
			"k1",
		);
		const body = JSON.parse(init.body as string);
		expect(body).toMatchObject({
			from: FROM,
			to: ["a@b.com"],
			subject: "Hi",
			html: "<p>x</p>",
			reply_to: "org@e.com",
		});
		expect(body.attachments).toBeUndefined();
	});

	it("records a successful send as a `sent` outbox row with the provider id", async () => {
		vi.stubGlobal("fetch", mockFetch(200, { id: "resend-123" }));

		await createResendEmailSender(env).send({
			to: "a@b.com",
			subject: "Hi",
			html: "<p>x</p>",
			dedupeKey: "k1",
		});

		const rows = await outboxRows();
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			to: "a@b.com",
			subject: "Hi",
			status: "sent",
			providerId: "resend-123",
			error: null,
		});
		expect(rows[0]?.sentAt).toBeInstanceOf(Date);
	});

	it("throws (never sends from a wrong domain) when EMAIL_FROM is unset", () => {
		const noFrom = {
			...workerEnv,
			RESEND_API_KEY: "re_test",
			EMAIL_FROM: undefined,
		} as unknown as Env;
		expect(() => createResendEmailSender(noFrom)).toThrow(/EMAIL_FROM/);
	});

	it("attaches the ics as a text/calendar part, base64-encoded", async () => {
		const fetchMock = mockFetch(200, { id: "r2" });
		vi.stubGlobal("fetch", fetchMock);

		await createResendEmailSender(env).send({
			to: "a@b.com",
			subject: "s",
			html: "h",
			ics: "BEGIN:VCALENDAR\nEND:VCALENDAR",
		});

		const body = JSON.parse(
			(fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1]
				.body as string,
		);
		expect(body.attachments).toHaveLength(1);
		expect(body.attachments[0]).toMatchObject({
			filename: "invite.ics",
			content_type: "text/calendar; method=REQUEST",
		});
		expect(atob(body.attachments[0].content)).toContain("BEGIN:VCALENDAR");
	});

	it("throws on a non-2xx provider response AND records a `failed` row with the reason", async () => {
		vi.stubGlobal("fetch", mockFetch(422, { message: "Invalid `to` field." }));
		await expect(
			createResendEmailSender(env).send({
				to: "a@b.com",
				subject: "s",
				html: "h",
				dedupeKey: "k-fail",
			}),
		).rejects.toThrow(/Resend send failed \(422\)/);

		const rows = await outboxRows();
		expect(rows).toHaveLength(1);
		expect(rows[0]?.status).toBe("failed");
		expect(rows[0]?.error).toContain("Resend send failed (422)");
		expect(rows[0]?.error).toContain("Invalid `to` field.");
		expect(rows[0]?.sentAt).toBeNull();
	});

	it("records the attempt even when fetch itself blows up (network error)", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new Error("network down");
			}),
		);
		await expect(
			createResendEmailSender(env).send({
				to: "a@b.com",
				subject: "s",
				html: "h",
			}),
		).rejects.toThrow(/network down/);

		const rows = await outboxRows();
		expect(rows).toHaveLength(1);
		expect(rows[0]?.status).toBe("failed");
		expect(rows[0]?.error).toContain("network down");
	});

	it("dedupes on the outbox ledger: a retried `sent` key skips the provider", async () => {
		const fetchMock = mockFetch(200, { id: "resend-123" });
		vi.stubGlobal("fetch", fetchMock);
		const sender = createResendEmailSender(env);
		const msg = { to: "a@b.com", subject: "s", html: "h", dedupeKey: "k1" };

		const first = await sender.send(msg);
		const second = await sender.send(msg);

		expect(first.deduped).toBe(false);
		expect(second).toEqual({
			id: "resend-123",
			deduped: true,
			suppressed: false,
		});
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(await outboxRows()).toHaveLength(1);
	});

	it("a `failed` row stays retryable in place — the retry flips it to `sent`", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ message: "boom" }), { status: 500 }),
			)
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ id: "resend-9" }), { status: 200 }),
			);
		vi.stubGlobal("fetch", fetchMock);
		const sender = createResendEmailSender(env);
		const msg = { to: "a@b.com", subject: "s", html: "h", dedupeKey: "k1" };

		await expect(sender.send(msg)).rejects.toThrow(/500/);
		const retry = await sender.send(msg);

		expect(retry).toEqual({
			id: "resend-9",
			deduped: false,
			suppressed: false,
		});
		expect(fetchMock).toHaveBeenCalledTimes(2);
		const rows = await getDb(env)
			.select()
			.from(emailOutbox)
			.where(eq(emailOutbox.dedupeKey, "k1"));
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			status: "sent",
			providerId: "resend-9",
			error: null,
		});
	});
});
