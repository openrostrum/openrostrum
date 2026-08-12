import { z } from "zod";
import { CONTACT_STATUS } from "~/db/constants";

/**
 * The directory filter set — ONE optional-field shape used verbatim as the
 * URL-param codec's output, the stored segment JSON (JSON.stringify drops
 * undefined keys), and the query input, so the directory page, saved segments,
 * and pagination links can never disagree. Client-safe: no drizzle imports.
 */
export interface DirectoryFilters {
	q?: string;
	company?: string;
	title?: string;
	eventId?: string;
	status?: CrmContactStatus;
}

export type CrmContactStatus = (typeof CONTACT_STATUS)[number];

/** Both sources of a status here are untrusted text: a URL param and stored
 * segment JSON. Anything that isn't a status parses to undefined = no filter. */
const crmContactStatus = z.enum(CONTACT_STATUS);

export function hasDirectoryFilters(f: DirectoryFilters): boolean {
	return Boolean(f.q || f.company || f.title || f.eventId || f.status);
}

export function directoryFiltersFromParams(
	params: URLSearchParams,
): DirectoryFilters {
	const status = params.get("status");
	return {
		q: params.get("q") || undefined,
		company: params.get("company") || undefined,
		title: params.get("title") || undefined,
		eventId: params.get("event") || undefined,
		status: crmContactStatus.safeParse(status).data,
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

/** Narrow persisted JSON back to the filter shape (an unknown stored status —
 * e.g. after an enum change — degrades to "no status filter", never a 500). */
export function sanitizeStoredFilters(stored: {
	q?: string;
	company?: string;
	title?: string;
	eventId?: string;
	status?: string;
}): DirectoryFilters {
	return {
		q: stored.q || undefined,
		company: stored.company || undefined,
		title: stored.title || undefined,
		eventId: stored.eventId || undefined,
		status: crmContactStatus.safeParse(stored.status).data,
	};
}

export function directoryUrl(f: DirectoryFilters, page?: number): string {
	const params = directoryFiltersToParams(f);
	if (page && page > 1) params.set("page", String(page));
	const query = params.toString();
	return `/admin/crm/directory${query ? `?${query}` : ""}`;
}

/** Reopen link for a saved segment: its filters expanded + the segment id. */
export function segmentUrl(id: string, f: DirectoryFilters): string {
	const params = directoryFiltersToParams(f);
	params.set("segment", id);
	return `/admin/crm/directory?${params.toString()}`;
}
