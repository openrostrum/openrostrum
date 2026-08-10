import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { api, apiJson, RAW_TOKENS, seedApiFixtures } from "./api-v1-fixtures";

// Session file attachments (`content`, the Session Files list, byte
// downloads) and contact headshots (`photo_url`): the exposure matrix marks
// both API-readable, and every URL the API emits must resolve inside the
// token guard — cross-org fetches 404, PII stays masked on file rows.

beforeEach(async () => {
	await seedApiFixtures();
	await env.BLOBS.put("files/slides.pdf", "PDF-BYTES-12");
	await env.BLOBS.put("headshots/jane.png", "PNG-BYTES", {
		httpMetadata: { contentType: "image/png" },
	});
});

describe("session content", () => {
	it("session payloads carry attachments in the Content shape with a resolvable url", async () => {
		const { json } = await apiJson<{
			content: Record<string, unknown>[];
		}>("/api/v1/event/e_a1/sessions/sub_accepted", { token: RAW_TOKENS.orgA });
		expect(json.content).toHaveLength(1);
		expect(json.content[0]).toMatchObject({
			id: "f_slides",
			filename: "slides.pdf",
			mimetype: "application/pdf",
			size: 12,
			url: "https://api.example.com/api/v1/event/e_a1/sessions/sub_accepted/files/f_slides/download",
			assigned_participant_id: "c_speaker",
			assigned_participant_email: "j***@u***.edu",
			assigned_participant_name: "Jane Smith",
		});
	});

	it("GET /sessions/:id/files returns the spec's {data: Content[]} envelope", async () => {
		const { json } = await apiJson<{ data: { id: string }[] }>(
			"/api/v1/event/e_a1/sessions/sub_accepted/files",
			{ token: RAW_TOKENS.orgA },
		);
		expect(json.data.map((f) => f.id)).toEqual(["f_slides"]);
	});

	it("a session without attachments serves an empty content array", async () => {
		const { json } = await apiJson<{ content: unknown[] }>(
			"/api/v1/event/e_a1/sessions/sub_queue",
			{ token: RAW_TOKENS.orgA },
		);
		expect(json.content).toEqual([]);
	});

	it("streams the file bytes with its stored content type", async () => {
		const response = await api(
			"/api/v1/event/e_a1/sessions/sub_accepted/files/f_slides/download",
			{ token: RAW_TOKENS.orgA },
		);
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe("application/pdf");
		expect(await response.text()).toBe("PDF-BYTES-12");
	});

	it("another org's token cannot download the file (existence-hiding 404)", async () => {
		const response = await api(
			"/api/v1/event/e_a1/sessions/sub_accepted/files/f_slides/download",
			{ token: RAW_TOKENS.orgB },
		);
		expect(response.status).toBe(404);
	});
});

describe("contact headshots", () => {
	it("photo_url points at the token-authed photo endpoint when a headshot exists", async () => {
		const { json } = await apiJson<{ photo_url: string | null }>(
			"/api/v1/event/e_a1/contacts/c_speaker",
			{ token: RAW_TOKENS.orgA },
		);
		expect(json.photo_url).toBe(
			"https://api.example.com/api/v1/event/e_a1/contacts/c_speaker/photo",
		);
	});

	it("photo_url is null when no headshot exists", async () => {
		const { json } = await apiJson<{ photo_url: string | null }>(
			"/api/v1/event/e_a1/contacts/c_roster",
			{ token: RAW_TOKENS.orgA },
		);
		expect(json.photo_url).toBeNull();
	});

	it("streams the headshot bytes; 404 for contacts without one", async () => {
		const photo = await api("/api/v1/event/e_a1/contacts/c_speaker/photo", {
			token: RAW_TOKENS.orgA,
		});
		expect(photo.status).toBe(200);
		expect(photo.headers.get("content-type")).toBe("image/png");
		expect(await photo.text()).toBe("PNG-BYTES");

		const missing = await api("/api/v1/event/e_a1/contacts/c_roster/photo", {
			token: RAW_TOKENS.orgA,
		});
		expect(missing.status).toBe(404);
	});

	it("another org's token cannot fetch the headshot", async () => {
		const response = await api("/api/v1/event/e_a1/contacts/c_speaker/photo", {
			token: RAW_TOKENS.orgB,
		});
		expect(response.status).toBe(404);
	});
});
