import { afterEach, describe, expect, it, vi } from "vitest";
import { createResendEmailSender } from "../app/ports/email";

// Oracle: the Resend Send API contract (endpoint, payload field names, the
// Idempotency-Key header) — from Resend's docs, not read off the adapter. These
// pin the mapping a refactor could silently break; fetch (the process boundary)
// is the only thing mocked.
const FROM = "OpenRostrum <noreply@test.example>";
const env = { RESEND_API_KEY: "re_test", EMAIL_FROM: FROM } as unknown as Env;

function mockFetch(status: number, json: unknown) {
	return vi.fn(async () => new Response(JSON.stringify(json), { status }));
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

	it("throws (never sends from a wrong domain) when EMAIL_FROM is unset", () => {
		const noFrom = { RESEND_API_KEY: "re_test" } as unknown as Env;
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

	it("throws on a non-2xx provider response so the caller can log + stay generic", async () => {
		vi.stubGlobal("fetch", mockFetch(422, { message: "bad" }));
		await expect(
			createResendEmailSender(env).send({
				to: "a@b.com",
				subject: "s",
				html: "h",
			}),
		).rejects.toThrow(/Resend send failed \(422\)/);
	});
});
