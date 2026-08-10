import { describe, expect, it } from "vitest";
import { createAirtableBase } from "../app/ports/airtable";

// Pins the transport contract the design doc verified against the Airtable
// Web API (2026-08-09): 5 req/s shared cap → 429 means back off (30s unless
// Retry-After says otherwise) and retry; writes cap at 10 records/request;
// list paginates by offset cursor; only mapped fields are requested.

const ENV = {
	AIRTABLE_API_KEY: "pat_test",
	AIRTABLE_BASE_ID: "appTEST",
} as unknown as Env;

type Reply = {
	status: number;
	body?: unknown;
	headers?: Record<string, string>;
};

function fakeTransport(replies: Reply[]) {
	const requests: Array<{ url: string; method: string; body: unknown }> = [];
	const sleeps: number[] = [];
	return {
		requests,
		sleeps,
		transport: {
			fetch: (async (url: RequestInfo | URL, init?: RequestInit) => {
				requests.push({
					url: String(url),
					method: init?.method ?? "GET",
					body: init?.body ? JSON.parse(String(init.body)) : undefined,
				});
				const reply = replies.shift() ?? { status: 200, body: { records: [] } };
				return new Response(JSON.stringify(reply.body ?? {}), {
					status: reply.status,
					headers: reply.headers,
				});
			}) as typeof fetch,
			sleep: async (ms: number) => {
				sleeps.push(ms);
			},
		},
	};
}

describe("airtable prod adapter", () => {
	it("waits 30s after a 429 and retries until the request succeeds", async () => {
		const { transport, sleeps, requests } = fakeTransport([
			{ status: 429, body: { error: "RATE_LIMIT" } },
			{
				status: 200,
				body: { records: [{ id: "rec1", fields: { "Record ID": "r1" } }] },
			},
		]);
		const base = createAirtableBase(ENV, transport);
		const records = await base.list("Sessions", ["Record ID"]);
		expect(records).toEqual([
			{ airtableId: "rec1", fields: { "Record ID": "r1" } },
		]);
		expect(requests).toHaveLength(2);
		expect(sleeps).toContain(30_000);
	});

	it("honors a Retry-After header over the default backoff", async () => {
		const { transport, sleeps } = fakeTransport([
			{ status: 429, headers: { "Retry-After": "7" } },
			{ status: 200, body: { records: [] } },
		]);
		await createAirtableBase(ENV, transport).list("Sessions", ["Record ID"]);
		expect(sleeps).toContain(7000);
	});

	it("gives up after repeated 429s with the status in the error", async () => {
		const { transport } = fakeTransport(
			Array.from({ length: 10 }, () => ({ status: 429, body: {} })),
		);
		await expect(
			createAirtableBase(ENV, transport).list("Sessions", ["Record ID"]),
		).rejects.toThrow(/429/);
	});

	it("does not retry a non-retryable client error", async () => {
		const { transport, requests } = fakeTransport([
			{ status: 422, body: { error: "INVALID_REQUEST" } },
		]);
		await expect(
			createAirtableBase(ENV, transport).batchUpsert("Sessions", [
				{ fields: { "Record ID": "r1" } },
			]),
		).rejects.toThrow(/422/);
		expect(requests).toHaveLength(1);
	});

	it("follows the offset cursor and requests only the named fields", async () => {
		const { transport, requests } = fakeTransport([
			{
				status: 200,
				body: {
					records: [{ id: "rec1", fields: { Title: "A" } }],
					offset: "next123",
				},
			},
			{
				status: 200,
				body: { records: [{ id: "rec2", fields: { Title: "B" } }] },
			},
		]);
		const records = await createAirtableBase(ENV, transport).list("Sessions", [
			"Record ID",
			"Title",
		]);
		expect(records.map((r) => r.airtableId)).toEqual(["rec1", "rec2"]);
		expect(requests[0]?.url).toContain("fields%5B%5D=Title");
		expect(requests[0]?.url).not.toContain("offset");
		expect(requests[1]?.url).toContain("offset=next123");
	});

	it("splits upserts into batches of 10 with the merge-key configuration", async () => {
		const replies = Array.from({ length: 2 }, () => ({
			status: 200,
			body: { records: [] },
		}));
		const { transport, requests } = fakeTransport(replies);
		await createAirtableBase(ENV, transport).batchUpsert(
			"Sessions",
			Array.from({ length: 12 }, (_, i) => ({
				fields: { "Record ID": `r${i}` },
			})),
		);
		expect(requests).toHaveLength(2);
		const first = requests[0]?.body as {
			performUpsert: { fieldsToMergeOn: string[] };
			records: unknown[];
		};
		expect(first.performUpsert.fieldsToMergeOn).toEqual(["Record ID"]);
		expect(first.records).toHaveLength(10);
		expect((requests[1]?.body as { records: unknown[] }).records).toHaveLength(
			2,
		);
	});

	it("treats deleting an already-deleted record as success (idempotent retries)", async () => {
		const { transport } = fakeTransport([{ status: 404, body: {} }]);
		await expect(
			createAirtableBase(ENV, transport).batchDelete("Sessions", ["recGone"]),
		).resolves.toBeUndefined();
	});
});
