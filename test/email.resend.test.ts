import { env as workerEnv } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getDb } from "../app/db";
import { emailOutbox } from "../app/db/schema";
import { buildIcs } from "../app/lib/ics";
import {
	createResendEmailSender,
	EmailDeliveryError,
	EmailSendInFlightError,
	getEmailSender,
} from "../app/ports/email";

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

afterEach(async () => {
	vi.restoreAllMocks();
	await workerEnv.DB.batch([
		workerEnv.DB.prepare("DROP TRIGGER IF EXISTS fail_sent_reconciliation"),
		workerEnv.DB.prepare("DROP TRIGGER IF EXISTS fail_failed_reconciliation"),
	]);
});

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
		// dedupeKey names the send in Resend's log; the suffix scopes the key to
		// this exact payload (see the 409 invalid_idempotent_request case below).
		expect((init.headers as Record<string, string>)["Idempotency-Key"]).toMatch(
			/^k1:[0-9a-f]{32}$/,
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
			ics: "BEGIN:VCALENDAR\nMETHOD:PUBLISH\nEND:VCALENDAR",
		});

		const body = JSON.parse(
			(fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1]
				.body as string,
		);
		expect(body.attachments).toHaveLength(1);
		expect(body.attachments[0]).toMatchObject({
			filename: "invite.ics",
			content_type: "text/calendar; method=PUBLISH",
		});
		expect(atob(body.attachments[0].content)).toContain("BEGIN:VCALENDAR");
	});

	it("throws on a non-2xx provider response AND records a `failed` row with the reason", async () => {
		vi.stubGlobal("fetch", mockFetch(422, { message: "Invalid `to` field." }));
		const sending = createResendEmailSender(env).send({
			to: "a@b.com",
			subject: "s",
			html: "h",
			dedupeKey: "k-fail",
		});
		await expect(sending).rejects.toBeInstanceOf(EmailDeliveryError);
		await expect(sending).rejects.toThrow(/Resend send failed \(422\)/);

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
		const sending = createResendEmailSender(env).send({
			to: "a@b.com",
			subject: "s",
			html: "h",
		});
		await expect(sending).rejects.toBeInstanceOf(EmailDeliveryError);
		await expect(sending).rejects.toThrow(/network down/);

		const rows = await outboxRows();
		expect(rows).toHaveLength(1);
		expect(rows[0]?.status).toBe("failed");
		expect(rows[0]?.error).toContain("network down");
	});

	it("propagates D1 failure while recording provider success", async () => {
		await workerEnv.DB.prepare(`
			CREATE TRIGGER fail_sent_reconciliation
			BEFORE UPDATE OF status ON email_outbox
			WHEN NEW.status = 'sent'
			BEGIN
				SELECT RAISE(ABORT, 'forced sent reconciliation failure');
			END
		`).run();
		vi.stubGlobal("fetch", mockFetch(200, { id: "resend-unpersisted" }));

		const sending = createResendEmailSender(env).send({
			to: "a@b.com",
			subject: "s",
			html: "h",
			dedupeKey: "success-persistence-failure",
		});

		await expect(sending).rejects.not.toBeInstanceOf(EmailDeliveryError);
		await expect(sending).rejects.toThrow(
			/Failed query: update "email_outbox"/,
		);
		expect((await outboxRows())[0]).toMatchObject({ status: "queued" });
	});

	it("propagates D1 failure while recording provider rejection", async () => {
		await workerEnv.DB.prepare(`
			CREATE TRIGGER fail_failed_reconciliation
			BEFORE UPDATE OF status ON email_outbox
			WHEN NEW.status = 'failed'
			BEGIN
				SELECT RAISE(ABORT, 'forced failed reconciliation failure');
			END
		`).run();
		vi.stubGlobal("fetch", mockFetch(500, { message: "provider unavailable" }));

		const sending = createResendEmailSender(env).send({
			to: "a@b.com",
			subject: "s",
			html: "h",
			dedupeKey: "failure-persistence-failure",
		});

		await expect(sending).rejects.not.toBeInstanceOf(EmailDeliveryError);
		await expect(sending).rejects.toThrow(
			/Failed query: update "email_outbox"/,
		);
		expect((await outboxRows())[0]).toMatchObject({ status: "queued" });
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

	it("dedupes a concurrent key while its first provider call is in flight", async () => {
		let releaseProvider: (() => void) | undefined;
		let providerCalls = 0;
		const providerStarted = new Promise<void>((resolveStarted) => {
			vi.stubGlobal(
				"fetch",
				vi.fn(() => {
					providerCalls += 1;
					if (providerCalls > 1) {
						return Promise.resolve(
							new Response(JSON.stringify({ id: "resend-duplicate" }), {
								status: 200,
							}),
						);
					}
					return new Promise<Response>((resolve) => {
						releaseProvider = () =>
							resolve(
								new Response(JSON.stringify({ id: "resend-concurrent" }), {
									status: 200,
								}),
							);
						resolveStarted();
					});
				}),
			);
		});
		const fetchMock = vi.mocked(fetch);
		const sender = createResendEmailSender(env);
		const msg = {
			to: "a@b.com",
			subject: "s",
			html: "h",
			dedupeKey: "concurrent-k1",
			// The contract callers that keep delivered-state opt into.
			onInFlight: "reject" as const,
		};

		const first = sender.send(msg);
		await providerStarted;
		expect((await outboxRows())[0]).toMatchObject({
			status: "queued",
			error: null,
		});
		const second = sender.send(msg);
		await expect(second).rejects.toMatchObject({
			name: "EmailSendInFlightError",
		});
		releaseProvider?.();

		expect(await first).toMatchObject({
			id: "resend-concurrent",
			deduped: false,
		});
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(await outboxRows()).toHaveLength(1);
	});

	it("reports a concurrent claim as a duplicate for a caller that keeps no delivered-state", async () => {
		let releaseProvider: (() => void) | undefined;
		const providerStarted = new Promise<void>((resolveStarted) => {
			vi.stubGlobal(
				"fetch",
				vi.fn(
					() =>
						new Promise<Response>((resolve) => {
							releaseProvider = () =>
								resolve(
									new Response(JSON.stringify({ id: "resend-double-click" }), {
										status: 200,
									}),
								);
							resolveStarted();
						}),
				),
			);
		});
		const fetchMock = vi.mocked(fetch);
		const sender = createResendEmailSender(env);
		// No `onInFlight` — the default every route action gets. A double-clicked
		// invite button must be a no-op, never an error page.
		const msg = {
			to: "a@b.com",
			subject: "s",
			html: "h",
			dedupeKey: "double-click-k1",
		};

		const first = sender.send(msg);
		await providerStarted;
		const second = await sender.send(msg);
		releaseProvider?.();

		expect(second).toMatchObject({ deduped: true, suppressed: false });
		expect(second.id).not.toBe("");
		expect(await first).toMatchObject({
			id: "resend-double-click",
			deduped: false,
		});
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(await outboxRows()).toHaveLength(1);
	});

	it("keeps provider success terminal after a lease takeover", async () => {
		let resolveFirst: ((response: Response) => void) | undefined;
		let resolveSecond: ((response: Response) => void) | undefined;
		let firstStarted: (() => void) | undefined;
		let secondStarted: (() => void) | undefined;
		const firstProviderStarted = new Promise<void>((resolve) => {
			firstStarted = resolve;
		});
		const secondProviderStarted = new Promise<void>((resolve) => {
			secondStarted = resolve;
		});
		const fetchMock = vi
			.fn()
			.mockImplementationOnce(
				() =>
					new Promise<Response>((resolve) => {
						resolveFirst = resolve;
						firstStarted?.();
					}),
			)
			.mockImplementationOnce(
				() =>
					new Promise<Response>((resolve) => {
						resolveSecond = resolve;
						secondStarted?.();
					}),
			);
		vi.stubGlobal("fetch", fetchMock);
		vi.useFakeTimers();
		try {
			vi.setSystemTime(new Date("2026-08-11T18:00:00Z"));
			const sender = createResendEmailSender(env);
			const msg = {
				to: "a@b.com",
				subject: "s",
				html: "h",
				dedupeKey: "lease-takeover-k1",
			};
			const first = sender.send(msg);
			await firstProviderStarted;

			vi.setSystemTime(new Date("2026-08-11T18:06:00Z"));
			const second = sender.send(msg);
			await secondProviderStarted;

			resolveFirst?.(
				new Response(JSON.stringify({ id: "resend-first" }), { status: 200 }),
			);
			await expect(first).resolves.toMatchObject({ id: "resend-first" });
			expect((await outboxRows())[0]).toMatchObject({
				status: "sent",
				providerId: "resend-first",
			});

			resolveSecond?.(
				new Response(JSON.stringify({ message: "late failure" }), {
					status: 500,
				}),
			);
			await expect(second).resolves.toEqual({
				id: "resend-first",
				deduped: true,
				suppressed: false,
			});
			expect((await outboxRows())[0]).toMatchObject({
				status: "sent",
				providerId: "resend-first",
			});
		} finally {
			vi.useRealTimers();
		}
	});

	it("preserves the first confirmed provider success after a lease takeover", async () => {
		let resolveFirst: ((response: Response) => void) | undefined;
		let resolveSecond: ((response: Response) => void) | undefined;
		let firstStarted: (() => void) | undefined;
		let secondStarted: (() => void) | undefined;
		const firstProviderStarted = new Promise<void>((resolve) => {
			firstStarted = resolve;
		});
		const secondProviderStarted = new Promise<void>((resolve) => {
			secondStarted = resolve;
		});
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockImplementationOnce(
					() =>
						new Promise<Response>((resolve) => {
							resolveFirst = resolve;
							firstStarted?.();
						}),
				)
				.mockImplementationOnce(
					() =>
						new Promise<Response>((resolve) => {
							resolveSecond = resolve;
							secondStarted?.();
						}),
				),
		);
		vi.useFakeTimers();
		try {
			vi.setSystemTime(new Date("2026-08-11T18:00:00Z"));
			const sender = createResendEmailSender(env);
			const msg = {
				to: "a@b.com",
				subject: "s",
				html: "h",
				dedupeKey: "lease-takeover-two-successes",
			};
			const first = sender.send(msg);
			await firstProviderStarted;

			vi.setSystemTime(new Date("2026-08-11T18:06:00Z"));
			const second = sender.send(msg);
			await secondProviderStarted;
			resolveSecond?.(
				new Response(JSON.stringify({ id: "resend-second" }), { status: 200 }),
			);
			await expect(second).resolves.toMatchObject({ id: "resend-second" });

			resolveFirst?.(
				new Response(JSON.stringify({ id: "resend-first" }), { status: 200 }),
			);
			await expect(first).resolves.toEqual({
				id: "resend-second",
				deduped: true,
				suppressed: false,
			});
			expect((await outboxRows())[0]).toMatchObject({
				status: "sent",
				providerId: "resend-second",
			});
		} finally {
			vi.useRealTimers();
		}
	});

	it("a timed-out claimant cannot stamp its send onto a reclaimed, corrected row", async () => {
		// The reclaimer rewrites the row's payload (subject/html/ics) — it is the
		// delivery evidence AND the calendar ledger's source. A stale claimant that
		// completes afterwards must not sign that row with ITS provider id: the row
		// would attest content nobody was sent, and the reclaimer's genuinely
		// separate delivery would be filed as a duplicate of it.
		let resolveFirst: ((response: Response) => void) | undefined;
		let resolveSecond: ((response: Response) => void) | undefined;
		let firstStarted: (() => void) | undefined;
		let secondStarted: (() => void) | undefined;
		const firstProviderStarted = new Promise<void>((resolve) => {
			firstStarted = resolve;
		});
		const secondProviderStarted = new Promise<void>((resolve) => {
			secondStarted = resolve;
		});
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockImplementationOnce(
					() =>
						new Promise<Response>((resolve) => {
							resolveFirst = resolve;
							firstStarted?.();
						}),
				)
				.mockImplementationOnce(
					() =>
						new Promise<Response>((resolve) => {
							resolveSecond = resolve;
							secondStarted?.();
						}),
				),
		);
		vi.useFakeTimers();
		try {
			vi.setSystemTime(new Date("2026-08-11T18:00:00Z"));
			const sender = createResendEmailSender(env);
			const base = {
				to: "a@b.com",
				html: "h",
				dedupeKey: "stale-claimant-corrected",
				onInFlight: "reject" as const,
			};
			const first = sender.send({ ...base, subject: "wrong room" });
			await firstProviderStarted;

			vi.setSystemTime(new Date("2026-08-11T18:06:00Z"));
			const second = sender.send({ ...base, subject: "corrected room" });
			await secondProviderStarted;

			resolveFirst?.(
				new Response(JSON.stringify({ id: "resend-stale" }), { status: 200 }),
			);
			await expect(first).rejects.toBeInstanceOf(EmailSendInFlightError);

			resolveSecond?.(
				new Response(JSON.stringify({ id: "resend-corrected" }), {
					status: 200,
				}),
			);
			await expect(second).resolves.toMatchObject({
				id: "resend-corrected",
				deduped: false,
			});
			const rows = await outboxRows();
			expect(rows).toHaveLength(1);
			expect(rows[0]).toMatchObject({
				status: "sent",
				subject: "corrected room",
				providerId: "resend-corrected",
			});
		} finally {
			vi.useRealTimers();
		}
	});

	it("reports an unreconcilable claim as a delivery failure, not an unhandled fault", async () => {
		// A stale claimant whose row was reclaimed AND then resolved to `failed` by
		// someone else has no claim left to reconcile against. That is this
		// recipient's delivery outcome — a caller sending a batch must be able to
		// record it and carry on, not lose every other recipient's outcome to an
		// error page.
		let resolveFirst: ((response: Response) => void) | undefined;
		let firstStarted: (() => void) | undefined;
		const firstProviderStarted = new Promise<void>((resolve) => {
			firstStarted = resolve;
		});
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockImplementationOnce(
					() =>
						new Promise<Response>((resolve) => {
							resolveFirst = resolve;
							firstStarted?.();
						}),
				)
				.mockResolvedValueOnce(
					new Response(JSON.stringify({ message: "provider down" }), {
						status: 500,
					}),
				),
		);
		vi.useFakeTimers();
		try {
			vi.setSystemTime(new Date("2026-08-11T18:00:00Z"));
			const sender = createResendEmailSender(env);
			const base = {
				to: "a@b.com",
				html: "h",
				dedupeKey: "unreconcilable-claim",
			};
			const first = sender.send({ ...base, subject: "wrong room" });
			await firstProviderStarted;

			vi.setSystemTime(new Date("2026-08-11T18:06:00Z"));
			await expect(
				sender.send({ ...base, subject: "corrected room" }),
			).rejects.toBeInstanceOf(EmailDeliveryError);

			resolveFirst?.(
				new Response(JSON.stringify({ id: "resend-stale" }), { status: 200 }),
			);
			await expect(first).rejects.toBeInstanceOf(EmailDeliveryError);
			expect((await outboxRows())[0]).toMatchObject({
				status: "failed",
				subject: "corrected room",
			});
		} finally {
			vi.useRealTimers();
		}
	});

	it("reclaims an abandoned queued row instead of losing the send", async () => {
		const db = getDb(env);
		const [abandoned] = await db
			.insert(emailOutbox)
			.values({
				to: "a@b.com",
				subject: "s",
				html: "h",
				dedupeKey: "abandoned-k1",
				status: "queued",
				createdAt: new Date(Date.now() - 60 * 60 * 1000),
			})
			.returning({ id: emailOutbox.id });
		if (!abandoned) throw new Error("Expected abandoned outbox row");
		const fetchMock = mockFetch(200, { id: "resend-recovered" });
		vi.stubGlobal("fetch", fetchMock);

		const result = await createResendEmailSender(env).send({
			to: "a@b.com",
			subject: "s",
			html: "h",
			dedupeKey: "abandoned-k1",
		});

		expect(result).toMatchObject({
			id: "resend-recovered",
			deduped: false,
		});
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const rows = await outboxRows();
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			id: abandoned.id,
			status: "sent",
			providerId: "resend-recovered",
		});
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
	it("scopes the provider idempotency key to the payload, so a corrected retry is not a 409", async () => {
		// Resend replays a key for 24h and answers a REUSED key carrying a
		// different payload with 409 invalid_idempotent_request. A stable
		// dedupeKey would therefore make every corrected retry unsendable.
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ message: "boom" }), { status: 500 }),
			)
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ id: "resend-fix" }), { status: 200 }),
			);
		vi.stubGlobal("fetch", fetchMock);
		const sender = createResendEmailSender(env);
		const base = { to: "a@b.com", subject: "s", html: "old", dedupeKey: "k9" };

		await expect(sender.send(base)).rejects.toThrow(/500/);
		await sender.send({ ...base, html: "corrected" });

		const keyOf = (call: number) =>
			(
				fetchMock.mock.calls[call]?.[1] as RequestInit & {
					headers: Record<string, string>;
				}
			).headers["Idempotency-Key"];
		expect(keyOf(0)).toBeTruthy();
		expect(keyOf(1)).not.toBe(keyOf(0));
	});

	// Attachment-free baseline. It does NOT certify the invariant for invites —
	// the ICS case below does, and it is the one that can actually drift.
	it("reuses the provider idempotency key when the retried payload is identical", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ message: "boom" }), { status: 500 }),
			)
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ id: "resend-same" }), { status: 200 }),
			);
		vi.stubGlobal("fetch", fetchMock);
		const sender = createResendEmailSender(env);
		const msg = { to: "a@b.com", subject: "s", html: "h", dedupeKey: "k10" };

		await expect(sender.send(msg)).rejects.toThrow(/500/);
		await sender.send(msg);

		const keyOf = (call: number) =>
			(
				fetchMock.mock.calls[call]?.[1] as RequestInit & {
					headers: Record<string, string>;
				}
			).headers["Idempotency-Key"];
		expect(keyOf(1)).toBe(keyOf(0));
	});

	it("reuses the provider idempotency key when a resumed send re-renders the same invite", async () => {
		// DTSTAMP is "when this payload was produced" (RFC 5545 §3.8.7.2), minted
		// from the wall clock on every render — it is not part of what the invite
		// SAYS. A send resumed after its lease re-renders the identical invite a
		// second later; if that stamp reaches the provider key, Resend sees a new
		// send and the speaker gets a second "You're accepted".
		const invite = {
			calendarName: "Test Event",
			method: "PUBLISH" as const,
			events: [
				{
					uid: "sub-1@openrostrum",
					start: new Date("2026-09-01T09:00:00Z"),
					end: new Date("2026-09-01T10:00:00Z"),
					title: "Keynote",
					sequence: 0,
				},
			],
		};
		vi.useFakeTimers();
		let firstRender: string;
		let secondRender: string;
		try {
			vi.setSystemTime(new Date("2026-08-12T07:36:12Z"));
			firstRender = buildIcs(invite);
			vi.setSystemTime(new Date("2026-08-12T07:36:13Z"));
			secondRender = buildIcs(invite);
		} finally {
			vi.useRealTimers();
		}
		expect(secondRender).not.toBe(firstRender);
		expect(secondRender.replace(/^DTSTAMP:.*$/gm, "")).toBe(
			firstRender.replace(/^DTSTAMP:.*$/gm, ""),
		);

		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ message: "boom" }), { status: 500 }),
			)
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ id: "resend-invite" }), { status: 200 }),
			);
		vi.stubGlobal("fetch", fetchMock);
		const sender = createResendEmailSender(env);
		const base = {
			to: "a@b.com",
			subject: "You're accepted",
			html: "h",
			dedupeKey: "k12",
		};

		await expect(sender.send({ ...base, ics: firstRender })).rejects.toThrow(
			/500/,
		);
		await sender.send({ ...base, ics: secondRender });

		const keyOf = (call: number) =>
			(
				fetchMock.mock.calls[call]?.[1] as RequestInit & {
					headers: Record<string, string>;
				}
			).headers["Idempotency-Key"];
		expect(keyOf(1)).toBe(keyOf(0));
	});

	it("re-keys when the resumed send carries a moved invite", async () => {
		// The inverse of the case above: normalizing DTSTAMP out must not blind the
		// key to a real content change, or a corrected invite hits Resend's 409
		// invalid_idempotent_request and can never be sent at all.
		const at = (hour: number) =>
			buildIcs({
				calendarName: "Test Event",
				method: "PUBLISH" as const,
				events: [
					{
						uid: "sub-1@openrostrum",
						start: new Date(
							`2026-09-01T${String(hour).padStart(2, "0")}:00:00Z`,
						),
						end: new Date(
							`2026-09-01T${String(hour + 1).padStart(2, "0")}:00:00Z`,
						),
						title: "Keynote",
						sequence: 0,
					},
				],
			});
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ message: "boom" }), { status: 500 }),
			)
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ id: "resend-moved" }), { status: 200 }),
			);
		vi.stubGlobal("fetch", fetchMock);
		const sender = createResendEmailSender(env);
		const base = { to: "a@b.com", subject: "s", html: "h", dedupeKey: "k13" };

		await expect(sender.send({ ...base, ics: at(9) })).rejects.toThrow(/500/);
		await sender.send({ ...base, ics: at(14) });

		const keyOf = (call: number) =>
			(
				fetchMock.mock.calls[call]?.[1] as RequestInit & {
					headers: Record<string, string>;
				}
			).headers["Idempotency-Key"];
		expect(keyOf(1)).not.toBe(keyOf(0));
	});

	it("records the retried payload on the row it reclaims", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ message: "boom" }), { status: 500 }),
			)
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ id: "resend-payload" }), { status: 200 }),
			);
		vi.stubGlobal("fetch", fetchMock);
		const sender = createResendEmailSender(env);
		const base = {
			to: "a@b.com",
			subject: "old subject",
			html: "<p>old</p>",
			dedupeKey: "k11",
		};

		await expect(sender.send(base)).rejects.toThrow(/500/);
		await sender.send({
			...base,
			subject: "corrected subject",
			html: "<p>corrected</p>",
			ics: "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n",
		});

		const rows = await getDb(env)
			.select()
			.from(emailOutbox)
			.where(eq(emailOutbox.dedupeKey, "k11"));
		expect(rows).toHaveLength(1);
		// The outbox row is the delivery evidence AND the calendar-invite ledger's
		// source: a stale payload here would record an invite nobody received.
		expect(rows[0]).toMatchObject({
			status: "sent",
			subject: "corrected subject",
			html: "<p>corrected</p>",
			icsAttachment: "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n",
		});
	});
});

// The local sink is the SAME ledger with no provider behind it: self-hosters
// without a Resend key run on it, and every local verification of a retry flow
// reads it. Its dedupe rule must therefore mean what the prod adapter's means —
// "already delivered", not merely "this key was tried once".
describe("Local email sink adapter", () => {
	const localEnv = {
		...workerEnv,
		RESEND_API_KEY: undefined,
		EMAIL_FROM: FROM,
	} as unknown as Env;

	it("dedupes a key that already reached the recipient", async () => {
		const sender = getEmailSender(localEnv);
		const msg = { to: "local@b.com", subject: "s", html: "h", dedupeKey: "l1" };

		const first = await sender.send(msg);
		const second = await sender.send(msg);

		expect(first.deduped).toBe(false);
		expect(second).toMatchObject({ id: first.id, deduped: true });
		const rows = await getDb(localEnv)
			.select()
			.from(emailOutbox)
			.where(eq(emailOutbox.dedupeKey, "l1"));
		expect(rows).toHaveLength(1);
	});

	it("retries a `failed` row in place instead of reporting it as delivered", async () => {
		const db = getDb(localEnv);
		await db.insert(emailOutbox).values({
			id: "local-failed",
			dedupeKey: "l2",
			to: "local@b.com",
			subject: "stale subject",
			html: "<p>stale</p>",
			status: "failed",
			error: "provider rejected",
		});

		const retry = await getEmailSender(localEnv).send({
			to: "local@b.com",
			subject: "corrected subject",
			html: "<p>corrected</p>",
			ics: "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n",
			dedupeKey: "l2",
		});

		expect(retry).toMatchObject({ id: "local-failed", deduped: false });
		const rows = await db
			.select()
			.from(emailOutbox)
			.where(eq(emailOutbox.dedupeKey, "l2"));
		expect(rows).toHaveLength(1);
		// The row is the delivery evidence, so it must show what the retry sent.
		expect(rows[0]).toMatchObject({
			status: "sent",
			subject: "corrected subject",
			html: "<p>corrected</p>",
			icsAttachment: "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n",
			error: null,
		});
	});
});
