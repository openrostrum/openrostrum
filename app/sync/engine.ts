import type { FieldClass, TableMap } from "~/lib/airtable-map";
import type {
	AirtableFields,
	AirtableFieldValue,
	AirtableRecord,
} from "~/ports/airtable";
import { recordKey } from "~/ports/airtable";

/**
 * Snapshot three-way reconciliation, pure: the caller loads/filters rows (the
 * tenant guard happens BEFORE this module) and applies the returned plan. Per
 * mapped field vs the last-synced snapshot: only-local-changed → push,
 * only-remote-changed → pull (class-routed), both changed → the class rule.
 */

export interface LocalProjection {
	recordId: string;
	fields: AirtableFields;
}

export interface LinkState {
	recordId: string;
	airtableId: string;
	snapshot: AirtableFields | null;
}

export interface PullChange {
	field: string;
	fieldClass: FieldClass;
	value: AirtableFieldValue;
	/** True when the app side changed too — Airtable won a real conflict. */
	conflict: boolean;
}

export interface TablePlan {
	/** Local rows with no link and no matching remote row → push as new records. */
	creates: LocalProjection[];
	/** Local rows with no link but a remote row carrying their merge key → re-link. */
	adoptions: Array<{ recordId: string; airtableId: string }>;
	/**
	 * Records with at least one app-side value the base must take (a local
	 * edit, or an app-owned field the team drifted). The pushed field CONTENT
	 * is computed once, post-apply, by `diffFields` — never here — so there is
	 * exactly one projection-vs-base comparison in the system.
	 */
	pushes: Array<{ recordId: string; airtableId: string }>;
	/** Inbound field changes to apply locally, routed by class. */
	pulls: Array<{ recordId: string; airtableId: string; changes: PullChange[] }>;
	/** Linked, present locally, gone from the base → archive candidates. */
	archives: Array<{ recordId: string; airtableId: string }>;
	/** Linked, gone locally, still in the base → propagate the app-side delete. */
	remoteDeletes: Array<{ recordId: string; airtableId: string }>;
	/** Linked, gone on both sides → drop the link. */
	unlinks: string[];
	/** Linked + agreeing, but the stored snapshot is stale → refresh it. */
	snapshotRefreshes: string[];
	/** Remote records that carry no/unknown merge key — the team's own rows, untouched. */
	orphanCount: number;
	/** Links whose local row exists — the circuit breaker's denominator. */
	linkedPresent: number;
}

export function planTableSync(
	map: TableMap,
	locals: readonly LocalProjection[],
	links: readonly LinkState[],
	remotes: readonly AirtableRecord[],
): TablePlan {
	const localById = new Map(locals.map((l) => [l.recordId, l]));
	const linkById = new Map(links.map((l) => [l.recordId, l]));

	const remoteByRecordId = new Map<string, AirtableRecord>();
	let orphanCount = 0;
	for (const remote of remotes) {
		const mergeValue = recordKey(remote);
		if (
			mergeValue === null ||
			remoteByRecordId.has(mergeValue) ||
			(!localById.has(mergeValue) && !linkById.has(mergeValue))
		) {
			orphanCount += 1;
			continue;
		}
		remoteByRecordId.set(mergeValue, remote);
	}

	const plan: TablePlan = {
		creates: [],
		adoptions: [],
		pushes: [],
		pulls: [],
		archives: [],
		remoteDeletes: [],
		unlinks: [],
		snapshotRefreshes: [],
		orphanCount,
		linkedPresent: 0,
	};

	function reconcilePair(
		local: LocalProjection,
		airtableId: string,
		snapshot: AirtableFields | null,
		remoteFields: AirtableFields,
	): void {
		let needsPush = false;
		const changes: PullChange[] = [];
		let agreedButStale = false;
		for (const [field, spec] of Object.entries(map.fields)) {
			const base = snapshot?.[field] ?? null;
			const loc = local.fields[field] ?? null;
			const remRaw = remoteFields[field] ?? null;
			const rem = spec.normalizeRemote ? spec.normalizeRemote(remRaw) : remRaw;
			if (loc === rem) {
				if (base !== loc) agreedButStale = true;
				continue;
			}
			if (spec.class === "app-owned") {
				// The app is authoritative: a remote edit is corrected back, a local
				// change is pushed — one op either way.
				needsPush = true;
				continue;
			}
			if (rem === base) {
				needsPush = true;
				continue;
			}
			changes.push({
				field,
				fieldClass: spec.class,
				value: rem,
				conflict: loc !== base,
			});
		}
		if (needsPush) {
			plan.pushes.push({ recordId: local.recordId, airtableId });
		}
		if (changes.length > 0) {
			plan.pulls.push({ recordId: local.recordId, airtableId, changes });
		}
		if (agreedButStale && !needsPush && changes.length === 0) {
			plan.snapshotRefreshes.push(local.recordId);
		}
	}

	for (const link of links) {
		const local = localById.get(link.recordId);
		const remote = remoteByRecordId.get(link.recordId);
		if (local) {
			plan.linkedPresent += 1;
			if (remote) {
				reconcilePair(local, link.airtableId, link.snapshot, remote.fields);
			} else {
				plan.archives.push({
					recordId: link.recordId,
					airtableId: link.airtableId,
				});
			}
		} else if (remote) {
			plan.remoteDeletes.push({
				recordId: link.recordId,
				airtableId: remote.airtableId,
			});
		} else {
			plan.unlinks.push(link.recordId);
		}
	}

	for (const local of locals) {
		if (linkById.has(local.recordId)) continue;
		const remote = remoteByRecordId.get(local.recordId);
		if (remote) {
			// The base already holds this record (a link lost to a crash, or a
			// pre-existing base): re-link and reconcile against an empty snapshot —
			// Airtable wins where both sides hold team-editable values.
			plan.adoptions.push({
				recordId: local.recordId,
				airtableId: remote.airtableId,
			});
			reconcilePair(local, remote.airtableId, null, remote.fields);
		} else {
			plan.creates.push(local);
		}
	}

	return plan;
}

/** Mapped fields that differ between the app's projection and the base's record. */
export function diffFields(
	map: TableMap,
	localFields: AirtableFields,
	remoteFields: AirtableFields,
): AirtableFields {
	const diff: AirtableFields = {};
	for (const [field, spec] of Object.entries(map.fields)) {
		const loc = localFields[field] ?? null;
		const remRaw = remoteFields[field] ?? null;
		const rem = spec.normalizeRemote ? spec.normalizeRemote(remRaw) : remRaw;
		if (loc !== rem) diff[field] = loc;
	}
	return diff;
}
