import { and, eq, inArray, lt } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { z } from "zod";
import { type Db, getDb } from "~/db";
import { DECISION_STATUS } from "~/db/constants";
import {
	airtableLinks,
	contacts,
	events,
	type Submission,
	submissions,
	taskAssignments,
	tasks,
} from "~/db/schema";
import { transitionSubmissions, withdrawSubmission } from "~/domain/accept";
import {
	applyDescriptivePull,
	parseSubmissionStatus,
	parseTaskStatus,
	projectContact,
	projectSubmission,
	projectTaskAssignment,
	SYNCED_TABLES,
	type SyncedTableName,
	TABLE_MAPS,
	type TableMap,
} from "~/lib/airtable-map";
import { errorMessage } from "~/lib/errors";
import { track } from "~/lib/track";
import {
	type AirtableBase,
	type AirtableFields,
	getAirtableBase,
	MERGE_FIELD,
	recordKey,
} from "~/ports/airtable";
import {
	diffFields,
	type LinkState,
	type LocalProjection,
	planTableSync,
	type TablePlan,
} from "./engine";

/**
 * Background-only sync: pull → merge → push. The env base is bound to the
 * Demo organization — every row selection filters
 * `events.organizationId = 'org_demo'`, so no other tenant's rows can reach
 * the base or take edits.
 */
export const DEMO_ORG_ID = "org_demo";

export type SyncTrigger = "cron" | "webhook" | "manual";

export interface SyncRunOptions {
	trigger: SyncTrigger;
	/**
	 * Set by the admin "Resume" action after a circuit-breaker pause: applies
	 * the pending remote deletions this one run and clears the pause. Honored
	 * ONLY while the state is actually paused — a stale or replayed resume
	 * POST must never disable the breaker for a normal run.
	 */
	acknowledgeDeletions?: boolean;
}

export interface SyncDeps {
	base?: AirtableBase;
}

export interface TableRunStats {
	created: number;
	pushed: number;
	pulled: number;
	conflicts: number;
	rejected: number;
	archived: number;
	deletedRemote: number;
	unlinked: number;
	refusedLinks: number;
	orphans: number;
}

export type SyncRunResult =
	| { status: "not_configured" }
	| { status: "paused" }
	| { status: "already_running" }
	| { status: "breaker_tripped"; absent: number; linked: number }
	| { status: "failed"; error: string }
	| { status: "ok"; tables: Record<SyncedTableName, TableRunStats> };

type DecisionTarget = (typeof DECISION_STATUS)[number];

// Reserved tableName='$sync' rows survive across ticks/isolates; every
// reconciliation select filters tableName to SYNCED_TABLES, so these rows never
// enter a plan.
const STATE_TABLE = "$sync";
const STATE_RECORD = "state";
const LOCK_RECORD = "lock";
// The webhook high-water mark gets its OWN row: its writer (the route) does not
// hold the run lock, so it must never share a blob with the runner's state.
const WEBHOOK_RECORD = "webhook";
// A tick is seconds of wall time; a lock this old belongs to a crashed run.
const LOCK_TTL_MS = 5 * 60_000;

export interface ConflictEntry {
	at: string;
	table: string;
	recordId: string;
	field: string;
}

export interface SyncState {
	pausedAt?: string;
	pausedReason?: string;
	lastRunAt?: string;
	lastRunTrigger?: string;
	lastRunStatus?: "ok" | "failed" | "breaker_tripped";
	lastRunTables?: Record<string, TableRunStats>;
	lastError?: string;
	/** The in-app audit trail for "Airtable won this conflict" (capped). */
	recentConflicts?: ConflictEntry[];
}

const MAX_RECENT_CONFLICTS = 50;

/** The webhook state row's snapshot is stored JSON, so reading it is a parse:
 * anything but a recorded timestamp means "no ping seen yet". */
const WebhookState = z.object({ lastWebhookAt: z.string() });

export async function readSyncState(db: Db): Promise<SyncState> {
	const [row] = await db
		.select({ snapshot: airtableLinks.baseSnapshot })
		.from(airtableLinks)
		.where(
			and(
				eq(airtableLinks.tableName, STATE_TABLE),
				eq(airtableLinks.recordId, STATE_RECORD),
			),
		)
		.limit(1);
	return (row?.snapshot as SyncState | null) ?? {};
}

async function upsertStateRow(
	db: Db,
	recordId: string,
	snapshot: Record<string, unknown>,
): Promise<void> {
	await db
		.insert(airtableLinks)
		.values({
			tableName: STATE_TABLE,
			recordId,
			airtableId: `${STATE_TABLE}:${recordId}`,
			baseSnapshot: snapshot,
			syncedAt: new Date(),
		})
		.onConflictDoUpdate({
			target: [airtableLinks.tableName, airtableLinks.recordId],
			set: { baseSnapshot: snapshot, syncedAt: new Date() },
		});
}

export async function writeSyncState(db: Db, state: SyncState): Promise<void> {
	await upsertStateRow(db, STATE_RECORD, state as Record<string, unknown>);
}

export async function readLastWebhookPing(db: Db): Promise<string | null> {
	const [row] = await db
		.select({ snapshot: airtableLinks.baseSnapshot })
		.from(airtableLinks)
		.where(
			and(
				eq(airtableLinks.tableName, STATE_TABLE),
				eq(airtableLinks.recordId, WEBHOOK_RECORD),
			),
		)
		.limit(1);
	return WebhookState.safeParse(row?.snapshot).data?.lastWebhookAt ?? null;
}

/**
 * Record a ping's timestamp; a timestamp not newer than the stored
 * high-water mark is an at-least-once replay (reported, never regressed).
 */
export async function recordWebhookPing(
	db: Db,
	timestamp: string | undefined,
): Promise<{ replayed: boolean }> {
	if (!timestamp) return { replayed: false };
	const last = await readLastWebhookPing(db);
	if (last && timestamp <= last) return { replayed: true };
	await upsertStateRow(db, WEBHOOK_RECORD, { lastWebhookAt: timestamp });
	return { replayed: false };
}

/**
 * At-most-one tick at a time — overlapping triggers would double-apply plans
 * computed from the same stale reads. The insert is atomic on the
 * (tableName, recordId) unique index; a crashed run's lock is stolen after
 * its TTL.
 */
async function acquireRunLock(db: Db, now: Date): Promise<boolean> {
	await db
		.delete(airtableLinks)
		.where(
			and(
				eq(airtableLinks.tableName, STATE_TABLE),
				eq(airtableLinks.recordId, LOCK_RECORD),
				lt(airtableLinks.syncedAt, new Date(now.getTime() - LOCK_TTL_MS)),
			),
		);
	const inserted = await db
		.insert(airtableLinks)
		.values({
			tableName: STATE_TABLE,
			recordId: LOCK_RECORD,
			airtableId: `${STATE_TABLE}:${LOCK_RECORD}`,
			syncedAt: now,
		})
		.onConflictDoNothing({
			target: [airtableLinks.tableName, airtableLinks.recordId],
		})
		.returning({ id: airtableLinks.id });
	return inserted.length > 0;
}

async function releaseRunLock(db: Db): Promise<void> {
	await db
		.delete(airtableLinks)
		.where(
			and(
				eq(airtableLinks.tableName, STATE_TABLE),
				eq(airtableLinks.recordId, LOCK_RECORD),
			),
		);
}

// Snapshot marker for a link whose base row the team deleted: the local row was
// archived (or has no archive state) and must NOT be re-pushed — the delete is
// honored, recreation is the zombie-row failure mode. Cleared when the row is
// restored from Airtable's trash (snapshots rebuild from the live projection).
const REMOTE_DELETED_MARKER = "$remoteDeleted";
// >20% of linked rows absent in one tick = a probable select-all accident:
// pause and alert instead of mass-archiving.
const BREAKER_THRESHOLD = 0.2;

interface LoadedTable {
	projections: LocalProjection[];
	/** Raw rows, needed by the workflow appliers. */
	submissionRows: Map<string, Submission>;
	assignmentRows: Map<string, typeof taskAssignments.$inferSelect>;
}

async function loadTable(
	db: Db,
	table: SyncedTableName,
	eventIds: string[],
	ids?: string[],
): Promise<LoadedTable> {
	const empty: LoadedTable = {
		projections: [],
		submissionRows: new Map(),
		assignmentRows: new Map(),
	};
	if (eventIds.length === 0 || ids?.length === 0) return empty;

	if (table === "submissions") {
		const rows = await db.query.submissions.findMany({
			where: (s, { and: andOp, inArray: inOp }) =>
				andOp(inOp(s.eventId, eventIds), ids ? inOp(s.id, ids) : undefined),
			with: {
				participants: { with: { contact: true } },
				submissionTracks: { with: { track: true } },
				format: true,
				room: true,
			},
		});
		const projections: LocalProjection[] = [];
		const submissionRows = new Map<string, Submission>();
		for (const row of rows) {
			const speakers = row.participants
				.filter((p) => p.role === "speaker")
				.sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
				.map((p) => p.contact);
			const trackNames = row.submissionTracks
				.map((st) => st.track.name)
				.sort((a, b) => a.localeCompare(b));
			projections.push({
				recordId: row.id,
				fields: projectSubmission({
					submission: row,
					speakers,
					trackNames,
					formatName: row.format?.name ?? null,
					roomName: row.room?.name ?? null,
				}),
			});
			submissionRows.set(row.id, row);
		}
		return { ...empty, projections, submissionRows };
	}

	if (table === "contacts") {
		const rows = await db.query.contacts.findMany({
			where: (c, { and: andOp, inArray: inOp }) =>
				andOp(inOp(c.eventId, eventIds), ids ? inOp(c.id, ids) : undefined),
		});
		return {
			...empty,
			projections: rows.map((c) => ({
				recordId: c.id,
				fields: projectContact(c),
			})),
		};
	}

	const rows = await db
		.select({
			assignment: taskAssignments,
			taskName: tasks.name,
			contact: contacts,
			submission: submissions,
		})
		.from(taskAssignments)
		.innerJoin(tasks, eq(tasks.id, taskAssignments.taskId))
		.leftJoin(contacts, eq(contacts.id, taskAssignments.contactId))
		.leftJoin(submissions, eq(submissions.id, taskAssignments.submissionId))
		.where(
			and(
				inArray(tasks.eventId, eventIds),
				ids ? inArray(taskAssignments.id, ids) : undefined,
			),
		);
	const projections: LocalProjection[] = [];
	const assignmentRows = new Map<string, typeof taskAssignments.$inferSelect>();
	for (const row of rows) {
		projections.push({
			recordId: row.assignment.id,
			fields: projectTaskAssignment({
				assignment: row.assignment,
				task: { name: row.taskName },
				contact: row.contact,
				submission: row.submission,
			}),
		});
		assignmentRows.set(row.assignment.id, row.assignment);
	}
	return { ...empty, projections, assignmentRows };
}

const D1_TABLES = {
	submissions,
	contacts,
	task_assignments: taskAssignments,
} as const;

/**
 * A link may only bind to a Demo-org row. A link whose record exists but sits
 * outside the org-filtered set is refused — excluded from reconciliation
 * entirely (no pull applies to it, and its absence from the filtered set must
 * never read as "deleted") — and tracked.
 */
async function splitRefusedLinks(
	db: Db,
	table: SyncedTableName,
	links: LinkState[],
	localIds: Set<string>,
): Promise<{ usable: LinkState[]; refused: number }> {
	const missing = links.filter((l) => !localIds.has(l.recordId));
	if (missing.length === 0) return { usable: links, refused: 0 };
	const d1Table = D1_TABLES[table];
	const rows = await db
		.select({ id: d1Table.id })
		.from(d1Table)
		.where(
			inArray(
				d1Table.id,
				missing.map((l) => l.recordId),
			),
		);
	const outsideOrg = new Set(rows.map((r) => r.id));
	if (outsideOrg.size === 0) return { usable: links, refused: 0 };
	for (const link of missing) {
		if (outsideOrg.has(link.recordId)) {
			track("sync.link_refused", { table, recordId: link.recordId });
		}
	}
	return {
		usable: links.filter((l) => !outsideOrg.has(l.recordId)),
		refused: outsideOrg.size,
	};
}

export async function runAirtableSync(
	env: Env,
	opts: SyncRunOptions,
	deps: SyncDeps = {},
): Promise<SyncRunResult> {
	const db = getDb(env);
	const base = deps.base ?? getAirtableBase(env);
	const { trigger } = opts;
	if (!base) {
		track("sync.skipped", { reason: "not_configured", trigger });
		return { status: "not_configured" };
	}
	const now = new Date();
	if (!(await acquireRunLock(db, now))) {
		track("sync.skipped", { reason: "already_running", trigger });
		return { status: "already_running" };
	}
	try {
		// The lock is exclusive over the state row's writers, so this read
		// stays authoritative for the whole run.
		const state = await readSyncState(db);
		// The server-side resume gate: acknowledgement only means something
		// while a pause is actually in force.
		const acknowledge = Boolean(opts.acknowledgeDeletions && state.pausedAt);
		if (state.pausedAt && !acknowledge) {
			track("sync.skipped", { reason: "paused", trigger });
			return { status: "paused" };
		}
		try {
			return await reconcileAll(
				db,
				base,
				env,
				opts.trigger,
				acknowledge,
				state,
				now,
			);
		} catch (error) {
			const message = errorMessage(error);
			track("sync.run_failed", { trigger, error: message });
			await writeSyncState(db, {
				...state,
				lastRunAt: now.toISOString(),
				lastRunTrigger: trigger,
				lastRunStatus: "failed",
				lastError: message,
			});
			return { status: "failed", error: message };
		}
	} finally {
		await releaseRunLock(db);
	}
}

interface TableWork {
	table: SyncedTableName;
	map: TableMap;
	plan: TablePlan;
	loaded: LoadedTable;
	remoteFieldsById: Map<string, AirtableFields>;
	/** Archive candidates not yet processed on a previous tick. */
	newArchives: Array<{ recordId: string; airtableId: string }>;
	/**
	 * Links marked remote-deleted whose base row came back (restored from
	 * Airtable's trash): the marker must clear, or a second team-side delete
	 * would never be honored.
	 */
	resurfaced: string[];
	refused: number;
}

async function reconcileAll(
	db: Db,
	base: AirtableBase,
	env: Env,
	trigger: SyncTrigger,
	acknowledgeDeletions: boolean,
	state: SyncState,
	now: Date,
): Promise<SyncRunResult> {
	const demoEvents = await db
		.select({ id: events.id })
		.from(events)
		.where(eq(events.organizationId, DEMO_ORG_ID));
	const eventIds = demoEvents.map((e) => e.id);

	const allLinks = await db
		.select()
		.from(airtableLinks)
		.where(inArray(airtableLinks.tableName, [...SYNCED_TABLES]));

	// PLAN phase — reads only, so the circuit breaker can veto the whole run
	// before a single write happens anywhere.
	const work: TableWork[] = [];
	for (const table of SYNCED_TABLES) {
		const map = TABLE_MAPS[table];
		const loaded = await loadTable(db, table, eventIds);
		const localIds = new Set(loaded.projections.map((p) => p.recordId));
		const tableLinks: LinkState[] = allLinks
			.filter((l) => l.tableName === table)
			.map((l) => ({
				recordId: l.recordId,
				airtableId: l.airtableId,
				snapshot: (l.baseSnapshot as AirtableFields | null) ?? null,
			}));
		const { usable, refused } = await splitRefusedLinks(
			db,
			table,
			tableLinks,
			localIds,
		);
		const remotes = await base.list(map.airtableTable, [
			MERGE_FIELD,
			...Object.keys(map.fields),
		]);
		const plan = planTableSync(map, loaded.projections, usable, remotes);
		const links = new Map(usable.map((l) => [l.recordId, l]));
		const newArchives = plan.archives.filter((a) => {
			const link = links.get(a.recordId);
			if (link?.snapshot?.[REMOTE_DELETED_MARKER]) return false;
			// A crash between the archive write and its snapshot marker must not
			// re-count the same deletion against the breaker.
			return loaded.submissionRows.get(a.recordId)?.status !== "withdrawn";
		});
		// One keyed view of the remotes — a record with no usable merge key is
		// not something this mirror tracks, for either reader below.
		const keyed = remotes.flatMap((r) => {
			const key = recordKey(r);
			return key === null ? [] : [[key, r.fields] as const];
		});
		const remoteRecordIds = new Set(keyed.map(([key]) => key));
		const resurfaced = usable
			.filter(
				(l) =>
					l.snapshot?.[REMOTE_DELETED_MARKER] &&
					remoteRecordIds.has(l.recordId) &&
					localIds.has(l.recordId),
			)
			.map((l) => l.recordId);
		work.push({
			table,
			map,
			plan,
			loaded,
			remoteFieldsById: new Map(keyed),
			newArchives,
			resurfaced,
			refused,
		});
	}

	// Circuit breaker — PER TABLE, over the org-filtered linked set only: the
	// select-all accident it guards against happens in one table's view, and a
	// large contacts table must not dilute a wiped-out sessions table below
	// the threshold.
	const tripped = work.filter(
		(w) =>
			w.plan.linkedPresent > 0 &&
			w.newArchives.length / w.plan.linkedPresent > BREAKER_THRESHOLD,
	);
	if (!acknowledgeDeletions && tripped.length > 0) {
		const absent = tripped.reduce((n, w) => n + w.newArchives.length, 0);
		const linked = tripped.reduce((n, w) => n + w.plan.linkedPresent, 0);
		const detail = tripped
			.map(
				(w) =>
					`${w.newArchives.length} of ${w.plan.linkedPresent} ${w.map.airtableTable}`,
			)
			.join(", ");
		for (const w of tripped) {
			track("sync.breaker_tripped", {
				table: w.table,
				absent: w.newArchives.length,
				linked: w.plan.linkedPresent,
				trigger,
			});
		}
		await writeSyncState(db, {
			...state,
			pausedAt: now.toISOString(),
			pausedReason: `${detail} synced rows were deleted in Airtable in one pass. Sync is paused so an accidental mass-delete can't archive them all — review the base, then resume to apply the deletions.`,
			lastRunAt: now.toISOString(),
			lastRunTrigger: trigger,
			lastRunStatus: "breaker_tripped",
		});
		return { status: "breaker_tripped", absent, linked };
	}

	const tables = {} as Record<SyncedTableName, TableRunStats>;
	const conflicts: ConflictEntry[] = [];
	for (const w of work) {
		tables[w.table] = await applyTable(
			db,
			base,
			w,
			eventIds,
			now,
			trigger,
			conflicts,
		);
	}

	// The poll keeps the webhook alive: Airtable expires webhooks after 7 days
	// unless refreshed. Re-REGISTRATION (which mints a new MAC secret, a
	// deploy-time secret this Worker cannot set) stays a provisioning task.
	if (trigger === "cron" && env.AIRTABLE_WEBHOOK_ID) {
		try {
			await base.refreshWebhook(env.AIRTABLE_WEBHOOK_ID);
			track("sync.webhook_refreshed", { webhookId: env.AIRTABLE_WEBHOOK_ID });
		} catch (error) {
			track("sync.webhook_refresh_failed", {
				webhookId: env.AIRTABLE_WEBHOOK_ID,
				error: errorMessage(error),
			});
		}
	}

	if (acknowledgeDeletions) track("sync.resumed", { trigger });
	await writeSyncState(db, {
		...state,
		...(acknowledgeDeletions
			? { pausedAt: undefined, pausedReason: undefined }
			: {}),
		lastRunAt: now.toISOString(),
		lastRunTrigger: trigger,
		lastRunStatus: "ok",
		lastRunTables: tables,
		lastError: undefined,
		recentConflicts: [...conflicts, ...(state.recentConflicts ?? [])].slice(
			0,
			MAX_RECENT_CONFLICTS,
		),
	});
	return { status: "ok", tables };
}

async function applyTable(
	db: Db,
	base: AirtableBase,
	w: TableWork,
	eventIds: string[],
	now: Date,
	trigger: SyncTrigger,
	conflicts: ConflictEntry[],
): Promise<TableRunStats> {
	const { table, map, plan, loaded } = w;
	const stats: TableRunStats = {
		created: 0,
		pushed: 0,
		pulled: 0,
		conflicts: 0,
		rejected: 0,
		archived: 0,
		deletedRemote: 0,
		unlinked: 0,
		refusedLinks: w.refused,
		orphans: plan.orphanCount,
	};

	// --- local (D1) writes: descriptive pulls and task-status workflow go in
	// one batch; submission workflow edits run through the domain functions.
	const statements: BatchItem<"sqlite">[] = [];
	const decisionRequests: Array<{ row: Submission; to: DecisionTarget }> = [];
	const withdrawRequests: Array<{ row: Submission; reason: string }> = [];
	const afterCommit: Array<() => void> = [];

	const reject = (recordId: string, field: string, reason: string) => {
		stats.rejected += 1;
		afterCommit.push(() =>
			track("sync.pull_rejected", { table, recordId, field, reason }),
		);
	};

	for (const pull of plan.pulls) {
		const sets: Record<string, unknown> = {};
		for (const change of pull.changes) {
			if (change.conflict) {
				stats.conflicts += 1;
				conflicts.push({
					at: now.toISOString(),
					table,
					recordId: pull.recordId,
					field: change.field,
				});
				afterCommit.push(() =>
					track("sync.conflict_resolved", {
						table,
						recordId: pull.recordId,
						field: change.field,
					}),
				);
			}
			if (change.fieldClass === "descriptive") {
				const outcome = applyDescriptivePull(table, change.field, change.value);
				if (outcome.ok) Object.assign(sets, outcome.set);
				else reject(pull.recordId, change.field, outcome.reason);
				continue;
			}
			// Workflow field (Status).
			if (table === "submissions") {
				const row = loaded.submissionRows.get(pull.recordId);
				const to = row ? parseSubmissionStatus(change.value) : null;
				if (!row || !to || to === "draft") {
					reject(pull.recordId, change.field, "not an applicable status");
				} else if (to === "withdrawn") {
					withdrawRequests.push({ row, reason: "Withdrawn in Airtable" });
				} else {
					decisionRequests.push({ row, to });
				}
			} else if (table === "task_assignments") {
				const row = loaded.assignmentRows.get(pull.recordId);
				const to = row ? parseTaskStatus(change.value) : null;
				if (!row || !to) {
					reject(pull.recordId, change.field, "not a task status");
				} else {
					Object.assign(sets, {
						status: to,
						completedAt: to === "complete" ? (row.completedAt ?? now) : null,
					});
				}
			} else {
				reject(pull.recordId, change.field, "field has no workflow applier");
			}
		}
		if (Object.keys(sets).length > 0) {
			stats.pulled += 1;
			const d1Table = D1_TABLES[table];
			statements.push(
				db.update(d1Table).set(sets).where(eq(d1Table.id, pull.recordId)),
			);
		}
	}

	if (statements.length > 0) {
		await db.batch(
			statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]],
		);
	}
	for (const emit of afterCommit) emit();

	// Inbound "Withdrawn" edits and honored remote deletions both go through
	// the shared withdraw domain function — the sync engine carries no
	// withdraw rules of its own.
	for (const request of withdrawRequests) {
		const result = await withdrawSubmission(db, {
			submission: request.row,
			byUserId: null,
			reason: request.reason,
		});
		if (result.ok) {
			stats.pulled += 1;
		} else {
			stats.rejected += 1;
			track("sync.pull_rejected", {
				table,
				recordId: request.row.id,
				field: "Status",
				reason: result.reason ?? "withdrawal refused",
			});
		}
	}

	for (const archive of w.newArchives) {
		stats.archived += 1;
		const row = loaded.submissionRows.get(archive.recordId);
		if (table === "submissions" && row) {
			const result = await withdrawSubmission(db, {
				submission: row,
				byUserId: null,
				reason: "Deleted from the Airtable base",
			});
			if (result.ok) {
				track("sync.remote_delete_archived", {
					table,
					recordId: archive.recordId,
					eventId: row.eventId,
				});
				continue;
			}
		}
		// No archive state applies (contacts, task assignments, drafts): the
		// row stays in the app, stops mirroring, and is never recreated in the
		// base — the marker written below is what stops the re-push.
		track("sync.remote_delete_marked", { table, recordId: archive.recordId });
	}

	// Inbound decision edits go through the shared accept spine — the same
	// transition + auto-provisioning path the admin UI uses (rows arrive here
	// already Demo-org-filtered, matching the spine's caller contract).
	if (decisionRequests.length > 0) {
		const byTarget = new Map<DecisionTarget, Submission[]>();
		for (const req of decisionRequests) {
			byTarget.set(req.to, [...(byTarget.get(req.to) ?? []), req.row]);
		}
		for (const [to, rows] of byTarget) {
			const outcomes = await transitionSubmissions(db, rows, to);
			for (const outcome of outcomes) {
				if (outcome.ok) {
					stats.pulled += 1;
				} else {
					stats.rejected += 1;
					track("sync.pull_rejected", {
						table,
						recordId: outcome.submissionId,
						field: "Status",
						reason: outcome.reason ?? "transition refused",
					});
				}
			}
		}
	}

	// --- re-project rows the local phase touched, so pushes and snapshots
	// reflect the final state (a rejected pull writes the app's value back
	// simply by still differing from the base here).
	const touchedIds = [
		...new Set([
			...plan.pulls.map((p) => p.recordId),
			...w.newArchives.map((a) => a.recordId),
		]),
	];
	const reProjected = new Map<string, AirtableFields>();
	if (touchedIds.length > 0) {
		const reloaded = await loadTable(db, table, eventIds, touchedIds);
		for (const p of reloaded.projections) reProjected.set(p.recordId, p.fields);
	}
	const localFields = new Map(
		loaded.projections.map((p) => [p.recordId, p.fields]),
	);
	const finalFields = (recordId: string): AirtableFields | undefined =>
		reProjected.get(recordId) ?? localFields.get(recordId);

	// --- Airtable writes. If any fail, snapshots below never advance and the
	// next tick redoes exactly the missing work (upserts merge on Record ID,
	// so retries can't duplicate rows).
	const createdIds = new Map<string, string>();
	if (plan.creates.length > 0) {
		const created = await base.batchUpsert(
			map.airtableTable,
			plan.creates.map((c) => ({
				fields: { [MERGE_FIELD]: c.recordId, ...c.fields },
			})),
		);
		for (const record of created) {
			const key = recordKey(record);
			if (key) createdIds.set(key, record.airtableId);
		}
		stats.created = plan.creates.length;
	}

	const pushTargets = new Map<string, string>(); // recordId → airtableId
	for (const push of plan.pushes)
		pushTargets.set(push.recordId, push.airtableId);
	for (const pull of plan.pulls)
		pushTargets.set(pull.recordId, pull.airtableId);
	for (const adoption of plan.adoptions)
		pushTargets.set(adoption.recordId, adoption.airtableId);

	const upserts: Array<{ fields: AirtableFields }> = [];
	const pushedRecordIds: string[] = [];
	for (const [recordId] of pushTargets) {
		const fields = finalFields(recordId);
		const remote = w.remoteFieldsById.get(recordId);
		if (!fields || !remote) continue;
		const changed = diffFields(map, fields, remote);
		if (Object.keys(changed).length === 0) continue;
		upserts.push({ fields: { [MERGE_FIELD]: recordId, ...changed } });
		pushedRecordIds.push(recordId);
	}
	if (upserts.length > 0) {
		await base.batchUpsert(map.airtableTable, upserts);
		stats.pushed = upserts.length;
	}

	if (plan.remoteDeletes.length > 0) {
		await base.batchDelete(
			map.airtableTable,
			plan.remoteDeletes.map((d) => d.airtableId),
		);
		stats.deletedRemote = plan.remoteDeletes.length;
		for (const d of plan.remoteDeletes) {
			track("sync.pushed_delete", { table, recordId: d.recordId });
		}
	}

	// --- link/snapshot writes, only now that both sides confirmed.
	const linkStatements: BatchItem<"sqlite">[] = [];
	const snapshotFor = (recordId: string): Record<string, unknown> =>
		({ ...(finalFields(recordId) ?? {}) }) as Record<string, unknown>;

	for (const create of plan.creates) {
		const airtableId = createdIds.get(create.recordId);
		if (!airtableId) continue;
		linkStatements.push(
			db
				.insert(airtableLinks)
				.values({
					tableName: table,
					recordId: create.recordId,
					airtableId,
					baseSnapshot: snapshotFor(create.recordId),
					syncedAt: now,
				})
				.onConflictDoUpdate({
					target: [airtableLinks.tableName, airtableLinks.recordId],
					set: {
						airtableId,
						baseSnapshot: snapshotFor(create.recordId),
						syncedAt: now,
					},
				}),
		);
	}
	for (const adoption of plan.adoptions) {
		linkStatements.push(
			db
				.insert(airtableLinks)
				.values({
					tableName: table,
					recordId: adoption.recordId,
					airtableId: adoption.airtableId,
					baseSnapshot: snapshotFor(adoption.recordId),
					syncedAt: now,
				})
				.onConflictDoUpdate({
					target: [airtableLinks.tableName, airtableLinks.recordId],
					set: {
						airtableId: adoption.airtableId,
						baseSnapshot: snapshotFor(adoption.recordId),
						syncedAt: now,
					},
				}),
		);
	}
	const snapshotUpdateIds = new Set<string>([
		...pushedRecordIds,
		...plan.pulls.map((p) => p.recordId),
		...plan.snapshotRefreshes,
		...w.resurfaced,
	]);
	for (const adoption of plan.adoptions)
		snapshotUpdateIds.delete(adoption.recordId);
	for (const recordId of snapshotUpdateIds) {
		if (!localFields.has(recordId)) continue;
		linkStatements.push(
			db
				.update(airtableLinks)
				.set({ baseSnapshot: snapshotFor(recordId), syncedAt: now })
				.where(
					and(
						eq(airtableLinks.tableName, table),
						eq(airtableLinks.recordId, recordId),
					),
				),
		);
	}
	for (const archive of w.newArchives) {
		linkStatements.push(
			db
				.update(airtableLinks)
				.set({
					baseSnapshot: {
						...snapshotFor(archive.recordId),
						[REMOTE_DELETED_MARKER]: true,
					},
					syncedAt: now,
				})
				.where(
					and(
						eq(airtableLinks.tableName, table),
						eq(airtableLinks.recordId, archive.recordId),
					),
				),
		);
	}
	const staleLinks = [
		...plan.remoteDeletes.map((d) => d.recordId),
		...plan.unlinks,
	];
	if (staleLinks.length > 0) {
		stats.unlinked = plan.unlinks.length;
		linkStatements.push(
			db
				.delete(airtableLinks)
				.where(
					and(
						eq(airtableLinks.tableName, table),
						inArray(airtableLinks.recordId, staleLinks),
					),
				),
		);
	}
	if (linkStatements.length > 0) {
		await db.batch(
			linkStatements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]],
		);
	}

	track("sync.reconciled", { table, trigger, ...stats });
	return stats;
}
