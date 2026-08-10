import {
	createExecutionContext,
	env,
	waitOnExecutionContext,
} from "cloudflare:test";
import { apiV1 } from "../app/api/v1/app";
import { getDb } from "../app/db";
import {
	apiTokens,
	contacts,
	events,
	fields,
	files,
	formats,
	languages,
	levels,
	organizations,
	participants,
	rooms,
	sessionStatuses,
	submissionAnswers,
	submissions,
	submissionTags,
	submissionTracks,
	tags,
	tracks,
} from "../app/db/schema";
import { sha256Hex } from "../app/lib/api-token";

/**
 * Two-org world for the compat-API suite. Org A holds two events (e_a1 fully
 * populated, e_a2 bare); org B holds e_b1 — the cross-tenant probe target.
 * Raw token values are the test's credentials; only hashes are stored.
 */
export const RAW_TOKENS = {
	orgA: "test-token-org-a",
	restrictedToA2: "test-token-org-a-events-a2",
	orgB: "test-token-org-b",
} as const;

/** Raw values that must never appear in any API response body. */
export const PII = {
	email: "jane.smith@university.edu",
	mobile: "+1 (555) 123-4567",
	home: "555 987 6543",
	logistics: "Arrives Oct 11, aisle seat",
	secondaryEmail: "assistant.person@example.com",
	withdrawnReason: "Family emergency",
} as const;

export async function seedApiFixtures(): Promise<void> {
	const db = getDb(env);
	await db.insert(organizations).values([
		{ id: "org_a", name: "Org A" },
		{ id: "org_b", name: "Org B" },
	]);
	await db.insert(events).values([
		{
			id: "e_a1",
			organizationId: "org_a",
			name: "Conf A1",
			slug: "conf-a1",
			timezone: "America/Los_Angeles",
		},
		{ id: "e_a2", organizationId: "org_a", name: "Conf A2", slug: "conf-a2" },
		{ id: "e_b1", organizationId: "org_b", name: "Conf B1", slug: "conf-b1" },
	]);
	await db.insert(apiTokens).values([
		{
			id: "tok_a",
			organizationId: "org_a",
			name: "org A, all events",
			tokenHash: await sha256Hex(RAW_TOKENS.orgA),
		},
		{
			id: "tok_a_e2",
			organizationId: "org_a",
			eventId: "e_a2",
			name: "org A, restricted to e_a2",
			tokenHash: await sha256Hex(RAW_TOKENS.restrictedToA2),
		},
		{
			id: "tok_b",
			organizationId: "org_b",
			name: "org B",
			tokenHash: await sha256Hex(RAW_TOKENS.orgB),
		},
	]);

	await db.insert(tracks).values({
		id: "tr_1",
		eventId: "e_a1",
		name: "AI Infrastructure",
		color: "#0ea5e9",
	});
	await db
		.insert(tags)
		.values({ id: "tag_1", eventId: "e_a1", name: "Agents", color: "#f59e0b" });
	await db.insert(formats).values({
		id: "fmt_ws",
		eventId: "e_a1",
		name: "Workshop",
		defaultDurationMins: 90,
		position: 1,
	});
	await db
		.insert(levels)
		.values({ id: "lvl_adv", eventId: "e_a1", name: "Advanced", position: 2 });
	await db.insert(rooms).values({
		id: "room_1",
		eventId: "e_a1",
		name: "Room A",
		capacity: 120,
		displayOrder: 1,
	});
	await db
		.insert(languages)
		.values({ id: "lang_en", eventId: "e_a1", name: "English", position: 0 });
	await db.insert(sessionStatuses).values({
		id: "cs_offered",
		eventId: "e_a1",
		name: "Offered",
		color: "#123456",
		position: 1,
	});
	await db.insert(fields).values({
		id: "fld_notes",
		eventId: "e_a1",
		name: "Anything else?",
		type: "textarea",
	});

	await db.insert(contacts).values([
		{
			id: "c_speaker",
			eventId: "e_a1",
			email: PII.email,
			firstName: "Jane",
			lastName: "Smith",
			mobilePhone: PII.mobile,
			homePhone: PII.home,
			bio: "Distributed systems researcher.",
			jobTitle: "Professor",
			companyName: "State University",
			logisticsNotes: PII.logistics,
			headshotKey: "headshots/jane.png",
		},
		{
			id: "c_hidden",
			eventId: "e_a1",
			email: "hidden.chair@example.com",
			firstName: "Hidden",
			lastName: "Chair",
			publicVisible: false,
		},
		{
			id: "c_queued",
			eventId: "e_a1",
			email: "queued.speaker@example.com",
			firstName: "Queued",
			lastName: "Speaker",
		},
		{
			id: "c_roster",
			eventId: "e_a1",
			email: "roster.only@example.com",
			firstName: "Roster",
			lastName: "Only",
		},
		{
			id: "c_secondary",
			eventId: "e_a1",
			email: PII.secondaryEmail,
			firstName: "Assistant",
			lastName: "Person",
		},
		{
			id: "c_b",
			eventId: "e_b1",
			email: "org.b@example.com",
			firstName: "Org",
			lastName: "B",
		},
	]);

	await db.insert(submissions).values([
		{
			id: "sub_accepted",
			eventId: "e_a1",
			type: "session",
			title: "Accepted talk",
			description: "<p>All about it</p>",
			status: "accepted",
			contentStatus: "approved",
			formatId: "fmt_ws",
			levelId: "lvl_adv",
			roomId: "room_1",
			language: "English",
			customStatusId: "cs_offered",
			capacity: 100,
			ceuCredits: 1.5,
			clientSessionId: "CS-1",
			startsAt: new Date("2026-10-12T17:00:00Z"),
			endsAt: new Date("2026-10-12T18:30:00Z"),
		},
		{
			id: "sub_queue",
			eventId: "e_a1",
			type: "session",
			title: "Queued talk",
			status: "accept_queue",
		},
		{
			id: "sub_declineq",
			eventId: "e_a1",
			type: "session",
			title: "Staged for decline",
			status: "decline_queue",
		},
		{
			id: "sub_abstract",
			eventId: "e_a1",
			type: "abstract",
			title: "Pending abstract",
			status: "pending",
		},
		{
			id: "sub_draft",
			eventId: "e_a1",
			type: "session",
			title: "Secret draft",
			status: "draft",
		},
		{
			id: "sub_withdrawn",
			eventId: "e_a1",
			type: "session",
			title: "Withdrawn talk",
			status: "withdrawn",
			withdrawnAt: new Date("2026-08-01T00:00:00Z"),
			withdrawnReason: PII.withdrawnReason,
		},
		{
			id: "sub_child",
			eventId: "e_a1",
			type: "session",
			title: "Child slot",
			status: "accepted",
			parentId: "sub_accepted",
		},
		{
			id: "sub_b",
			eventId: "e_b1",
			type: "session",
			title: "Org B talk",
			status: "accepted",
		},
	]);

	await db
		.insert(submissionTracks)
		.values({ submissionId: "sub_accepted", trackId: "tr_1" });
	await db
		.insert(submissionTags)
		.values({ submissionId: "sub_accepted", tagId: "tag_1" });
	await db.insert(submissionAnswers).values({
		id: "ans_1",
		submissionId: "sub_accepted",
		fieldId: "fld_notes",
		value: "Need a projector",
	});
	await db.insert(files).values({
		id: "f_slides",
		eventId: "e_a1",
		submissionId: "sub_accepted",
		contactId: "c_speaker",
		r2Key: "files/slides.pdf",
		fileName: "slides.pdf",
		kind: "slides",
		contentType: "application/pdf",
		sizeBytes: 12,
	});
	await db.insert(participants).values([
		{
			id: "p_speaker",
			submissionId: "sub_accepted",
			contactId: "c_speaker",
			role: "speaker",
			isPrimary: true,
			position: 0,
		},
		{
			id: "p_hidden",
			submissionId: "sub_accepted",
			contactId: "c_hidden",
			role: "chairperson",
			position: 1,
		},
		{
			id: "p_secondary",
			submissionId: "sub_accepted",
			contactId: "c_secondary",
			role: "secondary",
			position: 2,
		},
		{
			id: "p_queued",
			submissionId: "sub_queue",
			contactId: "c_queued",
			role: "speaker",
			position: 0,
		},
		{
			id: "p_draft_only",
			submissionId: "sub_draft",
			contactId: "c_roster",
			role: "speaker",
			position: 0,
		},
		{
			id: "p_child",
			submissionId: "sub_child",
			contactId: "c_speaker",
			role: "speaker",
			position: 0,
		},
	]);
}

/** Issue one request against the Hono app, settling background work (lastUsedAt stamp). */
export async function api(
	path: string,
	init: { method?: string; token?: string; body?: unknown } = {},
): Promise<Response> {
	const ctx = createExecutionContext();
	const headers = new Headers();
	if (init.token) headers.set("x-access-token", init.token);
	if (init.body !== undefined) headers.set("content-type", "application/json");
	const response = await apiV1.fetch(
		new Request(`https://api.example.com${path}`, {
			method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
			headers,
			body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
		}),
		env,
		ctx,
	);
	await waitOnExecutionContext(ctx);
	return response;
}

export async function apiJson<T = Record<string, unknown>>(
	path: string,
	init: { method?: string; token?: string; body?: unknown } = {},
): Promise<{ status: number; json: T; text: string }> {
	const response = await api(path, init);
	const text = await response.text();
	return { status: response.status, json: JSON.parse(text) as T, text };
}
