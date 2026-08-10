import { beforeEach, describe, expect, it } from "vitest";
import { apiJson, PII, RAW_TOKENS, seedApiFixtures } from "./api-v1-fixtures";

// Contact-bearing payloads under the hardcoded Hide-PII rule (flows/09 rule p,
// multi-tenancy binding rule): emails j***@a***.com, phones ***-***-1234,
// internal fields absent — on the contact endpoints AND nested in sessions.

beforeEach(seedApiFixtures);

type ContactRow = Record<string, unknown>;
type Envelope = { results: ContactRow[] };

describe("PII masking", () => {
	it("masks email and phones in the Sessionboard formats", async () => {
		const { json } = await apiJson<ContactRow>(
			"/api/v1/event/e_a1/contacts/c_speaker",
			{ token: RAW_TOKENS.orgA },
		);
		// jane.smith@university.edu → j***@u***.edu (rule p's documented shape)
		expect(json.email).toBe("j***@u***.edu");
		expect(json.phone_mobile).toBe("***-***-4567");
		expect(json.phone_home).toBe("***-***-6543");
	});

	it("leaks no raw PII or internal fields anywhere in the contact payload", async () => {
		const { text } = await apiJson("/api/v1/event/e_a1/contacts/c_speaker", {
			token: RAW_TOKENS.orgA,
		});
		expect(text).not.toContain(PII.email);
		expect(text).not.toContain("123-4567");
		expect(text).not.toContain(PII.logistics);
		expect(text).not.toContain("logistics");
		expect(text).not.toContain("speaker_score");
		expect(text).not.toContain("speaker_fee");
	});

	it("masks contacts nested on session payloads too", async () => {
		const { json, text } = await apiJson<{
			speakers: { email: string; phone_mobile: string }[];
		}>("/api/v1/event/e_a1/sessions/sub_accepted", { token: RAW_TOKENS.orgA });
		expect(json.speakers[0]!.email).toBe("j***@u***.edu");
		expect(json.speakers[0]!.phone_mobile).toBe("***-***-4567");
		expect(text).not.toContain(PII.email);
		expect(text).not.toContain(PII.logistics);
	});

	it("masks the whole speaker search listing", async () => {
		const { text } = await apiJson("/api/v1/event/e_a1/speakers", {
			token: RAW_TOKENS.orgA,
			body: {},
		});
		expect(text).not.toContain("@university.edu");
		expect(text).not.toContain("@example.com");
	});
});

describe("contact shape", () => {
	it("serializes the Sessionboard Contact field names", async () => {
		const { json } = await apiJson<ContactRow>(
			"/api/v1/event/e_a1/contacts/c_speaker",
			{ token: RAW_TOKENS.orgA },
		);
		expect(json).toMatchObject({
			id: "c_speaker",
			full_name: "Jane Smith",
			first_name: "Jane",
			last_name: "Smith",
			title: "Professor",
			company_name: "State University",
			about: "Distributed systems researcher.",
			is_public: true,
			admin_url: "https://api.example.com/admin/contacts/c_speaker",
		});
	});
});

describe("speakers vs contacts", () => {
	it("speakers = contacts holding a program role on a non-draft submission", async () => {
		const { json } = await apiJson<Envelope>("/api/v1/event/e_a1/speakers", {
			token: RAW_TOKENS.orgA,
			body: {},
		});
		const ids = json.results.map((r) => r.id).sort();
		// c_hidden (chairperson) counts; c_roster (draft-only) and c_secondary
		// (assistant role) do not; org B's contact can never appear.
		expect(ids).toEqual(["c_hidden", "c_queued", "c_speaker"]);
	});

	it("narrows speakers by session status through the filters.status body field", async () => {
		const { json } = await apiJson<Envelope>("/api/v1/event/e_a1/speakers", {
			token: RAW_TOKENS.orgA,
			body: { filters: { status: "accepted" } },
		});
		expect(json.results.map((r) => r.id).sort()).toEqual([
			"c_hidden",
			"c_speaker",
		]);
	});

	it("contacts search returns the full event roster", async () => {
		const { json } = await apiJson<Envelope>("/api/v1/event/e_a1/contacts", {
			token: RAW_TOKENS.orgA,
			body: {},
		});
		expect(json.results.map((r) => r.id).sort()).toEqual([
			"c_hidden",
			"c_queued",
			"c_roster",
			"c_secondary",
			"c_speaker",
		]);
	});

	it("a roster-only contact 404s on the speaker endpoint but resolves as a contact", async () => {
		const asSpeaker = await apiJson("/api/v1/event/e_a1/speakers/c_roster", {
			token: RAW_TOKENS.orgA,
		});
		expect(asSpeaker.status).toBe(404);
		const asContact = await apiJson("/api/v1/event/e_a1/contacts/c_roster", {
			token: RAW_TOKENS.orgA,
		});
		expect(asContact.status).toBe(200);
	});

	it("refuses an updatedAt filter loudly — contacts track no update timestamp", async () => {
		const { status, json } = await apiJson("/api/v1/event/e_a1/contacts", {
			token: RAW_TOKENS.orgA,
			body: { filters: { updatedAt: { after: "2020-01-01T00:00:00Z" } } },
		});
		expect(status).toBe(400);
		expect(json).toMatchObject({ error: "bad_request" });
	});

	it("another org's contact id 404s through this event", async () => {
		const { status } = await apiJson("/api/v1/event/e_a1/contacts/c_b", {
			token: RAW_TOKENS.orgA,
		});
		expect(status).toBe(404);
	});
});
