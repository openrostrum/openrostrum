/**
 * Two-way sync: push app changes to the base, pull team-side edits back into
 * D1 (Airtable wins on team-editable fields) — full design in
 * docs/airtable-sync-design.md. All Airtable I/O is background-only, never in
 * the request path: the API caps at 5 req/s per base, so D1 stays the serving
 * layer.
 */
export interface AirtableRecord {
	table: string;
	id: string;
	fields: Record<string, unknown>;
}

export interface AirtableSync {
	upsert(record: AirtableRecord): Promise<void>;
}

/** Local/dev/test: collect calls in memory (assert on them, no network). */
export function createLocalAirtableSync(): AirtableSync & {
	records: AirtableRecord[];
} {
	const records: AirtableRecord[] = [];
	return {
		records,
		async upsert(record) {
			records.push(record);
		},
	};
}

const AIRTABLE_API = "https://api.airtable.com/v0";
// Our D1 id lives in this Airtable field and is the mirror's stable merge key,
// so re-syncing a record updates its row instead of duplicating it.
const MERGE_FIELD = "Record ID";

/** Prod: upsert a record into the real base, keyed on our D1 id (MERGE_FIELD). */
export function createAirtableSync(env: Env): AirtableSync {
	return {
		async upsert(record) {
			const url = `${AIRTABLE_API}/${env.AIRTABLE_BASE_ID}/${encodeURIComponent(
				record.table,
			)}`;
			const res = await fetch(url, {
				method: "PATCH",
				headers: {
					Authorization: `Bearer ${env.AIRTABLE_API_KEY}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					performUpsert: { fieldsToMergeOn: [MERGE_FIELD] },
					typecast: true, // let Airtable coerce strings into select options
					records: [{ fields: { [MERGE_FIELD]: record.id, ...record.fields } }],
				}),
			});
			if (!res.ok) {
				throw new Error(
					`Airtable upsert failed (${res.status}): ${await res.text()}`,
				);
			}
		},
	};
}

export function getAirtableSync(env: Env): AirtableSync {
	return env.AIRTABLE_API_KEY
		? createAirtableSync(env)
		: createLocalAirtableSync();
}
