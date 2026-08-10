import {
	and,
	asc,
	count,
	desc,
	eq,
	gte,
	inArray,
	isNull,
	like,
	lte,
	ne,
	type SQL,
} from "drizzle-orm";
import { getDb } from "~/db";
import {
	languages,
	submissions,
	submissionTags,
	submissionTracks,
} from "~/db/schema";
import {
	type ApiApp,
	type ApiContext,
	apiStatusSchema,
	type DateRange,
	expandSet,
	notFound,
	parseBody,
	readJsonBody,
	sessionSearchSchema,
	sessionStatusSearchSchema,
	type SortOptions,
} from "./context";
import {
	crudEnvelope,
	offsetOf,
	parsePageParams,
	searchEnvelope,
} from "./pagination";
import {
	type SerializeContext,
	serializeSession,
	serializeSessionStatusRow,
	type SessionWithRelations,
	type UnassignedStyle,
} from "./serializers";

/**
 * Drafts are hidden from the API — never listed, and a draft id resolves 404
 * (flows/09 §2.1, the "Own draft" row). Every session read carries this.
 */
function visibleSessions(eventId: string): SQL[] {
	return [eq(submissions.eventId, eventId), ne(submissions.status, "draft")];
}

function dateConds(
	column: typeof submissions.createdAt | typeof submissions.updatedAt,
	range: DateRange | undefined,
): SQL[] {
	const conds: SQL[] = [];
	if (range?.before) conds.push(lte(column, range.before));
	if (range?.after) conds.push(gte(column, range.after));
	return conds;
}

function orderFor(sort: SortOptions | undefined) {
	const column =
		sort?.order === "updatedAt" ? submissions.updatedAt : submissions.createdAt;
	const dir = sort?.sort === "asc" ? asc : desc;
	return [dir(column), asc(submissions.id)];
}

const sessionInclude = {
	format: true,
	level: true,
	room: true,
	customStatus: true,
	submissionTracks: { with: { track: true } },
	submissionTags: { with: { tag: true } },
	submissionAnswers: { with: { field: true } },
	participants: { with: { contact: true } },
	subsessions: {
		with: {
			format: true,
			level: true,
			room: true,
			customStatus: true,
			submissionTags: { with: { tag: true } },
			participants: { with: { contact: true } },
		},
	},
} as const;

async function serializeContextFor(
	c: ApiContext,
	unassigned: UnassignedStyle,
	subsessionDetails: boolean,
): Promise<SerializeContext> {
	const eventLanguages = await getDb(c.env)
		.select()
		.from(languages)
		.where(eq(languages.eventId, c.get("event").id));
	return {
		origin: new URL(c.req.url).origin,
		unassigned,
		eventLanguages,
		subsessionDetails,
	};
}

async function pageOfSessions(
	c: ApiContext,
	conds: SQL[],
	sort: SortOptions | undefined,
	pageParams: ReturnType<typeof parsePageParams>,
): Promise<{ rows: SessionWithRelations[]; total: number }> {
	const db = getDb(c.env);
	const where = and(...conds);
	const [[total], rows] = await Promise.all([
		db.select({ n: count() }).from(submissions).where(where),
		db.query.submissions.findMany({
			where,
			with: sessionInclude,
			orderBy: orderFor(sort),
			limit: pageParams.pageSize,
			offset: offsetOf(pageParams),
		}),
	]);
	return { rows, total: total?.n ?? 0 };
}

export function registerSessionRoutes(app: ApiApp): void {
	// Search sessions — results + camelCase pagination, unassigned metadata {}.
	app.post("/event/:eventId/sessions", async (c) => {
		const body = parseBody(sessionSearchSchema, await readJsonBody(c));
		const pageParams = parsePageParams(new URL(c.req.url), body);
		const conds = [
			...visibleSessions(c.get("event").id),
			isNull(submissions.parentId),
		];
		conds.push(...dateConds(submissions.createdAt, body.filters?.createdAt));
		conds.push(...dateConds(submissions.updatedAt, body.filters?.updatedAt));
		if (body.filters?.status)
			conds.push(eq(submissions.status, body.filters.status));
		if (body.filters?.isAbstract !== undefined) {
			conds.push(
				eq(submissions.type, body.filters.isAbstract ? "abstract" : "session"),
			);
		}
		const { rows, total } = await pageOfSessions(
			c,
			conds,
			body.sort,
			pageParams,
		);
		const ctx = await serializeContextFor(
			c,
			"empty-object",
			expandSet(c, body.expand).has("subsession_details"),
		);
		return c.json(
			searchEnvelope(
				rows.map((row) => serializeSession(row, ctx)),
				pageParams,
				total,
			),
		);
	});

	// List sessions (CRUD proxy) — data + snake_case pagination, unassigned null.
	app.get("/event/:eventId/sessions", async (c) => {
		const url = new URL(c.req.url);
		const pageParams = parsePageParams(url);
		const conds = [
			...visibleSessions(c.get("event").id),
			isNull(submissions.parentId),
		];
		const isAbstract = url.searchParams.get("is_abstract");
		if (isAbstract === "true") conds.push(eq(submissions.type, "abstract"));
		if (isAbstract === "false") conds.push(eq(submissions.type, "session"));
		const status = url.searchParams.get("status");
		if (status) {
			const parsed = apiStatusSchema.safeParse(status);
			// Spec types this param as a plain string: an unknown status matches
			// nothing rather than erroring (POST search's enum stays strict).
			if (!parsed.success) {
				return c.json(crudEnvelope([], pageParams, 0));
			}
			conds.push(eq(submissions.status, parsed.data));
		}
		const db = getDb(c.env);
		const trackId = url.searchParams.get("track_id");
		if (trackId) {
			conds.push(
				inArray(
					submissions.id,
					db
						.select({ id: submissionTracks.submissionId })
						.from(submissionTracks)
						.where(eq(submissionTracks.trackId, trackId)),
				),
			);
		}
		const tagId = url.searchParams.get("tag_id");
		if (tagId) {
			conds.push(
				inArray(
					submissions.id,
					db
						.select({ id: submissionTags.submissionId })
						.from(submissionTags)
						.where(eq(submissionTags.tagId, tagId)),
				),
			);
		}
		const search = url.searchParams.get("search");
		if (search) conds.push(like(submissions.title, `%${search}%`));
		const { rows, total } = await pageOfSessions(
			c,
			conds,
			undefined,
			pageParams,
		);
		const ctx = await serializeContextFor(
			c,
			"null",
			expandSet(c).has("subsession_details"),
		);
		return c.json(
			crudEnvelope(
				rows.map((row) => serializeSession(row, ctx)),
				pageParams,
				total,
			),
		);
	});

	// Search sessions by status — lightweight rows; subsessions appear both
	// nested and as their own flat rows (documented back-compat behavior).
	app.post("/event/:eventId/sessions/status", async (c) => {
		const body = parseBody(sessionStatusSearchSchema, await readJsonBody(c));
		const pageParams = parsePageParams(new URL(c.req.url), body);
		// Nothing soft-deletes in this app: a deletedAt-bounded filter can never
		// match a row, so it short-circuits to an empty page instead of lying.
		if (body.filters?.deletedAt?.before || body.filters?.deletedAt?.after) {
			return c.json(searchEnvelope([], pageParams, 0));
		}
		const conds = visibleSessions(c.get("event").id);
		conds.push(...dateConds(submissions.createdAt, body.filters?.createdAt));
		conds.push(...dateConds(submissions.updatedAt, body.filters?.updatedAt));
		if (body.filters?.status)
			conds.push(eq(submissions.status, body.filters.status));
		const sort: SortOptions | undefined =
			body.sort?.order === "deletedAt"
				? { order: "createdAt", sort: body.sort.sort }
				: (body.sort as SortOptions | undefined);
		const db = getDb(c.env);
		const where = and(...conds);
		const [[total], rows] = await Promise.all([
			db.select({ n: count() }).from(submissions).where(where),
			db.query.submissions.findMany({
				where,
				with: {
					customStatus: true,
					subsessions: { with: { customStatus: true } },
				},
				orderBy: orderFor(sort),
				limit: pageParams.pageSize,
				offset: offsetOf(pageParams),
			}),
		]);
		return c.json(
			searchEnvelope(
				rows.map(serializeSessionStatusRow),
				pageParams,
				total?.n ?? 0,
			),
		);
	});

	// Get a session — accepts parent and subsession ids alike.
	app.get("/event/:eventId/sessions/:sessionId", async (c) => {
		const db = getDb(c.env);
		const row = await db.query.submissions.findFirst({
			where: and(
				eq(submissions.id, c.req.param("sessionId")),
				...visibleSessions(c.get("event").id),
			),
			with: sessionInclude,
		});
		if (!row) throw notFound("Session");
		const ctx = await serializeContextFor(
			c,
			"empty-object",
			expandSet(c).has("subsession_details"),
		);
		return c.json(serializeSession(row, ctx));
	});
}
