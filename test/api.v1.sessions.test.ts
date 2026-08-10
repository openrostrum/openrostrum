import { beforeEach, describe, expect, it } from "vitest";
import { apiJson, PII, RAW_TOKENS, seedApiFixtures } from "./api-v1-fixtures";

// Envelope + projection law for the session endpoints, pinned to
// docs/reference/sessionboard-openapi.yaml (field names, the two envelope
// dialects, {} vs null nesting) and docs/flows/09-data-exposure.md (raw
// statuses, hidden drafts, hidden withdrawal metadata).

beforeEach(seedApiFixtures);

type Envelope = {
	results: Record<string, unknown>[];
	pagination: {
		currentPage: number;
		pageSize: number;
		totalPages: number;
		totalResults: number;
	};
};

const search = (body: unknown = {}, path = "/api/v1/event/e_a1/sessions") =>
	apiJson<Envelope>(path, { token: RAW_TOKENS.orgA, body });

describe("POST /sessions (search)", () => {
	it("returns raw statuses incl. queue values, hides drafts, lists top-level only", async () => {
		const { json } = await search();
		const byId = Object.fromEntries(json.results.map((r) => [r.id, r.status]));
		expect(byId).toEqual({
			sub_accepted: "accepted",
			sub_queue: "accept_queue",
			sub_declineq: "decline_queue",
			sub_abstract: "pending",
			sub_withdrawn: "withdrawn",
			// no sub_draft (drafts are hidden from the API),
			// no sub_child (subsessions nest under their parent).
		});
	});

	it("wraps results in the camelCase search pagination envelope (default 25)", async () => {
		const { json } = await search();
		expect(json.pagination).toEqual({
			currentPage: 1,
			pageSize: 25,
			totalPages: 1,
			totalResults: 5,
		});
	});

	it("filters by status, isAbstract, and rejects a draft filter", async () => {
		const queued = await search({ filters: { status: "accept_queue" } });
		expect(queued.json.results.map((r) => r.id)).toEqual(["sub_queue"]);
		const abstracts = await search({ filters: { isAbstract: true } });
		expect(abstracts.json.results.map((r) => r.id)).toEqual(["sub_abstract"]);
		const draft = await search({ filters: { status: "draft" } });
		expect(draft.status).toBe(400);
	});

	it("serializes unassigned nested metadata as {} on search", async () => {
		const { json } = await search({ filters: { status: "accept_queue" } });
		const row = json.results[0]!;
		expect(row.track).toEqual({});
		expect(row.room).toEqual({});
		expect(row.level).toEqual({});
		expect(row.format).toEqual({});
	});

	it("clamps pageSize to 100 and pages deterministically", async () => {
		const clamped = await search(
			{},
			"/api/v1/event/e_a1/sessions?pageSize=500",
		);
		expect(clamped.json.pagination.pageSize).toBe(100);

		const page1 = await search(
			{},
			"/api/v1/event/e_a1/sessions?page=1&pageSize=2",
		);
		const page2 = await search(
			{},
			"/api/v1/event/e_a1/sessions?page=2&pageSize=2",
		);
		const page3 = await search(
			{},
			"/api/v1/event/e_a1/sessions?page=3&pageSize=2",
		);
		expect(page1.json.pagination).toEqual({
			currentPage: 1,
			pageSize: 2,
			totalPages: 3,
			totalResults: 5,
		});
		const ids = [
			...page1.json.results,
			...page2.json.results,
			...page3.json.results,
		].map((r) => r.id);
		expect(new Set(ids).size).toBe(5);
		expect(page3.json.results).toHaveLength(1);

		const beyond = await search(
			{},
			"/api/v1/event/e_a1/sessions?page=9&pageSize=2",
		);
		expect(beyond.json.results).toEqual([]);
		expect(beyond.json.pagination.totalResults).toBe(5);
	});

	it("rejects a malformed JSON body with 400", async () => {
		const { apiV1 } = await import("../app/api/v1/app");
		const { env } = await import("cloudflare:test");
		const response = await apiV1.fetch(
			new Request("https://api.example.com/api/v1/event/e_a1/sessions", {
				method: "POST",
				headers: {
					"x-access-token": RAW_TOKENS.orgA,
					"content-type": "application/json",
				},
				body: "{not json",
			}),
			env,
		);
		expect(response.status).toBe(400);
	});
});

describe("GET /sessions (CRUD proxy)", () => {
	it("uses the data + snake_case envelope and null for unassigned metadata", async () => {
		const { json } = await apiJson<{
			data: Record<string, unknown>[];
			pagination: Record<string, number>;
		}>("/api/v1/event/e_a1/sessions?status=accept_queue", {
			token: RAW_TOKENS.orgA,
		});
		expect(json.pagination).toEqual({
			current_page: 1,
			page_size: 25,
			total_pages: 1,
			total_results: 1,
		});
		const row = json.data[0]!;
		expect(row.id).toBe("sub_queue");
		expect(row.track).toBeNull();
		expect(row.room).toBeNull();
	});

	it("filters by search term, track_id, and is_abstract", async () => {
		const bySearch = await apiJson<{ data: { id: string }[] }>(
			"/api/v1/event/e_a1/sessions?search=Queued",
			{ token: RAW_TOKENS.orgA },
		);
		expect(bySearch.json.data.map((r) => r.id)).toEqual(["sub_queue"]);
		const byTrack = await apiJson<{ data: { id: string }[] }>(
			"/api/v1/event/e_a1/sessions?track_id=tr_1",
			{ token: RAW_TOKENS.orgA },
		);
		expect(byTrack.json.data.map((r) => r.id)).toEqual(["sub_accepted"]);
		const byType = await apiJson<{ data: { id: string }[] }>(
			"/api/v1/event/e_a1/sessions?is_abstract=true",
			{ token: RAW_TOKENS.orgA },
		);
		expect(byType.json.data.map((r) => r.id)).toEqual(["sub_abstract"]);
	});

	it("an unknown status string matches nothing (plain string param, not the strict enum)", async () => {
		const { status, json } = await apiJson<{ data: unknown[] }>(
			"/api/v1/event/e_a1/sessions?status=nonsense",
			{ token: RAW_TOKENS.orgA },
		);
		expect(status).toBe(200);
		expect(json.data).toEqual([]);
	});
});

describe("GET /sessions/:id", () => {
	it("returns the full Sessionboard session shape for an assigned session", async () => {
		const { json } = await apiJson("/api/v1/event/e_a1/sessions/sub_accepted", {
			token: RAW_TOKENS.orgA,
		});
		expect(json).toMatchObject({
			id: "sub_accepted",
			title: "Accepted talk",
			description: "<p>All about it</p>",
			status: "accepted",
			custom_status_id: "cs_offered",
			custom_status: { id: "cs_offered", name: "Offered" },
			starts_at: "2026-10-12T17:00:00.000Z",
			ends_at: "2026-10-12T18:30:00.000Z",
			is_public: true,
			is_abstract: false,
			client_session_id: "CS-1",
			ceu_credits: 1.5,
			capacity: 100,
			custom_fields: [
				{
					id: "fld_notes",
					name: "Anything else?",
					value: "Need a projector",
					type: "textarea",
				},
			],
			track: { id: "tr_1", name: "AI Infrastructure", color: "#0ea5e9" },
			level: { id: "lvl_adv", name: "Advanced" },
			format: { id: "fmt_ws", name: "Workshop" },
			room: { id: "room_1", name: "Room A", capacity: 120 },
			language: { id: "lang_en", name: "English" },
			tags: [{ id: "tag_1", name: "Agents" }],
			admin_url: "https://api.example.com/admin/submissions/sub_accepted",
		});
	});

	it("splits legacy role arrays and excludes secondary contacts from participants", async () => {
		const { json, text } = await apiJson<{
			speakers: { id: string }[];
			chairpersons: { id: string; is_public: boolean }[];
			moderators: unknown[];
			participants: { id: string }[];
		}>("/api/v1/event/e_a1/sessions/sub_accepted", { token: RAW_TOKENS.orgA });
		expect(json.speakers.map((s) => s.id)).toEqual(["c_speaker"]);
		expect(json.chairpersons.map((s) => s.id)).toEqual(["c_hidden"]);
		expect(json.moderators).toEqual([]);
		expect(json.participants.map((p) => p.id)).toEqual([
			"c_speaker",
			"c_hidden",
		]);
		// Secondary contacts assist with tasks — never session-payload identities.
		expect(text).not.toContain("Assistant");
		expect(text).not.toContain(PII.secondaryEmail);
	});

	it("keeps hidden speakers in the payload, flagged is_public:false", async () => {
		const { json } = await apiJson<{
			chairpersons: { id: string; is_public: boolean }[];
		}>("/api/v1/event/e_a1/sessions/sub_accepted", { token: RAW_TOKENS.orgA });
		expect(json.chairpersons[0]).toMatchObject({
			id: "c_hidden",
			is_public: false,
		});
	});

	it("nests subsessions minimally by default and fully with expand=subsession_details", async () => {
		const minimal = await apiJson<{ subsessions: Record<string, unknown>[] }>(
			"/api/v1/event/e_a1/sessions/sub_accepted",
			{ token: RAW_TOKENS.orgA },
		);
		expect(minimal.json.subsessions).toHaveLength(1);
		expect(minimal.json.subsessions[0]!.id).toBe("sub_child");
		expect(minimal.json.subsessions[0]!.status).toBeUndefined();

		const detailed = await apiJson<{ subsessions: Record<string, unknown>[] }>(
			"/api/v1/event/e_a1/sessions/sub_accepted?expand=subsession_details",
			{ token: RAW_TOKENS.orgA },
		);
		expect(detailed.json.subsessions[0]!.status).toBe("accepted");
	});

	it("hides withdrawal metadata while serving the withdrawn status raw", async () => {
		const { json, text } = await apiJson(
			"/api/v1/event/e_a1/sessions/sub_withdrawn",
			{ token: RAW_TOKENS.orgA },
		);
		expect(json.status).toBe("withdrawn");
		expect(text).not.toContain(PII.withdrawnReason);
		expect(text).not.toContain("withdrawn_reason");
		expect(text).not.toContain("withdrawn_by");
	});

	it("404s a draft id — drafts do not exist on this surface", async () => {
		const { status } = await apiJson("/api/v1/event/e_a1/sessions/sub_draft", {
			token: RAW_TOKENS.orgA,
		});
		expect(status).toBe(404);
	});

	it("404s a session id that belongs to another event of the same org", async () => {
		const { status } = await apiJson(
			"/api/v1/event/e_a2/sessions/sub_accepted",
			{ token: RAW_TOKENS.orgA },
		);
		expect(status).toBe(404);
	});
});

describe("POST /sessions/status", () => {
	it("returns lightweight rows; subsessions appear nested AND as flat rows", async () => {
		const { json } = await search({}, "/api/v1/event/e_a1/sessions/status");
		const ids = json.results.map((r) => r.id);
		expect(ids).toContain("sub_child");
		const parent = json.results.find((r) => r.id === "sub_accepted") as {
			subsessions: { id: string }[];
			deleted_at: unknown;
		};
		expect(parent.subsessions.map((s) => s.id)).toEqual(["sub_child"]);
		expect(parent.deleted_at).toBeNull();
		expect(ids).not.toContain("sub_draft");
	});

	it("a deletedAt-bounded filter matches nothing (nothing soft-deletes here)", async () => {
		const { json } = await search(
			{ filters: { deletedAt: { after: "2020-01-01T00:00:00Z" } } },
			"/api/v1/event/e_a1/sessions/status",
		);
		expect(json.results).toEqual([]);
		expect(json.pagination.totalResults).toBe(0);
	});
});
