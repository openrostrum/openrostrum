import { and, asc, count, desc, eq, type SQL } from "drizzle-orm";
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";
import { getDb } from "~/db";
import {
	formats,
	languages,
	levels,
	rooms,
	sessionStatuses,
	tags,
	tracks,
} from "~/db/schema";
import {
	CORE_STATUS_CATALOG,
	serializeCoreStatus,
	serializeCustomStatus,
	serializeFormat,
	serializeLanguage,
	serializeLevel,
	serializeRoom,
	serializeTag,
	serializeTrack,
} from "~/lib/compat/serializers";
import {
	type ApiApp,
	type ApiContext,
	dateRangeConds,
	parseBody,
	readJsonBody,
	type RecordSearchBody,
	recordSearchSchema,
	requireCreatedAtOnly,
} from "./context";
import {
	offsetOf,
	parsePageParams,
	runPaged,
	searchEnvelope,
} from "./pagination";

/**
 * Event Settings lookups mirror the spec's dual shape per catalog: GET returns
 * the bare array in catalog order, POST (search) the paginated `results`
 * envelope honoring RecordSearchBody. `updatedAt` sorts fall back to creation
 * order (no update tracking); a status filter is accepted and ignored.
 */
type LookupSearchSpec<Row> = {
	path: string;
	table: SQLiteTable;
	eventIdColumn: SQLiteColumn;
	createdAtColumn: SQLiteColumn;
	orderBy: (SQLiteColumn | SQL)[];
	serialize: (row: Row) => unknown;
};

function searchConds<Row>(
	c: ApiContext,
	spec: LookupSearchSpec<Row>,
	body: RecordSearchBody,
): SQL | undefined {
	requireCreatedAtOnly(body.filters, "These records");
	return and(
		eq(spec.eventIdColumn, c.get("event").id),
		...dateRangeConds(spec.createdAtColumn, body.filters?.createdAt),
	);
}

function searchOrder<Row>(
	spec: LookupSearchSpec<Row>,
	body: RecordSearchBody,
): (SQLiteColumn | SQL)[] {
	if (!body.sort) return spec.orderBy;
	const dir = body.sort.sort === "asc" ? asc : desc;
	return [dir(spec.createdAtColumn), ...spec.orderBy];
}

/** The POST half of a catalog: paginated `results` envelope over the search body. */
function registerLookupSearch<Row>(
	app: ApiApp,
	spec: LookupSearchSpec<Row>,
): void {
	app.post(`/event/:eventId/${spec.path}`, async (c) => {
		const body = parseBody(recordSearchSchema, await readJsonBody(c));
		const pageParams = parsePageParams(new URL(c.req.url), body);
		const where = searchConds(c, spec, body);
		const db = getDb(c.env);
		const { total, rows } = await runPaged(
			db.select({ n: count() }).from(spec.table).where(where),
			db
				.select()
				.from(spec.table)
				.where(where)
				.orderBy(...searchOrder(spec, body))
				.limit(pageParams.pageSize)
				.offset(offsetOf(pageParams)),
		);
		return c.json(
			searchEnvelope((rows as Row[]).map(spec.serialize), pageParams, total),
		);
	});
}

function registerLookup<Row>(app: ApiApp, spec: LookupSearchSpec<Row>): void {
	app.get(`/event/:eventId/${spec.path}`, async (c) => {
		const rows = (await getDb(c.env)
			.select()
			.from(spec.table)
			.where(eq(spec.eventIdColumn, c.get("event").id))
			.orderBy(...spec.orderBy)) as Row[];
		return c.json(rows.map(spec.serialize));
	});
	registerLookupSearch(app, spec);
}

export function registerLookupRoutes(app: ApiApp): void {
	registerLookup(app, {
		path: "tracks",
		table: tracks,
		eventIdColumn: tracks.eventId,
		createdAtColumn: tracks.createdAt,
		orderBy: [asc(tracks.name), asc(tracks.id)],
		serialize: serializeTrack,
	});
	registerLookup(app, {
		path: "tags",
		table: tags,
		eventIdColumn: tags.eventId,
		createdAtColumn: tags.createdAt,
		orderBy: [asc(tags.name), asc(tags.id)],
		serialize: serializeTag,
	});
	registerLookup(app, {
		path: "formats",
		table: formats,
		eventIdColumn: formats.eventId,
		createdAtColumn: formats.createdAt,
		orderBy: [asc(formats.position), asc(formats.name)],
		serialize: serializeFormat,
	});
	registerLookup(app, {
		path: "levels",
		table: levels,
		eventIdColumn: levels.eventId,
		createdAtColumn: levels.createdAt,
		orderBy: [asc(levels.position), asc(levels.name)],
		serialize: serializeLevel,
	});
	registerLookup(app, {
		path: "rooms",
		table: rooms,
		eventIdColumn: rooms.eventId,
		createdAtColumn: rooms.createdAt,
		orderBy: [asc(rooms.displayOrder), asc(rooms.name)],
		serialize: serializeRoom,
	});
	registerLookup(app, {
		path: "languages",
		table: languages,
		eventIdColumn: languages.eventId,
		createdAtColumn: languages.createdAt,
		orderBy: [asc(languages.position), asc(languages.name)],
		serialize: serializeLanguage,
	});

	// GET /statuses lists every status a response can carry: the core decision
	// pipeline (is_custom: false) plus the event's organizer-created custom
	// statuses (is_custom: true).
	app.get("/event/:eventId/statuses", async (c) => {
		const customs = await getDb(c.env)
			.select()
			.from(sessionStatuses)
			.where(eq(sessionStatuses.eventId, c.get("event").id))
			.orderBy(asc(sessionStatuses.position), asc(sessionStatuses.name));
		return c.json([
			...CORE_STATUS_CATALOG.map(serializeCoreStatus),
			...customs.map(serializeCustomStatus),
		]);
	});

	// POST /session-statuses searches the custom definitions only (spec text:
	// "custom session status definitions"; the spec has no GET at this path —
	// the full catalog lives at GET /statuses above).
	registerLookupSearch(app, {
		path: "session-statuses",
		table: sessionStatuses,
		eventIdColumn: sessionStatuses.eventId,
		createdAtColumn: sessionStatuses.createdAt,
		orderBy: [asc(sessionStatuses.position), asc(sessionStatuses.name)],
		serialize: serializeCustomStatus,
	});
}
