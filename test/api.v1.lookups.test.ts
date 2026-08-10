import { beforeEach, describe, expect, it } from "vitest";
import { apiJson, RAW_TOKENS, seedApiFixtures } from "./api-v1-fixtures";

// Event Settings lookups: the spec's dual shape — GET returns the bare array,
// POST (search) returns the paginated results envelope — and the status
// catalog that mixes the core pipeline with organizer-created customs.

beforeEach(seedApiFixtures);

describe("lookup endpoints", () => {
	it("GET returns a bare JSON array (no envelope), event-scoped", async () => {
		const { json } = await apiJson<Record<string, unknown>[]>(
			"/api/v1/event/e_a1/tracks",
			{ token: RAW_TOKENS.orgA },
		);
		expect(Array.isArray(json)).toBe(true);
		expect(json).toHaveLength(1);
		expect(json[0]).toMatchObject({
			id: "tr_1",
			name: "AI Infrastructure",
			color: "#0ea5e9",
		});
		// Standalone lookups omit event_id — the event is implicit from the URL.
		expect(json[0]).not.toHaveProperty("event_id");
	});

	it("POST returns the paginated search envelope over the same rows", async () => {
		const { json } = await apiJson<{
			results: { id: string }[];
			pagination: { totalResults: number };
		}>("/api/v1/event/e_a1/tracks", { token: RAW_TOKENS.orgA, body: {} });
		expect(json.results.map((r) => r.id)).toEqual(["tr_1"]);
		expect(json.pagination.totalResults).toBe(1);
	});

	it("POST honors the search body: createdAt filter and body pageSize", async () => {
		const filteredOut = await apiJson<{
			results: unknown[];
			pagination: { totalResults: number };
		}>("/api/v1/event/e_a1/tracks", {
			token: RAW_TOKENS.orgA,
			body: { filters: { createdAt: { before: "2000-01-01T00:00:00Z" } } },
		});
		expect(filteredOut.json.results).toEqual([]);
		expect(filteredOut.json.pagination.totalResults).toBe(0);

		const bodyPaged = await apiJson<{ pagination: { pageSize: number } }>(
			"/api/v1/event/e_a1/tracks",
			{ token: RAW_TOKENS.orgA, body: { pageSize: 7 } },
		);
		expect(bodyPaged.json.pagination.pageSize).toBe(7);
	});

	it("POST refuses an updatedAt filter loudly — lookups track no update timestamp", async () => {
		const { status, json } = await apiJson("/api/v1/event/e_a1/formats", {
			token: RAW_TOKENS.orgA,
			body: { filters: { updatedAt: { after: "2020-01-01T00:00:00Z" } } },
		});
		expect(status).toBe(400);
		expect(json).toMatchObject({ error: "bad_request" });
	});

	it("serves every catalog with its spec fields", async () => {
		const formats = await apiJson<Record<string, unknown>[]>(
			"/api/v1/event/e_a1/formats",
			{ token: RAW_TOKENS.orgA },
		);
		expect(formats.json[0]).toMatchObject({
			id: "fmt_ws",
			name: "Workshop",
			default_duration_mins: 90,
			order: 1,
		});
		const rooms = await apiJson<Record<string, unknown>[]>(
			"/api/v1/event/e_a1/rooms",
			{ token: RAW_TOKENS.orgA },
		);
		expect(rooms.json[0]).toMatchObject({
			id: "room_1",
			name: "Room A",
			capacity: 120,
			order: 1,
		});
		const levels = await apiJson<Record<string, unknown>[]>(
			"/api/v1/event/e_a1/levels",
			{ token: RAW_TOKENS.orgA },
		);
		expect(levels.json[0]).toMatchObject({ id: "lvl_adv", name: "Advanced" });
		const languages = await apiJson<Record<string, unknown>[]>(
			"/api/v1/event/e_a1/languages",
			{ token: RAW_TOKENS.orgA },
		);
		expect(languages.json[0]).toMatchObject({ id: "lang_en", name: "English" });
		const tags = await apiJson<Record<string, unknown>[]>(
			"/api/v1/event/e_a1/tags",
			{ token: RAW_TOKENS.orgA },
		);
		expect(tags.json[0]).toMatchObject({ id: "tag_1", name: "Agents" });
	});

	it("an empty catalog returns an empty array, not an error", async () => {
		const { status, json } = await apiJson<unknown[]>(
			"/api/v1/event/e_a2/tracks",
			{ token: RAW_TOKENS.orgA },
		);
		expect(status).toBe(200);
		expect(json).toEqual([]);
	});
});

describe("session statuses", () => {
	it("GET /statuses lists the core pipeline (no draft) plus customs, flagged is_custom", async () => {
		const { json } = await apiJson<
			{ id: string; status: string | null; is_custom: boolean }[]
		>("/api/v1/event/e_a1/statuses", { token: RAW_TOKENS.orgA });
		const core = json.filter((s) => !s.is_custom).map((s) => s.id);
		// Drafts are hidden from this API, so the catalog never advertises them.
		expect(core).toEqual([
			"pending",
			"accept_queue",
			"accepted",
			"decline_queue",
			"declined",
			"withdrawn",
		]);
		const custom = json.find((s) => s.is_custom);
		expect(custom).toMatchObject({
			id: "cs_offered",
			name: "Offered",
			color: "#123456",
			status: null,
		});
	});

	it("POST /session-statuses searches the custom definitions only", async () => {
		const { json } = await apiJson<{
			results: { id: string; is_custom: boolean }[];
		}>("/api/v1/event/e_a1/session-statuses", {
			token: RAW_TOKENS.orgA,
			body: {},
		});
		expect(json.results).toHaveLength(1);
		expect(json.results[0]).toMatchObject({
			id: "cs_offered",
			is_custom: true,
		});
	});
});
