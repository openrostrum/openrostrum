import { asc, count } from "drizzle-orm";
import { getDb } from "~/db";
import { events } from "~/db/schema";
import { apiTokenEventFilter } from "~/lib/api-token";
import type { ApiApp } from "./context";
import { offsetOf, parsePageParams, searchEnvelope } from "./pagination";
import { serializeEvent } from "./serializers";

export function registerEventRoutes(app: ApiApp): void {
	app.get("/events", async (c) => {
		const db = getDb(c.env);
		const scope = apiTokenEventFilter(c.get("principal"));
		const pageParams = parsePageParams(new URL(c.req.url));
		const [[total], rows] = await Promise.all([
			db.select({ n: count() }).from(events).where(scope),
			db
				.select()
				.from(events)
				.where(scope)
				.orderBy(asc(events.createdAt), asc(events.id))
				.limit(pageParams.pageSize)
				.offset(offsetOf(pageParams)),
		]);
		return c.json(
			searchEnvelope(rows.map(serializeEvent), pageParams, total?.n ?? 0),
		);
	});
}
