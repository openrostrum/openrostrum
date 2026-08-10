import { and, asc, count, desc, eq, inArray, ne, type SQL } from "drizzle-orm";
import type { z } from "zod";
import { getDb } from "~/db";
import { contacts, participants, submissions } from "~/db/schema";
import { serializeContact } from "~/lib/compat/serializers";
import {
	type ApiApp,
	type ApiContext,
	ApiError,
	dateRangeConds,
	notFound,
	parseBody,
	readJsonBody,
	recordSearchSchema,
	type SortOptions,
} from "./context";
import { offsetOf, parsePageParams, searchEnvelope } from "./pagination";

type RecordSearchBody = z.infer<typeof recordSearchSchema>;

/**
 * Contacts carry no update timestamp. An updatedAt FILTER would silently
 * return wrong-column rows, so it is refused loudly; an updatedAt SORT only
 * reorders and falls back to creation order.
 */
function contactFilterConds(body: RecordSearchBody): SQL[] {
	if (body.filters?.updatedAt) {
		throw new ApiError(
			400,
			"bad_request",
			"Contacts do not track update timestamps; filter by createdAt instead.",
		);
	}
	return dateRangeConds(contacts.createdAt, body.filters?.createdAt);
}

function orderFor(sort: SortOptions | undefined) {
	const dir = sort?.sort === "asc" ? asc : desc;
	return [dir(contacts.createdAt), asc(contacts.id)];
}

/**
 * A speaker is a contact holding a program role (speaker/chairperson/
 * moderator) on a non-draft submission — secondary contacts and roster-only
 * contacts list under /contacts, not /speakers. An optional session-status
 * filter narrows to speakers with a session in that status.
 */
function speakerContactIds(
	c: ApiContext,
	status?: (typeof submissions.status.enumValues)[number],
) {
	const db = getDb(c.env);
	return db
		.select({ id: participants.contactId })
		.from(participants)
		.innerJoin(submissions, eq(participants.submissionId, submissions.id))
		.where(
			and(
				eq(submissions.eventId, c.get("event").id),
				ne(submissions.status, "draft"),
				ne(participants.role, "secondary"),
				status ? eq(submissions.status, status) : undefined,
			),
		);
}

async function contactSearchResponse(
	c: ApiContext,
	body: RecordSearchBody,
	extraConds: SQL[],
) {
	const pageParams = parsePageParams(new URL(c.req.url), body);
	const conds = [
		eq(contacts.eventId, c.get("event").id),
		...extraConds,
		...contactFilterConds(body),
	];
	const db = getDb(c.env);
	const where = and(...conds);
	const [[total], rows] = await Promise.all([
		db.select({ n: count() }).from(contacts).where(where),
		db
			.select()
			.from(contacts)
			.where(where)
			.orderBy(...orderFor(body.sort))
			.limit(pageParams.pageSize)
			.offset(offsetOf(pageParams)),
	]);
	const origin = new URL(c.req.url).origin;
	return c.json(
		searchEnvelope(
			rows.map((row) => serializeContact(row, origin)),
			pageParams,
			total?.n ?? 0,
		),
	);
}

export function registerContactRoutes(app: ApiApp): void {
	app.post("/event/:eventId/speakers", async (c) => {
		const body = parseBody(recordSearchSchema, await readJsonBody(c));
		// `return await` (not bare `return`): adopting the rejected promise a
		// microtask late trips workerd's eager unhandled-rejection detection.
		return await contactSearchResponse(c, body, [
			inArray(contacts.id, speakerContactIds(c, body.filters?.status)),
		]);
	});

	app.get("/event/:eventId/speakers/:contactId", async (c) => {
		const [row] = await getDb(c.env)
			.select()
			.from(contacts)
			.where(
				and(
					eq(contacts.id, c.req.param("contactId")),
					eq(contacts.eventId, c.get("event").id),
					inArray(contacts.id, speakerContactIds(c)),
				),
			)
			.limit(1);
		if (!row) throw notFound("Speaker");
		return c.json(serializeContact(row, new URL(c.req.url).origin));
	});

	app.post("/event/:eventId/contacts", async (c) => {
		const body = parseBody(recordSearchSchema, await readJsonBody(c));
		return await contactSearchResponse(c, body, []);
	});

	app.get("/event/:eventId/contacts/:contactId", async (c) => {
		const [row] = await getDb(c.env)
			.select()
			.from(contacts)
			.where(
				and(
					eq(contacts.id, c.req.param("contactId")),
					eq(contacts.eventId, c.get("event").id),
				),
			)
			.limit(1);
		if (!row) throw notFound("Contact");
		return c.json(serializeContact(row, new URL(c.req.url).origin));
	});
}
