/**
 * Sessionboard's pagination contract: `page` (1–999) + `pageSize` (1–100,
 * default 25), travelling as query params (search endpoints also accept them
 * in the body). Two envelope dialects exist in their spec and both are
 * reproduced verbatim — search/list responses use `results` + camelCase
 * pagination, the sessions CRUD proxy uses `data` + snake_case. Compat means
 * matching each endpoint, never normalizing.
 */

import { z } from "zod";

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;
export const MAX_PAGE = 999;

export type PageParams = { page: number; pageSize: number };

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(Math.trunc(value), min), max);
}

/**
 * A page number reaches us as a query string or as JSON, so both spellings are
 * one schema. Anything that doesn't read as a finite number — blank, absent,
 * `"abc"`, `Infinity`, an object — means "not supplied", never 0.
 */
const PageNumber = z
	.union([z.number(), z.string().trim().min(1).transform(Number)])
	.refine(Number.isFinite);

function toNumber(value: unknown): number | undefined {
	return PageNumber.safeParse(value).data;
}

export function parsePageParams(
	url: URL,
	body?: { page?: unknown; pageSize?: unknown },
): PageParams {
	const page =
		toNumber(url.searchParams.get("page")) ?? toNumber(body?.page) ?? 1;
	const pageSize =
		toNumber(url.searchParams.get("pageSize")) ??
		toNumber(url.searchParams.get("page_size")) ??
		toNumber(body?.pageSize) ??
		DEFAULT_PAGE_SIZE;
	return {
		page: clamp(page, 1, MAX_PAGE),
		pageSize: clamp(pageSize, 1, MAX_PAGE_SIZE),
	};
}

export function offsetOf({ page, pageSize }: PageParams): number {
	return (page - 1) * pageSize;
}

export async function runPaged<T>(
	countQuery: PromiseLike<{ n: number }[]>,
	rowsQuery: PromiseLike<T[]>,
): Promise<{ total: number; rows: T[] }> {
	const [countRows, rows] = await Promise.all([countQuery, rowsQuery]);
	return { total: countRows[0]?.n ?? 0, rows };
}

export function searchEnvelope<T>(
	results: T[],
	{ page, pageSize }: PageParams,
	totalResults: number,
): {
	results: T[];
	pagination: {
		currentPage: number;
		pageSize: number;
		totalPages: number;
		totalResults: number;
	};
} {
	return {
		results,
		pagination: {
			currentPage: page,
			pageSize,
			totalPages: Math.ceil(totalResults / pageSize),
			totalResults,
		},
	};
}

export function crudEnvelope<T>(
	data: T[],
	{ page, pageSize }: PageParams,
	totalResults: number,
): {
	data: T[];
	pagination: {
		current_page: number;
		page_size: number;
		total_pages: number;
		total_results: number;
	};
} {
	return {
		data,
		pagination: {
			current_page: page,
			page_size: pageSize,
			total_pages: Math.ceil(totalResults / pageSize),
			total_results: totalResults,
		},
	};
}
