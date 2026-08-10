import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { files } from "../app/db/schema";
import { crc32, zipStream } from "../app/lib/zip";
import { loader as exportLoader } from "../app/routes/admin.files.export[.zip]";
import { CONTEXT, authedRequest } from "./tasks-fixtures";
import {
	catchThrown,
	parseZip,
	seedFilesWorld,
	thrownStatus,
} from "./files.helpers";

type ExportArgs = Parameters<typeof exportLoader>[0];

const encoder = new TextEncoder();

describe("zip writer", () => {
	it("computes the CRC-32 check value from the spec", () => {
		// "123456789" -> 0xCBF43926 is THE standard CRC-32 verification value.
		expect(crc32(encoder.encode("123456789"))).toBe(0xcbf43926);
		expect(crc32(encoder.encode(""))).toBe(0);
	});

	it("round-trips entries through an independent APPNOTE-layout reader", async () => {
		const stream = zipStream([
			{ path: "Talk A/slides.pdf", body: encoder.encode("deck bytes") },
			{ path: "Talk B/notes.txt", body: encoder.encode("some notes") },
		]);
		const buf = new Uint8Array(await new Response(stream).arrayBuffer());
		const entries = parseZip(buf);
		expect(entries.map((e) => e.path)).toEqual([
			"Talk A/slides.pdf",
			"Talk B/notes.txt",
		]);
		expect(new TextDecoder().decode(entries[0]?.data)).toBe("deck bytes");
		expect(new TextDecoder().decode(entries[1]?.data)).toBe("some notes");
		expect(entries[0]?.crc).toBe(crc32(encoder.encode("deck bytes")));
	});
});

/**
 * Two chains on session s1 (slides at v1+v2, handout at v1), one chain on s2,
 * one contact-only file, one foreign-event file. The export contract: LATEST
 * versions only, one folder per session, foreign rows never included.
 */
async function seedExportWorld() {
	const db = await seedFilesWorld();
	const put = (key: string, content: string) => env.BLOBS.put(key, content);
	await Promise.all([
		put("z/slides1", "slides v1"),
		put("z/slides2", "slides v2 FINAL"),
		put("z/handout", "handout v1"),
		put("z/talkb", "talk b deck"),
		put("z/headshot", "png bytes"),
		put("z/foreign", "foreign bytes"),
	]);
	await db.insert(files).values([
		{
			id: "f_slides_v1",
			eventId: "e1",
			submissionId: "s1",
			contactId: "c_priya",
			taskAssignmentId: "ta_priya_slides",
			r2Key: "z/slides1",
			fileName: "slides.pdf",
			kind: "slides",
			sizeBytes: 9,
			version: 1,
		},
		{
			id: "f_slides_v2",
			eventId: "e1",
			submissionId: "s1",
			contactId: "c_priya",
			taskAssignmentId: "ta_priya_slides",
			r2Key: "z/slides2",
			fileName: "slides.pdf",
			kind: "slides",
			sizeBytes: 15,
			version: 2,
		},
		{
			id: "f_handout",
			eventId: "e1",
			submissionId: "s1",
			r2Key: "z/handout",
			fileName: "handout.pdf",
			kind: "handout",
			sizeBytes: 10,
			version: 1,
		},
		{
			id: "f_talkb",
			eventId: "e1",
			submissionId: "s2",
			r2Key: "z/talkb",
			fileName: "deck.pdf",
			kind: "slides",
			sizeBytes: 11,
			version: 1,
		},
		{
			id: "f_headshot",
			eventId: "e1",
			contactId: "c_priya",
			r2Key: "z/headshot",
			fileName: "headshot.png",
			kind: "headshot",
			sizeBytes: 9,
			version: 1,
		},
		{
			id: "f_foreign",
			eventId: "e2",
			submissionId: "s_e2",
			r2Key: "z/foreign",
			fileName: "foreign.pdf",
			kind: "doc",
			sizeBytes: 13,
			version: 1,
		},
	]);
	return db;
}

async function exportZip(query: string) {
	const request = await authedRequest(
		`http://localhost/admin/files/export.zip${query}`,
	);
	const response = (await exportLoader({
		context: CONTEXT,
		request,
		params: {},
	} as unknown as ExportArgs)) as Response;
	expect(response.headers.get("Content-Type")).toBe("application/zip");
	return parseZip(new Uint8Array(await response.arrayBuffer()));
}

describe("bulk ZIP export", () => {
	it("exports LATEST versions only, one folder per session, speaker folder for contact-only files — and never a foreign event's rows", async () => {
		await seedExportWorld();
		const entries = await exportZip("?all=1");
		const byPath = new Map(
			entries.map((e) => [e.path, new TextDecoder().decode(e.data)]),
		);
		expect([...byPath.keys()].sort()).toEqual([
			"Priya Sharma/headshot.png",
			"Talk A/handout.pdf",
			"Talk A/slides.pdf",
			"Talk B/deck.pdf",
		]);
		// v2 is what ships; v1 stays only on the detail page
		expect(byPath.get("Talk A/slides.pdf")).toBe("slides v2 FINAL");
	});

	it("a selection naming an OLD version still exports that chain's latest — and nothing unselected", async () => {
		await seedExportWorld();
		const entries = await exportZip("?fileIds=f_slides_v1");
		expect(entries.map((e) => e.path)).toEqual(["Talk A/slides.pdf"]);
		expect(new TextDecoder().decode(entries[0]?.data)).toBe("slides v2 FINAL");
	});

	it("deselecting a file keeps it out of the archive", async () => {
		await seedExportWorld();
		const entries = await exportZip("?fileIds=f_handout&fileIds=f_talkb");
		expect(entries.map((e) => e.path).sort()).toEqual([
			"Talk A/handout.pdf",
			"Talk B/deck.pdf",
		]);
	});

	it("400s an empty selection and 404s ids from another event", async () => {
		await seedExportWorld();
		const empty = await catchThrown(() => exportZip(""));
		expect(thrownStatus(empty)).toBe(400);
		const foreign = await catchThrown(() => exportZip("?fileIds=f_foreign"));
		expect(thrownStatus(foreign)).toBe(404);
	});

	it("refuses a selection whose metadata exceeds the 1 GB archive limit", async () => {
		const db = await seedFilesWorld();
		// size check reads size_bytes metadata, never the blobs
		await db.insert(files).values([
			{
				id: "f_big1",
				eventId: "e1",
				submissionId: "s1",
				r2Key: "z/big1",
				fileName: "raw-video-1.zip",
				kind: "other",
				sizeBytes: 600 * 1024 * 1024,
				version: 1,
			},
			{
				id: "f_big2",
				eventId: "e1",
				submissionId: "s2",
				r2Key: "z/big2",
				fileName: "raw-video-2.zip",
				kind: "other",
				sizeBytes: 600 * 1024 * 1024,
				version: 1,
			},
		]);
		const thrown = await catchThrown(() => exportZip("?all=1"));
		expect(thrownStatus(thrown)).toBe(400);
	});

	it("handles a selection larger than D1's bound-variable cap", async () => {
		const db = await seedFilesWorld();
		const ids: string[] = [];
		for (let i = 0; i < 120; i += 1) {
			const id = `f_many_${i}`;
			ids.push(id);
			await env.BLOBS.put(`z/many_${i}`, "x");
			await db.insert(files).values({
				id,
				eventId: "e1",
				submissionId: "s1",
				r2Key: `z/many_${i}`,
				fileName: `asset-${i}.png`,
				kind: "other",
				sizeBytes: 1,
				version: 1,
			});
		}
		const query = `?${ids.map((id) => `fileIds=${id}`).join("&")}`;
		const entries = await exportZip(query);
		expect(entries).toHaveLength(120);
	});
});
