import { env } from "cloudflare:test";
import { getDb } from "../app/db";
import {
	contacts,
	embeds,
	events,
	formats,
	organizations,
	participants,
	rooms,
	submissions,
	submissionTracks,
	tracks,
} from "../app/db/schema";

export const CONTEXT = { cloudflare: { env, ctx: {} } };

/**
 * Public-projection oracle fixture. Exercises every deny rule the surfaces must
 * enforce: a non-approved accepted session, an approved pending submission, a
 * hidden speaker, and contact PII (email/phone) that must never serialize.
 */
export async function seedProgram(options?: { agendaPublished?: boolean }) {
	const db = getDb(env);
	await db.insert(organizations).values({ id: "org1", name: "Org" });
	// Times are stored UTC while the event runs America/Los_Angeles (PDT, UTC-7
	// in May), so s1 at 16:30Z must render as 9:30 AM.
	await db.insert(events).values({
		id: "e1",
		organizationId: "org1",
		name: "DevFlow Conf 2027",
		slug: "devflow",
		timezone: "America/Los_Angeles",
		startsAt: new Date("2027-05-12T16:00:00Z"),
		endsAt: new Date("2027-05-14T23:00:00Z"),
		agendaPublishedAt:
			options?.agendaPublished === false
				? null
				: new Date("2027-01-01T00:00:00Z"),
	});
	await db.insert(tracks).values([
		{ id: "t1", eventId: "e1", name: "Platform & Infra", color: "#112233" },
		{ id: "t2", eventId: "e1", name: "AI Engineering", color: "#445566" },
	]);
	await db.insert(formats).values([
		{ id: "f1", eventId: "e1", name: "Talk", defaultDurationMins: 30 },
		{ id: "f2", eventId: "e1", name: "Workshop", defaultDurationMins: 90 },
	]);
	await db.insert(rooms).values([
		{ id: "r1", eventId: "e1", name: "Main Hall" },
		{ id: "r2", eventId: "e1", name: "Room 2" },
	]);
	await db.insert(contacts).values([
		{
			id: "c_ada",
			eventId: "e1",
			email: "ada@px.test",
			firstName: "Ada",
			lastName: "Zhang",
			jobTitle: "CTO",
			companyName: "DevFlow",
			bio: "Ships CI pipelines.",
			mobilePhone: "555-0001",
		},
		{
			id: "c_bo",
			eventId: "e1",
			email: "bo@px.test",
			firstName: "Bo",
			lastName: "Alvarez",
			jobTitle: "Engineer",
			companyName: "Widgets & <Co>",
		},
		{
			id: "c_hidden",
			eventId: "e1",
			email: "hidden@px.test",
			firstName: "Hidden",
			lastName: "Person",
			publicVisible: false,
		},
	]);
	await db.insert(submissions).values([
		{
			id: "s1",
			eventId: "e1",
			title: "Taming 40-Minute CI & <Scale>",
			description: "<p>Cut the queue.</p>",
			status: "accepted",
			contentStatus: "approved",
			formatId: "f1",
			roomId: "r1",
			startsAt: new Date("2027-05-12T16:30:00Z"),
			endsAt: new Date("2027-05-12T17:00:00Z"),
		},
		{
			id: "s2",
			eventId: "e1",
			title: "Your AI Pair Programmer Is Lying to You",
			description: "Trust, but verify.",
			status: "accepted",
			contentStatus: "approved",
			formatId: "f2",
			roomId: "r2",
			startsAt: new Date("2027-05-13T18:00:00Z"),
			endsAt: new Date("2027-05-13T19:30:00Z"),
		},
		{
			id: "s3",
			eventId: "e1",
			title: "Accepted But Content Unapproved",
			status: "accepted",
			contentStatus: "in_review",
			roomId: "r1",
			startsAt: new Date("2027-05-12T18:00:00Z"),
			endsAt: new Date("2027-05-12T18:30:00Z"),
		},
		{
			id: "s4",
			eventId: "e1",
			title: "Pending Yet Approved",
			status: "pending",
			contentStatus: "approved",
		},
		{
			id: "s5",
			eventId: "e1",
			title: "Approved And Waiting For A Slot",
			// User-typed "&lt;b&gt;" must survive as literal text, not become markup.
			description: "<p>Escaped &amp;lt;b&amp;gt; stays text &amp; sound</p>",
			status: "accepted",
			contentStatus: "approved",
		},
	]);
	await db.insert(submissionTracks).values([
		{ submissionId: "s1", trackId: "t1" },
		{ submissionId: "s2", trackId: "t2" },
	]);
	await db.insert(participants).values([
		{ id: "p1", submissionId: "s1", contactId: "c_ada", isPrimary: true },
		{ id: "p2", submissionId: "s1", contactId: "c_hidden" },
		{ id: "p3", submissionId: "s2", contactId: "c_bo", isPrimary: true },
		{ id: "p4", submissionId: "s5", contactId: "c_ada" },
	]);
	await db.insert(embeds).values([
		{
			id: "emb1",
			eventId: "e1",
			publicId: "pub-emb-1",
			name: "Filtered sessions",
			type: "sessions",
			enabled: true,
			config: { trackIds: ["t1"] },
		},
		{
			id: "emb2",
			eventId: "e1",
			publicId: "pub-emb-2",
			name: "Disabled embed",
			type: "sessions",
			enabled: false,
			config: {},
		},
	]);
}

/** Unwraps the {data, init} shape `data()` returns from a loader. */
export function unwrap<T>(result: unknown): { data: T; status: number } {
	const r = result as { data: T; init?: { status?: number } | null };
	return { data: r.data, status: r.init?.status ?? 200 };
}

export { thrownStatus } from "./thrown";
