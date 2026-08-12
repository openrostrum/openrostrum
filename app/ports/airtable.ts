/**
 * Thin record I/O against one Airtable base — the transport under the sync
 * engine (docs/airtable-sync-design.md). The port carries NO sync logic: field
 * classes, three-way reconciliation, and tenancy filtering live in
 * app/sync/* + app/lib/airtable-map.ts. All Airtable I/O is background-only,
 * never in the request path: the API caps at 5 req/s per base, so D1 stays
 * the serving layer.
 */

import { z } from "zod";

export type AirtableFieldValue = string | number | boolean | null;
export type AirtableFields = Record<string, AirtableFieldValue>;

export interface AirtableRecord {
	airtableId: string;
	fields: AirtableFields;
}

// Our D1 id lives in this Airtable field and is the mirror's stable merge key
// (friendly_id semantics): re-syncing a record updates its row instead of
// duplicating it, and the team can reorder/regroup rows freely around it.
export const MERGE_FIELD = "Record ID";

const MergeKey = z.string().min(1);

/**
 * A record's merge key, or null when it has none the mirror can use — the
 * team cleared the cell, retyped the column, or created the row themselves.
 * Every caller of MERGE_FIELD asks through here so "usable key" is one answer.
 */
export function recordKey(record: { fields: AirtableFields }): string | null {
	return MergeKey.safeParse(record.fields[MERGE_FIELD]).data ?? null;
}

export interface AirtableBase {
	/**
	 * Every record's values for exactly `fields` (paginated internally). Only
	 * the named fields are requested, so the team's own columns never leave
	 * the base.
	 */
	list(table: string, fields: readonly string[]): Promise<AirtableRecord[]>;
	/**
	 * PATCH-upsert keyed on MERGE_FIELD — only the provided fields change, so
	 * team-added columns on the same row survive every sync. Returns the
	 * affected records (with their Airtable record ids).
	 */
	batchUpsert(
		table: string,
		records: ReadonlyArray<{ fields: AirtableFields }>,
	): Promise<AirtableRecord[]>;
	/** Delete records by Airtable record id. Missing ids are treated as already deleted (retries stay idempotent). */
	batchDelete(table: string, airtableIds: readonly string[]): Promise<void>;
	/** Extend the webhook's 7-day expiry (Airtable disables unrefreshed webhooks). */
	refreshWebhook(webhookId: string): Promise<void>;
}

export interface FakeAirtableCall {
	op: "list" | "upsert" | "delete" | "refresh";
	table: string;
	payload: unknown;
}

export interface FakeAirtableBase extends AirtableBase {
	/** Insert a record directly (simulates a team-created or pre-existing row). Returns its record id. */
	seed(table: string, fields: AirtableFields, airtableId?: string): string;
	/** Merge-patch a record's fields directly (simulates a team edit in the base). */
	edit(table: string, airtableId: string, patch: AirtableFields): void;
	/** Remove a record directly (simulates a team delete / trash). */
	remove(table: string, airtableId: string): void;
	/** One record's full stored fields (team-private columns included), or undefined. */
	get(table: string, airtableId: string): AirtableFields | undefined;
	/** Every stored record with full fields — the test oracle. */
	all(table: string): AirtableRecord[];
	/** Recorded port interactions, in call order. */
	calls: FakeAirtableCall[];
}

/**
 * Local/test adapter: an in-memory base with the same merge-key and
 * PATCH-only semantics as the real API, so both sync directions are
 * functionally verifiable with no Airtable account.
 */
export function createFakeAirtableBase(): FakeAirtableBase {
	const tables = new Map<string, Map<string, AirtableFields>>();
	const calls: FakeAirtableCall[] = [];
	let counter = 0;

	function tableStore(table: string): Map<string, AirtableFields> {
		let store = tables.get(table);
		if (!store) {
			store = new Map();
			tables.set(table, store);
		}
		return store;
	}

	return {
		calls,
		seed(table, fields, airtableId) {
			const id = airtableId ?? `rec_fake_${++counter}`;
			tableStore(table).set(id, { ...fields });
			return id;
		},
		edit(table, airtableId, patch) {
			const existing = tableStore(table).get(airtableId);
			if (!existing) throw new Error(`No record ${airtableId} in ${table}`);
			tableStore(table).set(airtableId, { ...existing, ...patch });
		},
		remove(table, airtableId) {
			tableStore(table).delete(airtableId);
		},
		get(table, airtableId) {
			const fields = tableStore(table).get(airtableId);
			return fields ? { ...fields } : undefined;
		},
		all(table) {
			return [...tableStore(table)].map(([airtableId, fields]) => ({
				airtableId,
				fields: { ...fields },
			}));
		},
		async list(table, fields) {
			calls.push({ op: "list", table, payload: [...fields] });
			return [...tableStore(table)].map(([airtableId, stored]) => {
				const picked: AirtableFields = {};
				for (const f of fields) {
					if (f in stored) picked[f] = stored[f] ?? null;
				}
				return { airtableId, fields: picked };
			});
		},
		async batchUpsert(table, records) {
			calls.push({
				op: "upsert",
				table,
				payload: records.map((r) => r.fields),
			});
			const store = tableStore(table);
			const results: AirtableRecord[] = [];
			for (const record of records) {
				const mergeValue = recordKey(record);
				if (mergeValue === null) {
					throw new Error(`Upsert record is missing "${MERGE_FIELD}"`);
				}
				const existing = [...store].find(
					([, stored]) => stored[MERGE_FIELD] === mergeValue,
				);
				if (existing) {
					const merged = { ...existing[1], ...record.fields };
					store.set(existing[0], merged);
					results.push({ airtableId: existing[0], fields: { ...merged } });
				} else {
					const id = `rec_fake_${++counter}`;
					store.set(id, { ...record.fields });
					results.push({ airtableId: id, fields: { ...record.fields } });
				}
			}
			return results;
		},
		async batchDelete(table, airtableIds) {
			calls.push({ op: "delete", table, payload: [...airtableIds] });
			const store = tableStore(table);
			for (const id of airtableIds) store.delete(id);
		},
		async refreshWebhook(webhookId) {
			calls.push({ op: "refresh", table: "", payload: webhookId });
		},
	};
}

const AIRTABLE_API = "https://api.airtable.com/v0";
// Airtable rejects >10 records per write request.
const BATCH_SIZE = 10;
// 4 req/s keeps headroom under the shared 5 req/s per-base cap (REST +
// webhooks + the team's own automations all draw from it).
const MIN_REQUEST_SPACING_MS = 250;
// Airtable's documented 429 penalty: the base rejects everything for 30s.
const RATE_LIMIT_WAIT_MS = 30_000;
const MAX_ATTEMPTS = 5;

export interface AirtableTransport {
	fetch: typeof fetch;
	sleep: (ms: number) => Promise<void>;
}

const realTransport: AirtableTransport = {
	fetch: (...args) => fetch(...args),
	sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export function createAirtableBase(
	env: Env,
	transport: AirtableTransport = realTransport,
): AirtableBase {
	const baseId = env.AIRTABLE_BASE_ID;
	const apiKey = env.AIRTABLE_API_KEY;
	if (!baseId || !apiKey) {
		throw new Error(
			"Airtable is not configured — set AIRTABLE_API_KEY and AIRTABLE_BASE_ID.",
		);
	}

	let lastRequestAt = 0;

	// `path` is relative to the API root: record I/O lives under
	// `{baseId}/{table}`, the webhook API under `bases/{baseId}/webhooks`.
	async function request(
		method: string,
		path: string,
		body?: unknown,
	): Promise<unknown> {
		for (let attempt = 1; ; attempt += 1) {
			const wait = lastRequestAt + MIN_REQUEST_SPACING_MS - Date.now();
			if (wait > 0) await transport.sleep(wait);
			lastRequestAt = Date.now();

			const res = await transport.fetch(`${AIRTABLE_API}/${path}`, {
				method,
				headers: {
					Authorization: `Bearer ${apiKey}`,
					"Content-Type": "application/json",
				},
				body: body === undefined ? undefined : JSON.stringify(body),
			});
			if (res.ok) return res.json();

			// Idempotent delete: a record already gone is a success, not an error
			// (at-least-once ticks re-send deletes).
			if (res.status === 404 && method === "DELETE") return null;

			const retryable = res.status === 429 || res.status >= 500;
			if (!retryable || attempt >= MAX_ATTEMPTS) {
				throw new Error(
					`Airtable ${method} ${path} failed (${res.status}): ${await res.text()}`,
				);
			}
			const retryAfter = Number(res.headers.get("Retry-After"));
			const backoff =
				res.status === 429
					? Number.isFinite(retryAfter) && retryAfter > 0
						? retryAfter * 1000
						: RATE_LIMIT_WAIT_MS
					: 1000 * 2 ** (attempt - 1);
			await transport.sleep(backoff);
		}
	}

	return {
		async list(table, fields) {
			const records: AirtableRecord[] = [];
			let offset: string | undefined;
			do {
				const params = new URLSearchParams({ pageSize: "100" });
				for (const f of fields) params.append("fields[]", f);
				if (offset) params.set("offset", offset);
				const page = (await request(
					"GET",
					`${baseId}/${encodeURIComponent(table)}?${params}`,
				)) as {
					records: Array<{ id: string; fields: AirtableFields }>;
					offset?: string;
				};
				for (const r of page.records) {
					records.push({ airtableId: r.id, fields: r.fields ?? {} });
				}
				offset = page.offset;
			} while (offset);
			return records;
		},
		async batchUpsert(table, records) {
			const results: AirtableRecord[] = [];
			for (let i = 0; i < records.length; i += BATCH_SIZE) {
				const chunk = records.slice(i, i + BATCH_SIZE);
				const res = (await request(
					"PATCH",
					`${baseId}/${encodeURIComponent(table)}`,
					{
						performUpsert: { fieldsToMergeOn: [MERGE_FIELD] },
						// Let Airtable coerce pushed strings into select options etc., so
						// the team's own field types keep working.
						typecast: true,
						records: chunk.map((r) => ({ fields: r.fields })),
					},
				)) as { records: Array<{ id: string; fields: AirtableFields }> };
				for (const r of res.records) {
					results.push({ airtableId: r.id, fields: r.fields ?? {} });
				}
			}
			return results;
		},
		async batchDelete(table, airtableIds) {
			for (let i = 0; i < airtableIds.length; i += BATCH_SIZE) {
				const chunk = airtableIds.slice(i, i + BATCH_SIZE);
				const params = new URLSearchParams();
				for (const id of chunk) params.append("records[]", id);
				await request(
					"DELETE",
					`${baseId}/${encodeURIComponent(table)}?${params}`,
				);
			}
		},
		async refreshWebhook(webhookId) {
			await request(
				"POST",
				`bases/${baseId}/webhooks/${encodeURIComponent(webhookId)}/refresh`,
			);
		},
	};
}

/**
 * Capability-based resolution (the email-port pattern): a real base only when
 * both env values are present; otherwise null, and callers surface an explicit
 * not-configured state — never a silent no-op. Tests inject
 * createFakeAirtableBase() directly.
 */
export function getAirtableBase(env: Env): AirtableBase | null {
	return env.AIRTABLE_API_KEY && env.AIRTABLE_BASE_ID
		? createAirtableBase(env)
		: null;
}
