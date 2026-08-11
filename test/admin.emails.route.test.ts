import { env } from "cloudflare:test";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "../app/db";
import {
	emailTemplates,
	events,
	organizationMembers,
	organizations,
	submissions,
	users,
} from "../app/db/schema";
import { createSession, hashPassword } from "../app/lib/auth";
import {
	action as editorAction,
	loader as editorLoader,
} from "../app/routes/admin.emails_.$key";
import { action, loader } from "../app/routes/admin.emails";

const CONTEXT = { cloudflare: { env, ctx: {} } };

async function seedAdminAndEvents() {
	const db = getDb(env);
	await db.insert(organizations).values({ id: "org1", name: "Org" });
	await db.insert(events).values([
		{ id: "e1", organizationId: "org1", name: "Event One", slug: "e-one" },
		{ id: "e2", organizationId: "org1", name: "Event Two", slug: "e-two" },
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
	await db.insert(emailTemplates).values([
		{
			id: "et1",
			eventId: "e1",
			key: "accept",
			name: "Accept Sessions",
			subject: "Your session was accepted",
			bodyHtml: "<p>Congratulations, you are in!</p>",
			category: "lifecycle",
			trigger: "manual",
		},
		{
			id: "et2",
			eventId: "e1",
			key: "reminder_5day",
			name: "Five Days Reminder",
			subject: "Five days left",
			bodyHtml: "<p>Soon</p>",
			category: "lifecycle",
			trigger: "auto",
		},
		// Same key on ANOTHER event — must never leak into e1's list/editor.
		{
			id: "et_other",
			eventId: "e2",
			key: "accept",
			name: "Other Event Accept",
			subject: "Other",
			bodyHtml: "<p>Other</p>",
			category: "lifecycle",
			trigger: "manual",
		},
	]);
	const setCookie = await createSession(env, "u_admin");
	return setCookie.split(";")[0] ?? "";
}

function req(url: string, cookie: string, init?: RequestInit) {
	const headers = new Headers(init?.headers);
	headers.set("Cookie", cookie);
	return new Request(url, { ...init, headers });
}

type LoaderResult = {
	data: {
		templates: Array<Record<string, unknown>>;
	};
};

describe("email templates list", () => {
	it("lists only the active event's templates", async () => {
		const cookie = await seedAdminAndEvents();
		const result = (await loader({
			context: CONTEXT,
			request: req("http://localhost/admin/emails", cookie),
			params: {},
		} as unknown as Parameters<typeof loader>[0])) as unknown as LoaderResult;
		expect(result.data.templates).toHaveLength(2);
		expect(result.data.templates.map((t) => t.name)).toEqual([
			"Accept Sessions",
			"Five Days Reminder",
		]);
	});

	it("redirects anonymous users to login (self-authenticating loader)", async () => {
		await seedAdminAndEvents();
		try {
			await loader({
				context: CONTEXT,
				request: new Request("http://localhost/admin/emails"),
				params: {},
			} as unknown as Parameters<typeof loader>[0]);
			expect.unreachable("loader should have thrown a redirect");
		} catch (thrown) {
			expect(thrown).toBeInstanceOf(Response);
			expect((thrown as Response).status).toBe(302);
		}
	});

	it("creates a custom template and lands on its editor", async () => {
		const cookie = await seedAdminAndEvents();
		const body = new URLSearchParams({ name: "Speaker announcement" });
		const response = (await action({
			context: CONTEXT,
			request: req("http://localhost/admin/emails", cookie, {
				method: "POST",
				body,
			}),
			params: {},
		} as unknown as Parameters<typeof action>[0])) as Response;
		expect(response.status).toBe(302);
		expect(response.headers.get("Location")).toBe(
			"/admin/emails/speaker_announcement",
		);
		const [row] = await getDb(env)
			.select()
			.from(emailTemplates)
			.where(
				and(
					eq(emailTemplates.eventId, "e1"),
					eq(emailTemplates.key, "speaker_announcement"),
				),
			);
		expect(row?.category).toBe("custom");
		expect(row?.trigger).toBe("manual");
	});

	it("rejects a duplicate name and the reserved 'history' name", async () => {
		const cookie = await seedAdminAndEvents();
		const post = (name: string) =>
			action({
				context: CONTEXT,
				request: req("http://localhost/admin/emails", cookie, {
					method: "POST",
					body: new URLSearchParams({ name }),
				}),
				params: {},
			} as unknown as Parameters<typeof action>[0]) as Promise<{
				fieldErrors?: { name?: string[] };
			}>;
		expect(await post("Speaker news")).toBeInstanceOf(Response); // first: created
		const dup = await post("Speaker news"); // same slug ⇒ unique(event, key) trips
		expect(dup.fieldErrors?.name?.[0]).toMatch(/already exists/);
		const reserved = await post("History");
		expect(reserved.fieldErrors?.name?.[0]).toMatch(/reserved/);
	});

	it("deletes custom templates but refuses lifecycle ones", async () => {
		const cookie = await seedAdminAndEvents();
		const db = getDb(env);
		await db.insert(emailTemplates).values({
			id: "et_custom",
			eventId: "e1",
			key: "blast",
			name: "Blast",
			category: "custom",
			trigger: "manual",
		});
		const post = (intent: string) =>
			action({
				context: CONTEXT,
				request: req("http://localhost/admin/emails", cookie, {
					method: "POST",
					body: new URLSearchParams({ intent }),
				}),
				params: {},
			} as unknown as Parameters<typeof action>[0]);

		const refused = (await post("delete:et1")) as { formError?: string };
		expect(refused.formError).toMatch(/can't be deleted/);
		expect(
			await db
				.select()
				.from(emailTemplates)
				.where(eq(emailTemplates.id, "et1")),
		).toHaveLength(1);

		const ok = (await post("delete:et_custom")) as Response;
		expect(ok.status).toBe(302);
		expect(
			await db
				.select()
				.from(emailTemplates)
				.where(eq(emailTemplates.id, "et_custom")),
		).toHaveLength(0);

		// A template belonging to another event is out of reach.
		const foreign = (await post("delete:et_other")) as { formError?: string };
		expect(foreign.formError).toMatch(/not found/i);
	});
});

describe("email template editor", () => {
	function editorArgs(cookie: string, key: string, init?: RequestInit) {
		return {
			context: CONTEXT,
			request: req(`http://localhost/admin/emails/${key}`, cookie, init),
			params: { key },
		} as unknown as Parameters<typeof editorAction>[0];
	}

	async function seedScheduledAcceptedSample() {
		const db = getDb(env);
		await db
			.update(events)
			.set({
				location: "Convention Center",
				timezone: "America/Los_Angeles",
			})
			.where(eq(events.id, "e1"));
		await db.insert(submissions).values({
			id: "s_scheduled",
			eventId: "e1",
			title: "Scheduled session",
			status: "accepted",
			startsAt: new Date("2026-10-13T17:00:00Z"),
			endsAt: new Date("2026-10-13T17:30:00Z"),
		});
	}

	it("keeps draft-reminder preview scheduling and location blank like delivery", async () => {
		const cookie = await seedAdminAndEvents();
		await seedScheduledAcceptedSample();
		await getDb(env).insert(emailTemplates).values({
			id: "et_reminder_1day",
			eventId: "e1",
			key: "reminder_1day",
			name: "One Day Reminder",
			category: "lifecycle",
			trigger: "auto",
		});

		for (const key of ["reminder_5day", "reminder_1day"]) {
			const result = (await editorLoader(
				editorArgs(cookie, key) as unknown as Parameters<
					typeof editorLoader
				>[0],
			)) as unknown as {
				data: { sampleCtx: Record<string, unknown> };
			};

			expect(result.data.sampleCtx).toMatchObject({
				session_date_time: null,
				starts_at: null,
				ends_at: null,
				session_room: null,
				location: null,
			});
		}
	});

	it("keeps decision preview scheduling and event location populated", async () => {
		const cookie = await seedAdminAndEvents();
		await seedScheduledAcceptedSample();

		const result = (await editorLoader(
			editorArgs(cookie, "accept") as unknown as Parameters<
				typeof editorLoader
			>[0],
		)) as unknown as {
			data: { sampleCtx: Record<string, unknown> };
		};

		expect(result.data.sampleCtx).toMatchObject({
			session_date_time: "Oct 13, 2026, 10:00 AM",
			starts_at: "Oct 13, 2026, 10:00 AM",
			ends_at: "Oct 13, 2026, 10:30 AM",
			location: "Convention Center",
		});
	});

	it("rejects a blank subject with a field error and leaves the row untouched", async () => {
		const cookie = await seedAdminAndEvents();
		const result = (await editorAction(
			editorArgs(cookie, "accept", {
				method: "POST",
				body: new URLSearchParams({
					subject: "",
					bodyHtml: "<p>clobbered?</p>",
					replyTo: "",
				}),
			}),
		)) as { fieldErrors?: { subject?: string[] }; ok: boolean };
		expect(result.ok).toBe(false);
		expect(result.fieldErrors?.subject?.[0]).toMatch(/required/i);
		const [row] = await getDb(env)
			.select()
			.from(emailTemplates)
			.where(eq(emailTemplates.id, "et1"));
		expect(row?.subject).toBe("Your session was accepted");
		expect(row?.bodyHtml).toBe("<p>Congratulations, you are in!</p>");
	});

	it("saves subject (emoji intact), body, and reply-to on the event's own template", async () => {
		const cookie = await seedAdminAndEvents();
		await editorAction(
			editorArgs(cookie, "accept", {
				method: "POST",
				body: new URLSearchParams({
					subject: "You're in! 🎉",
					bodyHtml:
						"<p>Congratulations, you are in!</p><p>See you in October — check your portal for onboarding tasks.</p>",
					replyTo: "organizer@example.com",
				}),
			}),
		);
		const [row] = await getDb(env)
			.select()
			.from(emailTemplates)
			.where(eq(emailTemplates.id, "et1"));
		expect(row?.subject).toBe("You're in! 🎉");
		expect(row?.replyTo).toBe("organizer@example.com");
		expect(row?.bodyHtml).toContain("See you in October");
		// The other event's same-key template is untouched.
		const [other] = await getDb(env)
			.select()
			.from(emailTemplates)
			.where(eq(emailTemplates.id, "et_other"));
		expect(other?.subject).toBe("Other");
	});

	it("rejects an invalid reply-to address", async () => {
		const cookie = await seedAdminAndEvents();
		const result = (await editorAction(
			editorArgs(cookie, "accept", {
				method: "POST",
				body: new URLSearchParams({
					subject: "S",
					bodyHtml: "<p>b</p>",
					replyTo: "not-an-email",
				}),
			}),
		)) as { fieldErrors?: { replyTo?: string[] } };
		expect(result.fieldErrors?.replyTo?.[0]).toBeTruthy();
	});

	it("404s for a key that exists only on another event", async () => {
		const cookie = await seedAdminAndEvents();
		const db = getDb(env);
		await db.insert(emailTemplates).values({
			id: "et_e2only",
			eventId: "e2",
			key: "e2_special",
			name: "E2 only",
			category: "custom",
			trigger: "manual",
		});
		try {
			await editorLoader(
				editorArgs(cookie, "e2_special") as unknown as Parameters<
					typeof editorLoader
				>[0],
			);
			expect.unreachable("loader should have thrown 404");
		} catch (thrown) {
			expect(thrown).toBeInstanceOf(Response);
			expect((thrown as Response).status).toBe(404);
		}
	});

	it("loader resolves the sample merge context from the active event", async () => {
		const cookie = await seedAdminAndEvents();
		const result = (await editorLoader(
			editorArgs(cookie, "accept") as unknown as Parameters<
				typeof editorLoader
			>[0],
		)) as unknown as {
			data: { template: { key: string }; sampleCtx: Record<string, unknown> };
		};
		expect(result.data.template.key).toBe("accept");
		expect(result.data.sampleCtx.event_name).toBe("Event One");
	});
});
