import { CONTACT_STATUS } from "~/db/constants";

/**
 * The directory filter set and its three serialized forms — URL params
 * (`event` param ↔ `eventId` field), stored segment JSON, and back. ONE codec
 * so the directory page, saved segments, and pagination links can never
 * disagree about what a filter set means. Client-safe (no drizzle) because
 * route components build pagination/segment URLs from it.
 */
export interface DirectoryFilters {
	q?: string | null;
	company?: string | null;
	title?: string | null;
	eventId?: string | null;
	status?: CrmContactStatus | null;
}

export type CrmContactStatus = (typeof CONTACT_STATUS)[number];

/** Stored shape on crm_segments.filters (absent keys instead of nulls). */
export interface StoredSegmentFilters {
	q?: string;
	company?: string;
	title?: string;
	eventId?: string;
	status?: string;
}

export function isCrmContactStatus(value: unknown): value is CrmContactStatus {
	return (
		typeof value === "string" &&
		(CONTACT_STATUS as readonly string[]).includes(value)
	);
}

export function hasDirectoryFilters(f: DirectoryFilters): boolean {
	return Boolean(f.q || f.company || f.title || f.eventId || f.status);
}

export function directoryFiltersFromParams(
	params: URLSearchParams,
): DirectoryFilters {
	const status = params.get("status");
	return {
		q: params.get("q"),
		company: params.get("company"),
		title: params.get("title"),
		eventId: params.get("event"),
		status: isCrmContactStatus(status) ? status : null,
	};
}

export function directoryFiltersToParams(f: DirectoryFilters): URLSearchParams {
	const params = new URLSearchParams();
	if (f.q) params.set("q", f.q);
	if (f.company) params.set("company", f.company);
	if (f.title) params.set("title", f.title);
	if (f.eventId) params.set("event", f.eventId);
	if (f.status) params.set("status", f.status);
	return params;
}

export function directoryFiltersToStored(
	f: DirectoryFilters,
): StoredSegmentFilters {
	return {
		q: f.q || undefined,
		company: f.company || undefined,
		title: f.title || undefined,
		eventId: f.eventId || undefined,
		status: f.status || undefined,
	};
}

export function storedFiltersToDirectory(
	stored: StoredSegmentFilters,
): DirectoryFilters {
	return {
		q: stored.q ?? null,
		company: stored.company ?? null,
		title: stored.title ?? null,
		eventId: stored.eventId ?? null,
		status: isCrmContactStatus(stored.status) ? stored.status : null,
	};
}

export function directoryUrl(f: DirectoryFilters, page?: number): string {
	const params = directoryFiltersToParams(f);
	if (page && page > 1) params.set("page", String(page));
	const query = params.toString();
	return `/admin/crm/directory${query ? `?${query}` : ""}`;
}

/** Reopen link for a saved segment: its filters expanded + the segment id. */
export function segmentUrl(id: string, stored: StoredSegmentFilters): string {
	const params = directoryFiltersToParams(storedFiltersToDirectory(stored));
	params.set("segment", id);
	return `/admin/crm/directory?${params.toString()}`;
}
