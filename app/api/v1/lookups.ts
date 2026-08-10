import { asc, count, eq, type SQL } from "drizzle-orm";
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
	type ApiApp,
	type ApiContext,
	parseBody,
	readJsonBody,
	recordSearchSchema,
} from "./context";
import { offsetOf, parsePageParams, searchEnvelope } from "./pagination";
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
} from "./serializers";

/**
 * Event Settings lookups, mirroring the spec's dual shape per catalog:
 * GET returns the bare array; POST (search) returns the paginated
 * `results` envelope. Both are event-scoped through the token guard.
 */
type LookupSpec<Row> = {
	path: string;
	table: SQLiteTable;
	eventIdColumn: SQLiteColumn;
	orderBy: (SQLiteColumn | SQL)[];
	serialize: (row: Row) => unknown;
};

function registerLookup<Row>(app: ApiApp, spec: LookupSpec<Row>): void {
	const fetchAll = async (c: ApiContext): Promise<Row[]> =>
		(await getDb(c.env)
			.select()
			.from(spec.table)
			.where(eq(spec.eventIdColumn, c.get("event").id))
			.orderBy(...spec.orderBy)) as Row[];

	app.get(`/event/:eventId/${spec.path}`, async (c) => {
		const rows = await fetchAll(c);
		return c.json(rows.map(spec.serialize));
	});

	app.post(`/event/:eventId/${spec.path}`, async (c) => {
		parseBody(recordSearchSchema, await readJsonBody(c));
		const pageParams = parsePageParams(new URL(c.req.url));
		const db = getDb(c.env);
		const where = eq(spec.eventIdColumn, c.get("event").id);
		const [[total], rows] = await Promise.all([
			db.select({ n: count() }).from(spec.table).where(where),
			db
				.select()
				.from(spec.table)
				.where(where)
				.orderBy(...spec.orderBy)
				.limit(pageParams.pageSize)
				.offset(offsetOf(pageParams)),
		]);
		return c.json(
			searchEnvelope(
				(rows as Row[]).map(spec.serialize),
				pageParams,
				total?.n ?? 0,
			),
		);
	});
}

export function registerLookupRoutes(app: ApiApp): void {
	registerLookup(app, {
		path: "tracks",
		table: tracks,
		eventIdColumn: tracks.eventId,
		orderBy: [asc(tracks.name), asc(tracks.id)],
		serialize: serializeTrack,
	});
	registerLookup(app, {
		path: "tags",
		table: tags,
		eventIdColumn: tags.eventId,
		orderBy: [asc(tags.name), asc(tags.id)],
		serialize: serializeTag,
	});
	registerLookup(app, {
		path: "formats",
		table: formats,
		eventIdColumn: formats.eventId,
		orderBy: [asc(formats.position), asc(formats.name)],
		serialize: serializeFormat,
	});
	registerLookup(app, {
		path: "levels",
		table: levels,
		eventIdColumn: levels.eventId,
		orderBy: [asc(levels.position), asc(levels.name)],
		serialize: serializeLevel,
	});
	registerLookup(app, {
		path: "rooms",
		table: rooms,
		eventIdColumn: rooms.eventId,
		orderBy: [asc(rooms.displayOrder), asc(rooms.name)],
		serialize: serializeRoom,
	});
	registerLookup(app, {
		path: "languages",
		table: languages,
		eventIdColumn: languages.eventId,
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
	// "custom session status definitions").
	app.post("/event/:eventId/session-statuses", async (c) => {
		parseBody(recordSearchSchema, await readJsonBody(c));
		const pageParams = parsePageParams(new URL(c.req.url));
		const db = getDb(c.env);
		const where = eq(sessionStatuses.eventId, c.get("event").id);
		const [[total], rows] = await Promise.all([
			db.select({ n: count() }).from(sessionStatuses).where(where),
			db
				.select()
				.from(sessionStatuses)
				.where(where)
				.orderBy(asc(sessionStatuses.position), asc(sessionStatuses.name))
				.limit(pageParams.pageSize)
				.offset(offsetOf(pageParams)),
		]);
		return c.json(
			searchEnvelope(
				rows.map(serializeCustomStatus),
				pageParams,
				total?.n ?? 0,
			),
		);
	});
}
