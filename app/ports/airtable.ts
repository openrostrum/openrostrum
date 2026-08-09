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

/** Prod: real Airtable base — wired in the capabilities phase. */
export function createAirtableSync(_env: Env): AirtableSync {
	return {
		async upsert() {
			throw new Error(
				"Airtable adapter not configured yet (capabilities phase).",
			);
		},
	};
}

export function getAirtableSync(env: Env): AirtableSync {
	return env.AIRTABLE_API_KEY
		? createAirtableSync(env)
		: createLocalAirtableSync();
}
