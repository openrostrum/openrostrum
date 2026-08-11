import { z } from "zod";
import type { events } from "~/db/schema";
import { errorChainIncludes } from "~/lib/errors";
import type { EventDetailsErrors, EventDetailsValues } from "./event-form";

/**
 * Server half of the shared event-details form: one Zod contract + the
 * timezone-aware datetime conversion, used by /admin/settings and
 * /admin/events/new so create and edit can never validate differently.
 */

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

function isValidTimeZone(tz: string): boolean {
	try {
		new Intl.DateTimeFormat("en-US", { timeZone: tz });
		return true;
	} catch {
		return false;
	}
}

const optional = (max: number, message: string) =>
	z
		.string()
		.trim()
		.max(max, message)
		.transform((v) => (v === "" ? null : v));

/** Blank form string → null; otherwise a whole number in [1, max]. */
export const optionalBoundedInt = (max: number, message: string) =>
	z
		.string()
		.trim()
		.transform((v) => (v === "" ? null : Number(v)))
		.refine(
			(v) => v === null || (Number.isInteger(v) && v >= 1 && v <= max),
			message,
		);

const EventDetailsForm = z
	.object({
		name: z.string().trim().min(1, "Event name is required").max(200),
		slug: z
			.string()
			.trim()
			.toLowerCase()
			.min(1, "A URL slug is required")
			.max(80, "Keep the slug under 80 characters")
			.regex(SLUG_RE, "Lowercase letters, numbers, and hyphens only"),
		type: z.string().trim().min(1, "Pick an event type").max(80),
		websiteUrl: optional(500, "Keep the URL under 500 characters").refine(
			(v) => v === null || /^https?:\/\/\S+\.\S+/.test(v),
			"Enter a full URL, e.g. https://example.com",
		),
		location: optional(200, "Keep the location under 200 characters"),
		timezone: z
			.string()
			.refine(isValidTimeZone, "Pick a timezone from the list"),
		theme: optional(1000, "Keep the theme under 1,000 characters"),
		startsAt: z.string().regex(DATETIME_RE, "Pick a start date and time"),
		endsAt: z.string().regex(DATETIME_RE, "Pick an end date and time"),
		submissionLimit: optionalBoundedInt(
			1_000_000,
			"Enter a whole number of 1 or more, or leave blank for no limit",
		),
	})
	// Same "YYYY-MM-DDTHH:mm" shape on both sides, so string order = time order.
	.refine((v) => v.endsAt >= v.startsAt, {
		path: ["endsAt"],
		message: "The end must be on or after the start",
	});

export type EventDetailsData = {
	name: string;
	slug: string;
	type: string;
	websiteUrl: string | null;
	location: string | null;
	timezone: string;
	theme: string | null;
	startsAt: Date;
	endsAt: Date;
	submissionLimit: number | null;
};

export type ParsedEventDetails =
	| { ok: true; data: EventDetailsData; values: EventDetailsValues }
	| { ok: false; fieldErrors: EventDetailsErrors; values: EventDetailsValues };

export function parseEventDetails(form: FormData): ParsedEventDetails {
	const values: EventDetailsValues = {
		name: String(form.get("name") ?? ""),
		slug: String(form.get("slug") ?? ""),
		type: String(form.get("type") ?? ""),
		websiteUrl: String(form.get("websiteUrl") ?? ""),
		location: String(form.get("location") ?? ""),
		timezone: String(form.get("timezone") ?? ""),
		theme: String(form.get("theme") ?? ""),
		startsAt: String(form.get("startsAt") ?? ""),
		endsAt: String(form.get("endsAt") ?? ""),
		submissionLimit: String(form.get("submissionLimit") ?? ""),
	};
	const parsed = EventDetailsForm.safeParse(values);
	if (!parsed.success) {
		return {
			ok: false,
			fieldErrors: z.flattenError(parsed.error).fieldErrors,
			values,
		};
	}
	const { startsAt, endsAt, timezone, ...rest } = parsed.data;
	return {
		ok: true,
		data: {
			...rest,
			timezone,
			startsAt: zonedInputToDate(startsAt, timezone),
			endsAt: zonedInputToDate(endsAt, timezone),
		},
		values,
	};
}

export function eventDetailsValues(
	event: typeof events.$inferSelect,
): EventDetailsValues {
	return {
		name: event.name,
		slug: event.slug,
		type: event.type,
		websiteUrl: event.websiteUrl ?? "",
		location: event.location ?? "",
		timezone: event.timezone,
		theme: event.theme ?? "",
		startsAt: event.startsAt
			? dateToZonedInput(event.startsAt, event.timezone)
			: "",
		endsAt: event.endsAt ? dateToZonedInput(event.endsAt, event.timezone) : "",
		submissionLimit:
			event.submissionLimit === null ? "" : String(event.submissionLimit),
	};
}

/** A taken slug is a normal user-facing outcome, not a server error. */
export function isSlugTakenError(error: unknown): boolean {
	return errorChainIncludes(error, "UNIQUE constraint failed: events.slug");
}

export const SLUG_TAKEN_MESSAGE =
	"That URL slug is already taken — pick another.";

function zoneParts(date: Date, timeZone: string): Record<string, string> {
	const dtf = new Intl.DateTimeFormat("en-US", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hour12: false,
	});
	return Object.fromEntries(
		dtf.formatToParts(date).map((p) => [p.type, p.value]),
	);
}

function zoneOffsetMs(date: Date, timeZone: string): number {
	const p = zoneParts(date, timeZone);
	const asUtc = Date.UTC(
		Number(p.year),
		Number(p.month) - 1,
		Number(p.day),
		// ICU can emit hour "24" at midnight with hour12: false.
		Number(p.hour) % 24,
		Number(p.minute),
		Number(p.second),
	);
	return asUtc - date.getTime();
}

/**
 * "YYYY-MM-DDTHH:mm" as wall-clock time IN the event's timezone → UTC Date.
 * Two-pass offset resolution so instants near a DST transition land on the
 * offset actually in force at that wall-clock time.
 */
export function zonedInputToDate(value: string, timeZone: string): Date {
	const guess = new Date(`${value}:00Z`);
	let ts = guess.getTime() - zoneOffsetMs(guess, timeZone);
	const second = zoneOffsetMs(new Date(ts), timeZone);
	if (guess.getTime() - second !== ts) ts = guess.getTime() - second;
	return new Date(ts);
}

/** UTC Date → "YYYY-MM-DDTHH:mm" wall-clock in the event's timezone. */
export function dateToZonedInput(date: Date, timeZone: string): string {
	const p = zoneParts(date, timeZone);
	const hour = String(Number(p.hour) % 24).padStart(2, "0");
	return `${p.year}-${p.month}-${p.day}T${hour}:${p.minute}`;
}
