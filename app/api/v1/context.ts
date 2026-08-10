import { gte, lte, type SQL } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import type { Context, Hono } from "hono";
import { z } from "zod";
import type { events } from "~/db/schema";
import type { ApiTokenPrincipal } from "~/lib/api-token";

export type ApiHonoEnv = {
	Bindings: Env;
	Variables: {
		principal: ApiTokenPrincipal;
		event: typeof events.$inferSelect;
	};
};

export type ApiApp = Hono<ApiHonoEnv>;
export type ApiContext = Context<ApiHonoEnv>;

/** Sessionboard's error body: `{"error": "...", "message": "..."}`. */
export class ApiError extends Error {
	constructor(
		public status: 400 | 401 | 404 | 405,
		public code: string,
		message: string,
	) {
		super(message);
	}
}

export const notFound = (what: string) =>
	new ApiError(404, "not_found", `${what} not found`);

/**
 * Read an optional JSON body. Absent/empty body → undefined (search bodies
 * are optional in the spec); malformed JSON → 400.
 */
export async function readJsonBody(c: ApiContext): Promise<unknown> {
	const text = await c.req.text();
	if (!text.trim()) return undefined;
	try {
		return JSON.parse(text);
	} catch {
		throw new ApiError(400, "bad_request", "Request body is not valid JSON");
	}
}

export function parseBody<T>(schema: z.ZodType<T>, value: unknown): T {
	const parsed = schema.safeParse(value ?? {});
	if (!parsed.success) {
		throw new ApiError(400, "bad_request", z.prettifyError(parsed.error));
	}
	return parsed.data;
}

/* --------------------------------------------- shared search-body schemas --- */

export const dateRangeSchema = z.object({
	before: z.coerce.date().optional(),
	after: z.coerce.date().optional(),
});
export type DateRange = z.infer<typeof dateRangeSchema>;

/** before/after bounds → SQL conditions on the given timestamp column. */
export function dateRangeConds(
	column: AnySQLiteColumn,
	range: DateRange | undefined,
): SQL[] {
	const conds: SQL[] = [];
	if (range?.before) conds.push(lte(column, range.before));
	if (range?.after) conds.push(gte(column, range.after));
	return conds;
}

/**
 * Entities without an update timestamp refuse an updatedAt FILTER loudly —
 * silently filtering another column would return wrong rows with a 200. (An
 * updatedAt SORT merely falls back to creation order: a reorder, never wrong
 * rows.)
 */
export function requireCreatedAtOnly(
	filters: { updatedAt?: DateRange } | undefined,
	entity: string,
): void {
	if (filters?.updatedAt) {
		throw new ApiError(
			400,
			"bad_request",
			`${entity} do not track update timestamps; filter by createdAt instead.`,
		);
	}
}

export const sortSchema = z.object({
	order: z.enum(["createdAt", "updatedAt"]).optional(),
	sort: z.enum(["asc", "desc"]).optional(),
});
export type SortOptions = z.infer<typeof sortSchema>;

/**
 * The raw decision enum the API serves and filters on. `draft` is excluded on
 * purpose: drafts are hidden from this surface entirely, so a draft filter is
 * a validation error, not an empty page.
 */
export const apiStatusSchema = z.enum([
	"accepted",
	"accept_queue",
	"pending",
	"decline_queue",
	"declined",
	"withdrawn",
]);

const baseFilterFields = {
	createdAt: dateRangeSchema.optional(),
	updatedAt: dateRangeSchema.optional(),
	status: apiStatusSchema.optional(),
};

const baseSearchFields = {
	sort: sortSchema.optional(),
	expand: z.array(z.string()).optional(),
	page: z.unknown().optional(),
	pageSize: z.unknown().optional(),
};

export const recordSearchSchema = z.object({
	filters: z.object(baseFilterFields).optional(),
	...baseSearchFields,
});
export type RecordSearchBody = z.infer<typeof recordSearchSchema>;

export const sessionSearchSchema = z.object({
	filters: z
		.object({ ...baseFilterFields, isAbstract: z.boolean().optional() })
		.optional(),
	...baseSearchFields,
});

export const sessionStatusSearchSchema = z.object({
	filters: z
		.object({ ...baseFilterFields, deletedAt: dateRangeSchema.optional() })
		.optional(),
	...baseSearchFields,
	sort: z
		.object({
			order: z.enum(["createdAt", "updatedAt", "deletedAt"]).optional(),
			sort: z.enum(["asc", "desc"]).optional(),
		})
		.optional(),
});

/** Expand values from query (`?expand=a&expand=b` or comma-separated) plus body. */
export function expandSet(c: ApiContext, bodyExpand?: string[]): Set<string> {
	const fromQuery = (c.req.queries("expand") ?? [])
		.flatMap((v) => v.split(","))
		.map((v) => v.trim())
		.filter(Boolean);
	return new Set([...fromQuery, ...(bodyExpand ?? [])]);
}
