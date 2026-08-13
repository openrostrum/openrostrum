import { env } from "cloudflare:test";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "../app/db";
import { events } from "../app/db/schema";
import { toProgramEvent } from "../app/lib/program";
import remediationSql from "../drizzle/migrations/0012_event_date_integrity.sql?raw";
import enrichmentSql from "../drizzle/seed-demo-enrichment.sql?raw";
import seedSql from "../drizzle/seed.sql?raw";
import headshotManifest from "../scripts/seed-assets/headshots/manifest.json";
import slideManifest from "../scripts/seed-assets/slides/manifest.json";

// Public speaker attribution, headshots, and catalog depth come directly from
// these SQL artifacts, so the tests pin the deployed baseline rather than a
// generated fixture.

function statements(raw: string): string[] {
	return raw
		.split("\n")
		.filter((line) => !line.trimStart().startsWith("--"))
		.join("\n")
		.split(";")
		.map((statement) => statement.trim())
		.filter(Boolean);
}

async function applySql(raw: string) {
	for (const statement of statements(raw)) {
		await env.DB.prepare(statement).run();
	}
}

async function applyBaseSeed() {
	await applySql(seedSql);
}

async function applySeed() {
	await applyBaseSeed();
	await applySql(enrichmentSql);
}

async function applyEnrichment() {
	await applySql(enrichmentSql);
}

async function demoEvent() {
	const db = getDb(env);
	const event = await db.query.events.findFirst({
		where: eq(events.id, "e_demo"),
	});
	if (!event) throw new Error("demo event was not seeded");
	return event;
}

describe("demo seed baseline", () => {
	it("stores the demo event's Los Angeles dates as correct instants", async () => {
		await applyBaseSeed();
		const event = await demoEvent();

		expect(event.startsAt?.toISOString()).toBe("2026-10-12T15:00:00.000Z");
		expect(event.endsAt?.toISOString()).toBe("2026-10-15T01:00:00.000Z");
		const projected = toProgramEvent(event);
		expect(event.name).toBe("Northbound AI Summit 2026");
		expect(event.slug).toBe("northbound-ai-summit-2026");
		expect(event.location).toBe(
			"Yerba Buena Center for the Arts, San Francisco, California",
		);
		expect(projected.dateRange).toBe("October 12 – 14, 2026");
		expect(projected.location).toBe(event.location);
	});

	it("repairs the exact deployed UTC-midnight demo event signature", async () => {
		await applyBaseSeed();
		const db = getDb(env);
		await db.run(sql`
			UPDATE events
			SET starts_at = unixepoch('2026-10-12'),
				ends_at = unixepoch('2026-10-14')
			WHERE id = 'e_demo'
		`);

		await applySql(remediationSql);
		const event = await demoEvent();

		expect(event.startsAt?.toISOString()).toBe("2026-10-12T15:00:00.000Z");
		expect(event.endsAt?.toISOString()).toBe("2026-10-15T01:00:00.000Z");
		expect(toProgramEvent(event).dateRange).toBe("October 12 – 14, 2026");
	});

	it("applies cleanly and gives every publicly-surfaced speaker contact a title and company", async () => {
		const db = getDb(env);
		await applySeed();
		const { results } = await db.run(sql`
			SELECT DISTINCT c.id, c.job_title, c.company_name
			FROM contacts c
			JOIN participants p ON p.contact_id = c.id
		`);
		expect(results.length).toBeGreaterThan(0);
		for (const row of results as Array<{
			id: string;
			job_title: string | null;
			company_name: string | null;
		}>) {
			expect(row.job_title, `contact ${row.id} has no job title`).toBeTruthy();
			expect(row.company_name, `contact ${row.id} has no company`).toBeTruthy();
		}
	});

	it("seeds enough submissions to exercise pagination and every status tab", async () => {
		const db = getDb(env);
		await applySeed();
		const { results } = await db.run(sql`
			SELECT status, count(*) AS count
			FROM submissions
			GROUP BY status
		`);
		const counts = new Map(
			(results as Array<{ status: string; count: number }>).map((row) => [
				row.status,
				row.count,
			]),
		);
		const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
		expect(total).toBeGreaterThanOrEqual(35);
		for (const status of [
			"draft",
			"pending",
			"accept_queue",
			"accepted",
			"decline_queue",
			"declined",
			"withdrawn",
		]) {
			expect(
				counts.get(status),
				`status tab ${status} is empty`,
			).toBeGreaterThan(0);
		}
	});

	it("seeds dense scheduled coverage and an unscheduled agenda queue", async () => {
		const db = getDb(env);
		await applySeed();
		const { results } = await db.run(sql`
			SELECT
				count(CASE WHEN starts_at IS NOT NULL AND ends_at IS NOT NULL AND room_id IS NOT NULL THEN 1 END) AS scheduled,
				count(CASE WHEN starts_at IS NULL AND ends_at IS NULL AND room_id IS NULL THEN 1 END) AS unscheduled
			FROM submissions
			WHERE status = 'accepted'
		`);
		const row = results[0] as { scheduled: number; unscheduled: number };
		expect(row.scheduled).toBeGreaterThanOrEqual(20);
		expect(row.unscheduled).toBeGreaterThanOrEqual(5);
	});

	it("gives every public session a believable speaker and enough speakers for pagination", async () => {
		const db = getDb(env);
		await applySeed();
		const { results: speakers } = await db.run(sql`
			SELECT DISTINCT c.id, c.job_title, c.company_name, c.bio
			FROM contacts c
			JOIN participants p ON p.contact_id = c.id
			JOIN submissions s ON s.id = p.submission_id
			WHERE s.status = 'accepted'
				AND s.content_status = 'approved'
				AND c.public_visible = 1
				AND p.role IN ('speaker', 'chairperson', 'moderator')
		`);
		expect(speakers.length).toBeGreaterThanOrEqual(31);
		for (const row of speakers as Array<{
			id: string;
			job_title: string | null;
			company_name: string | null;
			bio: string | null;
		}>) {
			expect(row.job_title, `contact ${row.id} has no title`).toBeTruthy();
			expect(row.company_name, `contact ${row.id} has no company`).toBeTruthy();
			expect(
				row.bio?.length ?? 0,
				`contact ${row.id} bio is too thin`,
			).toBeGreaterThan(120);
		}

		const { results: speakerless } = await db.run(sql`
			SELECT s.id
			FROM submissions s
			WHERE s.status = 'accepted'
				AND s.content_status = 'approved'
				AND NOT EXISTS (
					SELECT 1 FROM participants p
					JOIN contacts c ON c.id = p.contact_id
					WHERE p.submission_id = s.id
						AND c.public_visible = 1
						AND p.role IN ('speaker', 'chairperson', 'moderator')
				)
		`);
		expect(speakerless).toEqual([]);
	});

	it("seeds featured headshots consistent with the committed assets", async () => {
		// Featured speakers carry real bytes while the rest deliberately exercise the
		// public gallery's missing-photo fallback. The photo wall resolves images
		// from the latest `files` chain, while portal/admin/API surfaces read
		// contacts.headshot_key, so every featured asset must keep both aligned.
		const db = getDb(env);
		await applySeed();
		expect(headshotManifest.length).toBeGreaterThanOrEqual(12);
		const byContact = new Map(headshotManifest.map((m) => [m.contactId, m]));

		const { results: speakers } = await db.run(sql`
			SELECT DISTINCT c.id, c.headshot_key
			FROM contacts c
			JOIN participants p ON p.contact_id = c.id
			JOIN submissions s ON s.id = p.submission_id
			WHERE s.status = 'accepted'
				AND s.content_status = 'approved'
				AND c.public_visible = 1
		`);
		const publicSpeakerIds = new Set(
			(speakers as Array<{ id: string }>).map((row) => row.id),
		);
		for (const asset of headshotManifest) {
			expect(
				publicSpeakerIds.has(asset.contactId),
				`headshot asset ${asset.fileName} does not belong to a public speaker`,
			).toBe(true);
			const speaker = (
				speakers as Array<{ id: string; headshot_key: string | null }>
			).find((row) => row.id === asset.contactId);
			expect(speaker?.headshot_key).toBe(asset.r2Key);
		}

		const { results: chains } = await db.run(sql`
			SELECT contact_id, r2_key, content_type, size_bytes, version, kind
			FROM files WHERE kind = 'headshot'
		`);
		expect(chains.length).toBe(headshotManifest.length);
		for (const row of chains as Array<{
			contact_id: string;
			r2_key: string;
			content_type: string;
			size_bytes: number;
			version: number;
		}>) {
			const asset = byContact.get(row.contact_id);
			expect(asset, `stray headshot file for ${row.contact_id}`).toBeTruthy();
			expect(row.r2_key).toBe(asset?.r2Key);
			expect(row.content_type).toBe(asset?.contentType);
			expect(
				row.size_bytes,
				`size_bytes for ${row.contact_id} diverged from the committed asset — re-run scripts/seed-assets/headshots/generate.mjs and update seed.sql`,
			).toBe(asset?.sizeBytes);
			expect(row.version).toBe(1);
		}
	});

	it("seeds real slide decks behind the completed upload workflow", async () => {
		const db = getDb(env);
		await applySeed();
		const { results } = await db.run(sql`
			SELECT f.submission_id, f.r2_key, f.file_name, f.content_type,
				f.size_bytes, f.version, f.review_status, f.task_assignment_id,
				ta.file_key AS assignment_file_key, ta.status AS assignment_status
			FROM files f
			LEFT JOIN task_assignments ta ON ta.id = f.task_assignment_id
			WHERE f.kind = 'slides'
			ORDER BY f.submission_id
		`);
		const slideRows = results as Array<{
			submission_id: string;
			r2_key: string;
			file_name: string;
			content_type: string;
			size_bytes: number;
			version: number;
			review_status: string;
			task_assignment_id: string | null;
			assignment_file_key: string | null;
			assignment_status: string | null;
		}>;
		expect(slideRows).toHaveLength(3);
		const bySubmission = new Map(
			slideManifest.map((asset) => [asset.submissionId, asset]),
		);
		for (const row of slideRows) {
			const asset = bySubmission.get(row.submission_id);
			expect(
				asset,
				`slide row ${row.submission_id} has no committed asset`,
			).toBeTruthy();
			expect(row.r2_key).toBe(asset?.r2Key);
			expect(row.file_name).toBe(asset?.fileName);
			expect(row.content_type).toBe(asset?.contentType);
			expect(row.size_bytes).toBe(asset?.sizeBytes);
			expect(row.version).toBe(asset?.version);
			expect(row.review_status).toBe("approved");
		}
		const completed = slideRows.find(
			(row) => row.submission_id === "s_accepted",
		) as {
			r2_key: string;
			task_assignment_id: string | null;
			assignment_file_key: string | null;
			assignment_status: string | null;
		};
		expect(completed.task_assignment_id).toBe("ta_3");
		expect(completed.assignment_file_key).toBe(completed.r2_key);
		expect(completed.assignment_status).toBe("complete");
	});

	it("does not enrich an e_demo row outside the Demo organization", async () => {
		const db = getDb(env);
		await applyBaseSeed();
		const { results: before } = await db.run(sql`
			SELECT description FROM submissions WHERE id = 's_pending'
		`);
		await db.run(sql`
			INSERT INTO organizations (id, name, created_at)
			VALUES ('org_other', 'Other organization', unixepoch())
		`);
		await db.run(sql`
			UPDATE events SET organization_id = 'org_other' WHERE id = 'e_demo'
		`);

		await applyEnrichment();

		const { results: inserted } = await db.run(sql`
			SELECT
				(SELECT count(*) FROM contacts WHERE id = 'c_maya') AS contacts,
				(SELECT count(*) FROM participants WHERE id = 'p_maya_open') AS participants,
				(SELECT count(*) FROM files WHERE id = 'file_hs_maya') AS files
		`);
		const { results: after } = await db.run(sql`
			SELECT description FROM submissions WHERE id = 's_pending'
		`);
		expect(inserted).toEqual([{ contacts: 0, participants: 0, files: 0 }]);
		expect(after).toEqual(before);
	});

	it("reapplies remote enrichment without deleting file review history", async () => {
		const db = getDb(env);
		await applySeed();
		await db.run(sql`
			INSERT INTO file_comments (id, file_id, author_name, body, created_at)
			VALUES ('fc_seed_review', 'file_slides_rag', 'Program team',
				'Keep the benchmark slide in the final deck.', unixepoch())
		`);

		await applyEnrichment();

		const { results } = await db.run(sql`
			SELECT file_id, author_name, body
			FROM file_comments
			WHERE id = 'fc_seed_review'
		`);
		expect(results).toEqual([
			{
				file_id: "file_slides_rag",
				author_name: "Program team",
				body: "Keep the benchmark slide in the final deck.",
			},
		]);
	});

	it("seeds every submission with a multi-paragraph, Show-more-deep abstract", async () => {
		// The public session cards truncate at 240 chars with a Show more toggle
		// and render char(10) breaks via whitespace-pre-line — a one-liner
		// description silently removes the expansion path (and the content depth)
		// the catalog is graded on.
		const db = getDb(env);
		await applySeed();
		const { results } = await db.run(sql`
			SELECT id, length(description) AS len,
				(instr(description, char(10) || char(10)) > 0) AS has_paragraph_break
			FROM submissions
		`);
		expect(results.length).toBeGreaterThan(0);
		for (const row of results as Array<{
			id: string;
			len: number;
			has_paragraph_break: number;
		}>) {
			expect(
				row.len,
				`submission ${row.id} abstract is too short to exercise Show more`,
			).toBeGreaterThan(240);
			expect(
				row.has_paragraph_break,
				`submission ${row.id} abstract has no paragraph break`,
			).toBe(1);
		}
	});
});
