import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "../app/db";
import { DECISION_STATUS, SUBMISSION_STATUS } from "../app/db/constants";
import {
	contacts,
	emailOutbox,
	emailSuppressions,
	emailTemplates,
	events,
	organizations,
	participants,
	portals,
	rooms,
	type Submission,
	submissions,
	taskAssignments,
	tasks,
	users,
} from "../app/db/schema";
import {
	canReceiveDecision,
	sendDecisionEmails,
	transitionSubmissions,
	withdrawSubmission,
} from "../app/domain/accept";

const db = () => getDb(env);

async function seedBase() {
	const d = db();
	await d.insert(organizations).values({ id: "org1", name: "Org" });
	await d.insert(events).values({
		id: "e1",
		organizationId: "org1",
		name: "DemoConf",
		slug: "democonf",
		timezone: "America/Los_Angeles",
		location: "Sandbox Center",
		startsAt: new Date("2026-10-12T00:00:00Z"),
		endsAt: new Date("2026-10-14T00:00:00Z"),
	});
	return d;
}

async function seedOnboardingTasks() {
	await db()
		.insert(tasks)
		.values([
			{
				id: "task_hotel",
				eventId: "e1",
				name: "Hotel Stay Requirement",
				type: "contact",
				isOnboardingDefault: true,
				dueInDays: 14,
			},
			{
				id: "task_flight",
				eventId: "e1",
				name: "Flight Reimbursement",
				type: "contact",
				isOnboardingDefault: true,
			},
			{
				id: "task_slides",
				eventId: "e1",
				name: "Upload Slides",
				type: "submission",
				isOnboardingDefault: true,
			},
			{
				id: "task_group",
				eventId: "e1",
				name: "Group Kickoff",
				type: "group",
				isOnboardingDefault: true,
			},
			{
				id: "task_extra",
				eventId: "e1",
				name: "Optional Extra",
				type: "contact",
				isOnboardingDefault: false,
			},
		]);
}

async function insertSubmission(
	over: Partial<typeof submissions.$inferInsert> = {},
): Promise<Submission> {
	const [row] = await db()
		.insert(submissions)
		.values({ eventId: "e1", title: "Talk", ...over })
		.returning();
	if (!row) throw new Error("insert failed");
	return row;
}

async function addSpeaker(
	submissionId: string,
	contactId: string,
	email: string,
	over: Partial<typeof participants.$inferInsert> = {},
) {
	const d = db();
	const existing = await d
		.select({ id: contacts.id })
		.from(contacts)
		.where(eq(contacts.id, contactId));
	if (existing.length === 0) {
		await d.insert(contacts).values({
			id: contactId,
			eventId: "e1",
			email,
			firstName: "F",
			lastName: "L",
		});
	}
	await d.insert(participants).values({
		submissionId,
		contactId,
		role: "speaker",
		...over,
	});
}

async function seedDecisionTemplates() {
	await db()
		.insert(emailTemplates)
		.values([
			{
				id: "et_accept",
				eventId: "e1",
				key: "accept",
				name: "Accept Sessions",
				subject: "Your session was accepted",
				bodyHtml: "<p>Congratulations, you are in!</p>",
			},
			{
				id: "et_decline",
				eventId: "e1",
				key: "decline",
				name: "Decline Sessions",
				subject: "Update on your submission",
				bodyHtml: "<p>Thank you for submitting.</p>",
			},
		]);
}

describe("transition matrix", () => {
	it("allows every submitted status into every decision status; drafts never move", async () => {
		const d = await seedBase();
		for (const from of SUBMISSION_STATUS) {
			for (const to of DECISION_STATUS) {
				const row = await insertSubmission({ status: from });
				const [result] = await transitionSubmissions(d, [row], to);
				const [after] = await d
					.select({ status: submissions.status })
					.from(submissions)
					.where(eq(submissions.id, row.id));
				if (from === "draft") {
					expect(result?.ok, `${from} → ${to}`).toBe(false);
					expect(after?.status, `${from} → ${to}`).toBe("draft");
				} else {
					expect(result?.ok, `${from} → ${to}`).toBe(true);
					expect(after?.status, `${from} → ${to}`).toBe(to);
				}
			}
		}
	});

	it("stamps statusChangedAt on a real change and never auto-sends email", async () => {
		const d = await seedBase();
		const row = await insertSubmission({ status: "pending" });
		await transitionSubmissions(d, [row], "accept_queue");
		const [after] = await d
			.select()
			.from(submissions)
			.where(eq(submissions.id, row.id));
		expect(after?.statusChangedAt).toBeInstanceOf(Date);
		expect(after?.notifiedAt).toBeNull();
		expect(await d.select().from(emailOutbox)).toHaveLength(0);
	});

	it("exposes draft refusal through canReceiveDecision for callers that pre-filter", () => {
		expect(canReceiveDecision("draft").ok).toBe(false);
		expect(canReceiveDecision("withdrawn").ok).toBe(true);
	});
});

describe("accept auto-provisioning", () => {
	it("mints onboarding assignments for every speaker, links accounts by email, bumps content to in_review", async () => {
		const d = await seedBase();
		await seedOnboardingTasks();
		await d.insert(users).values({
			id: "u_jun",
			email: "jun.park@example.com", // accounts store the normalized form
			passwordHash: "x",
			role: "speaker",
		});
		const row = await insertSubmission({ status: "pending" });
		await addSpeaker(row.id, "c_alex", "alex.okafor@example.com", {
			isPrimary: true,
		});
		// Cased contact email must still match the existing account.
		await addSpeaker(row.id, "c_jun", "Jun.Park@Example.com");
		// A moderator is a participant but NOT a speaker — no onboarding tasks.
		await d.insert(contacts).values({
			id: "c_mod",
			eventId: "e1",
			email: "mod@example.com",
			firstName: "M",
			lastName: "Od",
		});
		await d.insert(participants).values({
			submissionId: row.id,
			contactId: "c_mod",
			role: "moderator",
		});

		const before = Date.now();
		await transitionSubmissions(d, [row], "accepted");

		const assignments = await d.select().from(taskAssignments);
		// 2 speakers × (hotel + flight contact tasks + slides submission task);
		// the group-type task has no assignable target and the non-onboarding
		// task is never auto-assigned.
		expect(assignments).toHaveLength(6);
		expect(assignments.filter((a) => a.contactId === "c_mod")).toHaveLength(0);
		expect(assignments.filter((a) => a.taskId === "task_extra")).toHaveLength(
			0,
		);
		expect(assignments.filter((a) => a.taskId === "task_group")).toHaveLength(
			0,
		);
		const slides = assignments.filter((a) => a.taskId === "task_slides");
		expect(slides.map((a) => a.submissionId)).toEqual([row.id, row.id]);
		const hotel = assignments.find(
			(a) => a.taskId === "task_hotel" && a.contactId === "c_alex",
		);
		expect(hotel?.submissionId).toBeNull();
		expect(hotel?.status).toBe("incomplete");
		// dueAt = accepted-at + dueInDays.
		const due = hotel?.dueAt?.getTime() ?? 0;
		expect(Math.abs(due - (before + 14 * 86_400_000))).toBeLessThan(10_000);
		const flight = assignments.find(
			(a) => a.taskId === "task_flight" && a.contactId === "c_alex",
		);
		expect(flight?.dueAt).toBeNull();

		const [jun] = await d
			.select()
			.from(contacts)
			.where(eq(contacts.id, "c_jun"));
		expect(jun?.userId).toBe("u_jun");
		const [alex] = await d
			.select()
			.from(contacts)
			.where(eq(contacts.id, "c_alex"));
		expect(alex?.userId).toBeNull(); // no account exists — accept never mints one

		const [after] = await d
			.select()
			.from(submissions)
			.where(eq(submissions.id, row.id));
		expect(after?.contentStatus).toBe("in_review");
		// Accept provisions silently — the outbox stays empty.
		expect(await d.select().from(emailOutbox)).toHaveLength(0);
	});

	it("never demotes already-approved content on re-accept", async () => {
		const d = await seedBase();
		const row = await insertSubmission({
			status: "pending",
			contentStatus: "approved",
		});
		await transitionSubmissions(d, [row], "accepted");
		const [after] = await d
			.select()
			.from(submissions)
			.where(eq(submissions.id, row.id));
		expect(after?.contentStatus).toBe("approved");
	});

	it("re-accepting is idempotent: no duplicate assignments, completed work untouched", async () => {
		const d = await seedBase();
		await seedOnboardingTasks();
		const row = await insertSubmission({ status: "pending" });
		await addSpeaker(row.id, "c_alex", "alex.okafor@example.com");
		await addSpeaker(row.id, "c_jun", "jun.park@example.com");

		await transitionSubmissions(d, [row], "accepted");
		expect(await d.select().from(taskAssignments)).toHaveLength(6);

		// The speaker fills a task in — a re-accept must not clobber it.
		const [hotel] = await d
			.select()
			.from(taskAssignments)
			.where(eq(taskAssignments.taskId, "task_hotel"))
			.limit(1);
		if (!hotel) throw new Error("missing fixture");
		await d
			.update(taskAssignments)
			.set({
				status: "complete",
				response: { "Check-in": "2026-10-11" },
				completedAt: new Date(),
			})
			.where(eq(taskAssignments.id, hotel.id));

		// Same-status re-apply AND a full pending round-trip both re-run the
		// provisioning; counts must not move.
		const [fresh1] = await d
			.select()
			.from(submissions)
			.where(eq(submissions.id, row.id));
		if (!fresh1) throw new Error("missing fixture");
		await transitionSubmissions(d, [fresh1], "accepted");
		await transitionSubmissions(d, [fresh1], "pending");
		const [fresh2] = await d
			.select()
			.from(submissions)
			.where(eq(submissions.id, row.id));
		if (!fresh2) throw new Error("missing fixture");
		await transitionSubmissions(d, [fresh2], "accepted");

		const assignments = await d.select().from(taskAssignments);
		expect(assignments).toHaveLength(6);
		const kept = assignments.find((a) => a.id === hotel.id);
		expect(kept?.status).toBe("complete");
		expect(kept?.response).toEqual({ "Check-in": "2026-10-11" });
		// Leaving accepted never un-provisions (responses must survive).
		expect(await d.select().from(emailOutbox)).toHaveLength(0);
	});

	it("bulk over mixed statuses transitions the legal rows and reports the draft", async () => {
		const d = await seedBase();
		await seedOnboardingTasks();
		const pending = await insertSubmission({ status: "pending" });
		const queued = await insertSubmission({ status: "accept_queue" });
		const draft = await insertSubmission({ status: "draft" });
		const withdrawn = await insertSubmission({
			status: "withdrawn",
			withdrawnAt: new Date(),
			withdrawnById: null,
			withdrawnReason: "Visa denied",
		});
		await addSpeaker(pending.id, "c_a", "a@example.com");
		await addSpeaker(queued.id, "c_b", "b@example.com");

		const results = await transitionSubmissions(
			d,
			[pending, queued, draft, withdrawn],
			"accepted",
		);
		expect(results.filter((r) => r.ok).map((r) => r.submissionId)).toEqual([
			pending.id,
			queued.id,
			withdrawn.id,
		]);
		expect(results.find((r) => r.submissionId === draft.id)?.reason).toMatch(
			/draft/i,
		);

		const all = await d.select().from(submissions);
		const byId = new Map(all.map((s) => [s.id, s]));
		expect(byId.get(pending.id)?.status).toBe("accepted");
		expect(byId.get(queued.id)?.status).toBe("accepted");
		expect(byId.get(draft.id)?.status).toBe("draft");
		expect(byId.get(withdrawn.id)?.status).toBe("accepted");
		// Undoing a withdrawal (any non-declined target) clears its metadata.
		expect(byId.get(withdrawn.id)?.withdrawnReason).toBeNull();
		expect(byId.get(withdrawn.id)?.withdrawnAt).toBeNull();
		// 2 speakers × 3 assignable onboarding tasks.
		expect(await d.select().from(taskAssignments)).toHaveLength(6);
	});

	it("a speaker's second accepted submission mints its own submission-task assignment; re-accepting either changes nothing", async () => {
		const d = await seedBase();
		await seedOnboardingTasks();
		const first = await insertSubmission({ status: "pending", title: "First" });
		const second = await insertSubmission({
			status: "pending",
			title: "Second",
		});
		await addSpeaker(first.id, "c_marco", "marco@example.com");
		await d.insert(participants).values({
			submissionId: second.id,
			contactId: "c_marco",
			role: "speaker",
		});

		await transitionSubmissions(d, [first], "accepted");
		await transitionSubmissions(d, [second], "accepted");

		// Submission-scoped tasks are one per (task, contact, submission): each
		// accepted talk carries its own slides upload.
		const slides = await d
			.select()
			.from(taskAssignments)
			.where(eq(taskAssignments.taskId, "task_slides"));
		expect(slides.map((a) => a.submissionId).sort()).toEqual(
			[first.id, second.id].sort(),
		);
		expect(slides.every((a) => a.contactId === "c_marco")).toBe(true);
		// Contact-scoped tasks stay shared per person — exactly one each.
		expect(await d.select().from(taskAssignments)).toHaveLength(4);

		// Re-accepting EITHER submission is an idempotent replay: nothing new.
		const fresh = await d.select().from(submissions);
		const byId = new Map(fresh.map((s) => [s.id, s]));
		const fresh1 = byId.get(first.id);
		const fresh2 = byId.get(second.id);
		if (!fresh1 || !fresh2) throw new Error("missing fixture");
		await transitionSubmissions(d, [fresh1], "accepted");
		await transitionSubmissions(d, [fresh2], "accepted");
		const after = await d.select().from(taskAssignments);
		expect(after).toHaveLength(4);
		expect(
			after
				.filter((a) => a.taskId === "task_slides")
				.map((a) => a.id)
				.sort(),
		).toEqual(slides.map((a) => a.id).sort());
	});

	it("accepting a speaker's two submissions in ONE bulk call plans contact tasks once and submission tasks per talk", async () => {
		const d = await seedBase();
		await seedOnboardingTasks();
		const first = await insertSubmission({ status: "pending", title: "First" });
		const second = await insertSubmission({
			status: "pending",
			title: "Second",
		});
		await addSpeaker(first.id, "c_marco", "marco@example.com");
		await d.insert(participants).values({
			submissionId: second.id,
			contactId: "c_marco",
			role: "speaker",
		});

		await transitionSubmissions(d, [first, second], "accepted");

		const assignments = await d.select().from(taskAssignments);
		// hotel + flight (shared) + one slides row per accepted talk.
		expect(assignments).toHaveLength(4);
		expect(
			assignments
				.filter((a) => a.taskId === "task_slides")
				.map((a) => a.submissionId)
				.sort(),
		).toEqual([first.id, second.id].sort());
	});

	it("the decline path keeps a withdrawal's who/when/why — including through the queue", async () => {
		const d = await seedBase();
		const row = await insertSubmission({
			status: "withdrawn",
			withdrawnAt: new Date(),
			withdrawnReason: "Visa denied",
		});
		// The ordinary resolution routes through the decline queue first; the
		// record must survive both hops.
		await transitionSubmissions(d, [row], "decline_queue");
		const [queued] = await d
			.select()
			.from(submissions)
			.where(eq(submissions.id, row.id));
		expect(queued?.status).toBe("decline_queue");
		expect(queued?.withdrawnReason).toBe("Visa denied");
		if (!queued) throw new Error("missing fixture");
		await transitionSubmissions(d, [queued], "declined");
		const [after] = await d
			.select()
			.from(submissions)
			.where(eq(submissions.id, row.id));
		expect(after?.status).toBe("declined");
		expect(after?.withdrawnReason).toBe("Visa denied");
		expect(after?.withdrawnAt).toBeInstanceOf(Date);
	});
});

describe("withdrawal", () => {
	it("requires a reason and refuses silently-empty ones", async () => {
		const d = await seedBase();
		const row = await insertSubmission({ status: "accepted" });
		const result = await withdrawSubmission(d, {
			submission: row,
			byUserId: "u_any",
			reason: "   ",
		});
		expect(result.ok).toBe(false);
		const [after] = await d
			.select()
			.from(submissions)
			.where(eq(submissions.id, row.id));
		expect(after?.status).toBe("accepted");
	});

	it("records who/when/why and unschedules the session", async () => {
		const d = await seedBase();
		await d.insert(users).values({
			id: "u_dana",
			email: "dana.kim@example.com",
			passwordHash: "x",
			role: "speaker",
		});
		await d
			.insert(rooms)
			.values({ id: "room_a", eventId: "e1", name: "Room A" });
		const row = await insertSubmission({
			status: "accepted",
			title: "Shipping .ics That Gmail Actually Parses",
			description: "Full content stays intact.",
			startsAt: new Date("2026-10-13T17:00:00Z"),
			endsAt: new Date("2026-10-13T17:30:00Z"),
			roomId: "room_a",
		});
		const result = await withdrawSubmission(d, {
			submission: row,
			byUserId: "u_dana",
			reason: "Visa denied — I can't travel to the US in October.",
		});
		expect(result.ok).toBe(true);
		const [after] = await d
			.select()
			.from(submissions)
			.where(eq(submissions.id, row.id));
		expect(after?.status).toBe("withdrawn");
		expect(after?.withdrawnById).toBe("u_dana");
		expect(after?.withdrawnReason).toBe(
			"Visa denied — I can't travel to the US in October.",
		);
		expect(after?.withdrawnAt).toBeInstanceOf(Date);
		// No withdrawn ghost on the agenda grid.
		expect(after?.startsAt).toBeNull();
		expect(after?.endsAt).toBeNull();
		expect(after?.roomId).toBeNull();
		// Nothing wiped.
		expect(after?.title).toBe("Shipping .ics That Gmail Actually Parses");
		expect(after?.description).toBe("Full content stays intact.");
	});

	it("cannot withdraw twice", async () => {
		const d = await seedBase();
		await d.insert(users).values({
			id: "u_x",
			email: "ux@example.com",
			passwordHash: "x",
			role: "speaker",
		});
		const row = await insertSubmission({ status: "accepted" });
		await withdrawSubmission(d, {
			submission: row,
			byUserId: "u_x",
			reason: "First",
		});
		const [after1] = await d
			.select()
			.from(submissions)
			.where(eq(submissions.id, row.id));
		if (!after1) throw new Error("missing fixture");
		const again = await withdrawSubmission(d, {
			submission: after1,
			byUserId: "u_x",
			reason: "Second",
		});
		expect(again.ok).toBe(false);
		expect(after1.withdrawnReason).toBe("First");
	});
});

describe("send decisions", () => {
	it("sends one templated accept email per submission with the right .ics, stamps notifiedAt", async () => {
		const d = await seedBase();
		await seedDecisionTemplates();
		await d
			.insert(rooms)
			.values({ id: "room_a", eventId: "e1", name: "Room A" });
		const scheduled = await insertSubmission({
			status: "accept_queue",
			title: "Edge-Native Vector Search on D1",
			startsAt: new Date("2026-10-13T17:00:00Z"),
			endsAt: new Date("2026-10-13T17:30:00Z"),
			roomId: "room_a",
		});
		const unscheduled = await insertSubmission({
			status: "accept_queue",
			title: "Shipping .ics That Gmail Actually Parses",
		});
		await addSpeaker(scheduled.id, "c_marco", "marco.silva@example.com", {
			isPrimary: true,
		});
		await addSpeaker(unscheduled.id, "c_dana", "dana.kim@example.com", {
			isPrimary: true,
		});
		const [event] = await d.select().from(events).where(eq(events.id, "e1"));
		if (!event) throw new Error("missing fixture");

		const results = await sendDecisionEmails(d, env, {
			event,
			rows: [scheduled, unscheduled],
			decision: "accept",
			idempotencyKey: "key-1",
		});
		expect(results.every((r) => r.ok && !r.deduped)).toBe(true);

		const outbox = await d.select().from(emailOutbox);
		expect(outbox).toHaveLength(2);
		expect(new Set(outbox.map((o) => o.to))).toEqual(
			new Set(["marco.silva@example.com", "dana.kim@example.com"]),
		);
		for (const row of outbox) {
			expect(row.subject).toBe("Your session was accepted");
			expect(row.templateId).toBe("et_accept");
		}
		const marcoMail = outbox.find((o) => o.to === "marco.silva@example.com");
		// Scheduled session → exact times + room in the invite.
		expect(marcoMail?.icsAttachment).toContain("BEGIN:VCALENDAR");
		expect(marcoMail?.icsAttachment).toContain("DTSTART:20261013T170000Z");
		expect(marcoMail?.icsAttachment).toContain("LOCATION:Room A");
		// The body names the session the decision covers.
		expect(marcoMail?.html).toContain("Edge-Native Vector Search on D1");
		const danaMail = outbox.find((o) => o.to === "dana.kim@example.com");
		// Unscheduled session → save-the-date hold spanning the event.
		expect(danaMail?.icsAttachment).toContain("DTSTART:20261012T000000Z");
		expect(danaMail?.icsAttachment).toContain("DTEND:20261014T000000Z");
		expect(danaMail?.html).toContain("to be announced");

		const after = await d.select().from(submissions);
		for (const s of after) {
			expect(s.notifiedAt).toBeInstanceOf(Date);
			// The send itself never flips status — that is the caller's second step.
			expect(s.status).toBe("accept_queue");
		}
	});

	// The template editor previews rendered merge tags, so the send must run
	// the same renderer — shipping the raw template means a speaker receives
	// a literal {{first_name}} in a delivered email.
	it("resolves merge tags in the SENT subject and body — never a literal {{tag}}", async () => {
		const d = await seedBase();
		await d.insert(portals).values({
			id: "portal1",
			eventId: "e1",
			publicId: "pub-abc",
		});
		await d.insert(emailTemplates).values({
			id: "et_accept",
			eventId: "e1",
			key: "accept",
			name: "Accept Sessions",
			subject: "{{first_name}}, you're in at {{event_name}}!",
			bodyHtml:
				"<p>Hi {{full_name}}, your talk {{session_title}} is confirmed. Portal: {{portal_link}}. Unknown: {{no_such_tag}}</p>",
		});
		const row = await insertSubmission({
			status: "accept_queue",
			title: "Rendering Emails Right",
		});
		await d.insert(contacts).values({
			id: "c_priya",
			eventId: "e1",
			email: "priya@example.com",
			firstName: "Priya",
			lastName: "Patel",
		});
		await d.insert(participants).values({
			submissionId: row.id,
			contactId: "c_priya",
			role: "speaker",
			isPrimary: true,
		});
		const [event] = await d.select().from(events).where(eq(events.id, "e1"));
		if (!event) throw new Error("missing fixture");

		const results = await sendDecisionEmails(d, env, {
			event,
			rows: [row],
			decision: "accept",
			idempotencyKey: "render-key",
			origin: "https://openrostrum.example",
		});
		expect(results[0]?.ok).toBe(true);

		const [mail] = await d.select().from(emailOutbox);
		expect(mail?.subject).toBe("Priya, you're in at DemoConf!");
		expect(mail?.html).toContain(
			"Hi Priya Patel, your talk Rendering Emails Right is confirmed",
		);
		expect(mail?.html).toContain(
			"https://openrostrum.example/portals/democonf/pub-abc",
		);
		// Template-pipeline policy: every tag is consumed — no literal {{...}}
		// ever reaches a recipient.
		expect(mail?.subject).not.toMatch(/\{\{/);
		expect(mail?.html).not.toMatch(/\{\{/);
	});

	it("renders the complete classic decision template with separate schedule values and location", async () => {
		const d = await seedBase();
		await d
			.insert(rooms)
			.values({ id: "room_classic", eventId: "e1", name: "Main Stage" });
		await d.insert(emailTemplates).values({
			id: "et_accept",
			eventId: "e1",
			key: "accept",
			name: "Classic Accept Sessions",
			subject: "{{{recipient.first_name}}}: {{{title}}} at {{{event.name}}}",
			bodyHtml:
				"<p>{{{recipient.last_name}}}|{{{title}}}|{{{starts_at}}}|{{{ends_at}}}|{{{location}}}</p>",
		});
		const row = await insertSubmission({
			status: "accept_queue",
			title: "Classic Rendering",
			startsAt: new Date("2026-10-13T17:00:00Z"),
			endsAt: new Date("2026-10-13T17:30:00Z"),
			roomId: "room_classic",
		});
		await d.insert(contacts).values({
			id: "c_classic",
			eventId: "e1",
			email: "priya@example.com",
			firstName: "Priya",
			lastName: "Patel",
		});
		await d.insert(participants).values({
			submissionId: row.id,
			contactId: "c_classic",
			role: "speaker",
			isPrimary: true,
		});
		const [event] = await d.select().from(events).where(eq(events.id, "e1"));
		if (!event) throw new Error("missing fixture");

		await sendDecisionEmails(d, env, {
			event,
			rows: [row],
			decision: "accept",
			idempotencyKey: "classic-render-key",
		});

		const [mail] = await d.select().from(emailOutbox);
		expect(mail?.subject).toBe("Priya: Classic Rendering at DemoConf");
		expect(mail?.html).toContain(
			"<p>Patel|Classic Rendering|Oct 13, 2026, 10:00 AM|Oct 13, 2026, 10:30 AM|Main Stage</p>",
		);
		expect(mail?.subject).not.toContain("{");
		expect(mail?.html).not.toContain("{");
	});

	it("a deduped retry back-fills a missing notifiedAt stamp (partial-failure recovery)", async () => {
		const d = await seedBase();
		await seedDecisionTemplates();
		const row = await insertSubmission({ status: "accept_queue" });
		await addSpeaker(row.id, "c_ines", "ines.moreau@example.com");
		const [event] = await d.select().from(events).where(eq(events.id, "e1"));
		if (!event) throw new Error("missing fixture");

		await sendDecisionEmails(d, env, {
			event,
			rows: [row],
			decision: "accept",
			idempotencyKey: "key-A",
		});
		// Simulate the crash window: the email exists but the stamp never ran.
		await d
			.update(submissions)
			.set({ notifiedAt: null })
			.where(eq(submissions.id, row.id));

		const retry = await sendDecisionEmails(d, env, {
			event,
			rows: [row],
			decision: "accept",
			idempotencyKey: "key-A",
		});
		expect(retry[0]?.deduped).toBe(true);
		expect(await d.select().from(emailOutbox)).toHaveLength(1);
		const [after] = await d
			.select()
			.from(submissions)
			.where(eq(submissions.id, row.id));
		expect(after?.notifiedAt).toBeInstanceOf(Date);
	});

	it("dedupes a double-submit but allows a deliberate re-send under a new key", async () => {
		const d = await seedBase();
		await seedDecisionTemplates();
		const row = await insertSubmission({ status: "accept_queue" });
		await addSpeaker(row.id, "c_ines", "ines.moreau@example.com");
		const [event] = await d.select().from(events).where(eq(events.id, "e1"));
		if (!event) throw new Error("missing fixture");

		await sendDecisionEmails(d, env, {
			event,
			rows: [row],
			decision: "accept",
			idempotencyKey: "key-A",
		});
		const replay = await sendDecisionEmails(d, env, {
			event,
			rows: [row],
			decision: "accept",
			idempotencyKey: "key-A",
		});
		expect(replay[0]?.deduped).toBe(true);
		expect(await d.select().from(emailOutbox)).toHaveLength(1);

		await sendDecisionEmails(d, env, {
			event,
			rows: [row],
			decision: "accept",
			idempotencyKey: "key-B",
		});
		expect(await d.select().from(emailOutbox)).toHaveLength(2);
	});

	it("a corrective decline after an accept on the SAME selection still delivers", async () => {
		const d = await seedBase();
		await seedDecisionTemplates();
		const row = await insertSubmission({ status: "accept_queue" });
		await addSpeaker(row.id, "c_omar", "omar.haddad@example.com");
		const [event] = await d.select().from(events).where(eq(events.id, "e1"));
		if (!event) throw new Error("missing fixture");

		await sendDecisionEmails(d, env, {
			event,
			rows: [row],
			decision: "accept",
			idempotencyKey: "key-A",
		});
		// The admin clicked accept by mistake and corrects with decline WITHOUT
		// touching the selection — the same form key must not swallow it.
		const corrective = await sendDecisionEmails(d, env, {
			event,
			rows: [row],
			decision: "decline",
			idempotencyKey: "key-A",
		});
		expect(corrective[0]?.deduped).toBe(false);
		const outbox = await d.select().from(emailOutbox);
		expect(outbox).toHaveLength(2);
		expect(new Set(outbox.map((o) => o.templateId))).toEqual(
			new Set(["et_accept", "et_decline"]),
		);
	});

	it("refuses more than 100 rows per send for every caller", async () => {
		const d = await seedBase();
		await seedDecisionTemplates();
		const [event] = await d.select().from(events).where(eq(events.id, "e1"));
		if (!event) throw new Error("missing fixture");
		const rows = await Promise.all(
			Array.from({ length: 101 }, () =>
				insertSubmission({ status: "accept_queue" }),
			),
		);
		await expect(
			sendDecisionEmails(d, env, {
				event,
				rows,
				decision: "accept",
				idempotencyKey: "key-1",
			}),
		).rejects.toThrow(/batches of up to 100/i);
		expect(await d.select().from(emailOutbox)).toHaveLength(0);
	});

	it("decline uses the decline template and attaches no calendar invite", async () => {
		const d = await seedBase();
		await seedDecisionTemplates();
		const row = await insertSubmission({ status: "decline_queue" });
		await addSpeaker(row.id, "c_tom", "tom.novak@example.com");
		const [event] = await d.select().from(events).where(eq(events.id, "e1"));
		if (!event) throw new Error("missing fixture");

		await sendDecisionEmails(d, env, {
			event,
			rows: [row],
			decision: "decline",
			idempotencyKey: "key-1",
		});
		const [mail] = await d.select().from(emailOutbox);
		expect(mail?.subject).toBe("Update on your submission");
		expect(mail?.icsAttachment).toBeNull();
	});

	it("delivers decisions even to unsubscribed recipients (decisions are transactional)", async () => {
		const d = await seedBase();
		await seedDecisionTemplates();
		await d
			.insert(emailSuppressions)
			.values({ email: "dana.kim@example.com", reason: "unsubscribed" });
		const row = await insertSubmission({ status: "accept_queue" });
		await addSpeaker(row.id, "c_dana", "dana.kim@example.com");
		const [event] = await d.select().from(events).where(eq(events.id, "e1"));
		if (!event) throw new Error("missing fixture");

		await sendDecisionEmails(d, env, {
			event,
			rows: [row],
			decision: "accept",
			idempotencyKey: "key-1",
		});
		expect(await d.select().from(emailOutbox)).toHaveLength(1);
	});

	it("falls back to the submitter account and reports rows with nobody to notify", async () => {
		const d = await seedBase();
		await seedDecisionTemplates();
		await d.insert(users).values({
			id: "u_sub",
			email: "submitter@example.com",
			passwordHash: "x",
			role: "speaker",
		});
		const speakerless = await insertSubmission({
			status: "accept_queue",
			submitterId: "u_sub",
		});
		const orphan = await insertSubmission({ status: "accept_queue" });
		const [event] = await d.select().from(events).where(eq(events.id, "e1"));
		if (!event) throw new Error("missing fixture");

		const results = await sendDecisionEmails(d, env, {
			event,
			rows: [speakerless, orphan],
			decision: "accept",
			idempotencyKey: "key-1",
		});
		expect(results.find((r) => r.submissionId === speakerless.id)?.to).toBe(
			"submitter@example.com",
		);
		const failed = results.find((r) => r.submissionId === orphan.id);
		expect(failed?.ok).toBe(false);
		expect(failed?.reason).toMatch(/no speaker or submitter/i);
		expect(await d.select().from(emailOutbox)).toHaveLength(1);
	});

	it("refuses loudly when the event has no matching template", async () => {
		const d = await seedBase();
		const row = await insertSubmission({ status: "accept_queue" });
		await addSpeaker(row.id, "c_x", "x@example.com");
		const [event] = await d.select().from(events).where(eq(events.id, "e1"));
		if (!event) throw new Error("missing fixture");

		await expect(
			sendDecisionEmails(d, env, {
				event,
				rows: [row],
				decision: "accept",
				idempotencyKey: "key-1",
			}),
		).rejects.toThrow(/template is missing/i);
		expect(await d.select().from(emailOutbox)).toHaveLength(0);
	});
});
