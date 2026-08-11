import { and, eq } from "drizzle-orm";
import { useEffect, useMemo, useRef, useState } from "react";
import {
	data,
	Form,
	type ShouldRevalidateFunctionArgs,
	useFetcher,
	useFetchers,
	useNavigation,
	useSearchParams,
} from "react-router";
import { z } from "zod";
import {
	AgendaBoard,
	type BoardFilters,
	type BoardView,
	ConflictClock,
	FilterChip,
	InfoBar,
	SectionLabel,
	Strong,
	ToggleChips,
} from "~/agenda/board";
import {
	type AgendaSession,
	autoPlace,
	buildConflictRows,
	classifyAgendaSessions,
	type Conflict,
	conflictSentence,
	conflictsById,
	DEFAULT_DURATION_MINS,
	detectConflicts,
	eventDayList,
	formatDayLabel,
	formatMinutes,
	formatRangeMs,
	hasCompletePlacement,
	isSessionVisible,
	matchesSessionFilters,
	resolveEventDays,
	sessionDurationMins,
	SLOT_MINS,
	utcToWall,
	wallToUtc,
} from "~/agenda/lib";
import { getDb } from "~/db";
import { SUBMISSION_STATUS } from "~/db/constants";
import { events, formats, rooms as roomsTable, submissions } from "~/db/schema";
import {
	computeScheduleChanges,
	sendScheduleUpdates,
} from "~/domain/schedule-update";
import { getActiveEvent, requireAdmin } from "~/lib/auth";
import { errorMessage } from "~/lib/errors";
import { isPubliclyVisible } from "~/lib/program";
import { createTimings, track } from "~/lib/track";
import { useBusy } from "~/lib/use-busy";
import {
	Button,
	Chip,
	EmptyRow,
	EmptyState,
	ErrorText,
	Field,
	Input,
	PageHeader,
	Panel,
	SearchInput,
	Select,
	StatusBadge,
	SUBMISSION_STATUS_TONE,
	Tab,
	Table,
	Tabs,
	TBody,
	Td,
	TextLink,
	Th,
	THead,
	Tr,
} from "~/ui";
import type { Route } from "./+types/admin.agenda";

const VIEWS = [
	"day",
	"week",
	"track",
	"list",
	"conflicts",
	"settings",
] as const;
type View = (typeof VIEWS)[number];

// Without this export RR7 drops loader/action headers from document
// responses — Server-Timing would silently vanish on full page loads.
export function headers({ loaderHeaders }: Route.HeadersArgs) {
	return loaderHeaders;
}

// The loader is view-state independent (filters/day/view all live in search
// params over the same data), so param-only navigations skip the roundtrip;
// mutations still revalidate.
export function shouldRevalidate({
	formMethod,
	defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) {
	if (formMethod && formMethod.toUpperCase() !== "GET") {
		return defaultShouldRevalidate;
	}
	return false;
}

type SubmissionStatus = (typeof SUBMISSION_STATUS)[number];

function schedulableSetOf(event: {
	schedulableStatuses: string[] | null;
}): SubmissionStatus[] {
	// NULL (raw-SQL-seeded or legacy rows) means the Sessionboard default; junk
	// values in the JSON column are dropped rather than poisoning the query.
	const raw = event.schedulableStatuses ?? ["accepted"];
	const valid = raw.filter((s): s is SubmissionStatus =>
		(SUBMISSION_STATUS as readonly string[]).includes(s),
	);
	return valid.length > 0 ? valid : ["accepted"];
}

type SessionRowWith = {
	id: string;
	title: string;
	status: string;
	contentStatus: string;
	startsAt: Date | null;
	endsAt: Date | null;
	roomId: string | null;
	format: { name: string; defaultDurationMins: number } | null;
	submissionTracks: { track: { id: string; name: string; color: string } }[];
	participants: {
		role: string;
		contactId: string;
		contact: { firstName: string; lastName: string };
	}[];
};

function toAgendaSession(
	s: SessionRowWith,
	schedulable: readonly string[],
): AgendaSession {
	return {
		id: s.id,
		title: s.title,
		status: s.status,
		schedulable: schedulable.includes(s.status),
		startsAt: s.startsAt ? s.startsAt.getTime() : null,
		endsAt: s.endsAt ? s.endsAt.getTime() : null,
		roomId: s.roomId,
		formatName: s.format?.name ?? null,
		durationMins: s.format?.defaultDurationMins ?? DEFAULT_DURATION_MINS,
		tracks: s.submissionTracks.map((st) => ({
			id: st.track.id,
			name: st.track.name,
			color: st.track.color,
		})),
		speakers: s.participants
			// Secondary contacts assist with logistics — they can't be double-booked.
			.filter((p) => p.role !== "secondary")
			.map((p) => ({
				contactId: p.contactId,
				name: `${p.contact.firstName} ${p.contact.lastName}`.trim(),
			})),
	};
}

function daysFor(
	event: { startsAt: Date | null; endsAt: Date | null; timezone: string },
	sessions: readonly AgendaSession[],
): string[] {
	return resolveEventDays(
		event.startsAt?.getTime() ?? null,
		event.endsAt?.getTime() ?? null,
		sessions.flatMap((s) => (s.startsAt != null ? [s.startsAt] : [])),
		event.timezone,
	);
}

async function loadSessions(
	db: ReturnType<typeof getDb>,
	eventId: string,
	statuses: SubmissionStatus[],
) {
	// Narrow columns everywhere: the board needs titles/times/names only, and
	// hauling full rows (session descriptions, whole contact records) made this
	// loader's cost scale with content size, not session count.
	return db.query.submissions.findMany({
		columns: {
			id: true,
			title: true,
			status: true,
			contentStatus: true,
			startsAt: true,
			endsAt: true,
			roomId: true,
		},
		where: (s, { and: andW, eq: eqW, inArray, isNotNull, isNull, or }) =>
			andW(
				eqW(s.eventId, eventId),
				or(
					inArray(s.status, statuses),
					andW(isNotNull(s.startsAt), isNotNull(s.endsAt)),
				),
				isNull(s.parentId),
			),
		with: {
			format: { columns: { name: true, defaultDurationMins: true } },
			submissionTracks: {
				columns: {},
				with: { track: { columns: { id: true, name: true, color: true } } },
			},
			participants: {
				columns: { contactId: true, role: true },
				with: { contact: { columns: { firstName: true, lastName: true } } },
			},
		},
	});
}

export async function loader({ context, request }: Route.LoaderArgs) {
	const env = context.cloudflare.env;
	// Self-authenticate — never rely on the admin.tsx layout loader (single
	// fetch can run a child loader alone via `?_routes=`).
	const user = await requireAdmin(env, request);
	const event = await getActiveEvent(env, user);
	if (!event) {
		return data({
			event: null,
			rooms: [],
			tracks: [],
			formats: [],
			sessions: [],
			statusOptions: [],
		});
	}
	const db = getDb(env);
	const timings = createTimings();
	const schedulable = schedulableSetOf(event);
	// "accepted" always loads (even when not schedulable) — the needs-a-slot
	// alert counts accepted sessions and must not undercount under a narrowed
	// schedulable set; "draft" loads for the Drafts display toggle.
	const loadStatuses: SubmissionStatus[] = [
		...new Set<SubmissionStatus>([...schedulable, "accepted", "draft"]),
	];

	const [roomRows, trackRows, formatRows, sessionRows, changeSet] =
		await timings.time("db", () =>
			Promise.all([
				db.query.rooms.findMany({
					where: (r, { eq: eqW }) => eqW(r.eventId, event.id),
					orderBy: (r, { asc }) => [asc(r.displayOrder), asc(r.name)],
				}),
				db.query.tracks.findMany({
					where: (t, { eq: eqW }) => eqW(t.eventId, event.id),
					orderBy: (t, { asc }) => [asc(t.name)],
				}),
				db.query.formats.findMany({
					where: (f, { eq: eqW }) => eqW(f.eventId, event.id),
					orderBy: (f, { asc }) => [asc(f.position), asc(f.name)],
				}),
				loadSessions(db, event.id, loadStatuses),
				computeScheduleChanges(db, event),
			]),
		);

	const sessions = sessionRows.map((s) => toAgendaSession(s, schedulable));
	const statusOptions = [
		...new Set<string>([
			...schedulable,
			"draft",
			...sessions.map((s) => s.status),
		]),
	];
	const days = daysFor(event, sessions);
	// What the published page will withhold: complete placements on this grid
	// that the public projection rejects (status ≠ accepted, or unapproved).
	const hiddenFromPublic = sessionRows.filter(
		(s) => hasCompletePlacement(s) && !isPubliclyVisible(s),
	).length;

	return data(
		{
			event: {
				id: event.id,
				name: event.name,
				slug: event.slug,
				timezone: event.timezone,
				dayStartMin: event.agendaDayStartMin,
				dayEndMin: event.agendaDayEndMin,
				schedulableStatuses: schedulable,
				publishedAt: event.agendaPublishedAt?.getTime() ?? null,
				days,
				hiddenFromPublic,
				staleSpeakers: changeSet.speakers,
				scheduleScanTruncated: changeSet.truncated,
			},
			rooms: roomRows.map((r) => ({
				id: r.id,
				name: r.name,
				capacity: r.capacity,
				visible: r.visible,
			})),
			tracks: trackRows.map((t) => ({
				id: t.id,
				name: t.name,
				color: t.color,
			})),
			formats: formatRows.map((f) => ({
				id: f.id,
				name: f.name,
				defaultDurationMins: f.defaultDurationMins,
			})),
			sessions,
			statusOptions,
		},
		{ headers: { "Server-Timing": timings.header() } },
	);
}

/* ---------------------------------------------------------------- action --- */

const ScheduleIntent = z.object({
	submissionId: z.string().min(1),
	roomId: z.string().min(1),
	day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
	startMinutes: z.coerce
		.number()
		.int()
		.min(0)
		.max(24 * 60 - SLOT_MINS)
		.multipleOf(SLOT_MINS),
});

const SettingsWindow = z
	.object({
		dayStartMin: z.coerce.number().int().min(0).max(1440).multipleOf(15),
		dayEndMin: z.coerce.number().int().min(0).max(1440).multipleOf(15),
	})
	.refine((v) => v.dayStartMin < v.dayEndMin, {
		message: "Day start must be before day end.",
		path: ["dayEndMin"],
	});

type ActionResult = {
	ok: boolean;
	formError?: string;
	fieldErrors?: Record<string, string[] | undefined>;
	placed?: number;
	unplaced?: number;
	saved?: "settings";
	updates?: {
		sent: number;
		deduped: number;
		failed: number;
		remaining: number;
	};
};

const fail = (formError: string): ActionResult => ({ ok: false, formError });
const failFields = (
	fieldErrors: ActionResult["fieldErrors"],
): ActionResult => ({ ok: false, fieldErrors });
const ok = (extra: Partial<ActionResult> = {}): ActionResult => ({
	ok: true,
	...extra,
});

export async function action({ context, request }: Route.ActionArgs) {
	const env = context.cloudflare.env;
	// Actions self-authenticate — a POST never re-runs the layout loader.
	const user = await requireAdmin(env, request);
	const event = await getActiveEvent(env, user);
	if (!event) {
		return fail("No event is configured yet.");
	}
	const db = getDb(env);
	const timings = createTimings();
	const form = await request.formData();
	const intent = String(form.get("intent") ?? "");
	const schedulable = schedulableSetOf(event);

	try {
		if (intent === "schedule") {
			const parsed = ScheduleIntent.safeParse({
				submissionId: form.get("submissionId"),
				roomId: form.get("roomId"),
				day: form.get("day"),
				startMinutes: form.get("startMinutes"),
			});
			if (!parsed.success) {
				return fail("That drop target wasn’t valid — try again.");
			}
			const p = parsed.data;
			const [sub, room] = await timings.time("db", () =>
				Promise.all([
					db.query.submissions.findFirst({
						where: (s, { and: andW, eq: eqW }) =>
							andW(eq(s.id, p.submissionId), eqW(s.eventId, event.id)),
						with: { format: true },
					}),
					db.query.rooms.findFirst({
						where: (r, { and: andW, eq: eqW }) =>
							andW(eqW(r.id, p.roomId), eqW(r.eventId, event.id)),
					}),
				]),
			);
			if (!sub) return fail("Session not found.");
			if (!room) return fail("Room not found.");
			// Server-side gate — the tray only OFFERS schedulable sessions, but a
			// direct POST must be rejected too.
			if (!schedulable.includes(sub.status)) {
				return fail(
					`“${sub.title}” is ${sub.status.replace("_", " ")} — only schedulable statuses can be placed on the agenda (see Settings).`,
				);
			}
			// A date-less event has no bound to enforce — its grid days derive from
			// existing sessions, so any dropped day is legitimate.
			const days = eventDayList(
				event.startsAt?.getTime() ?? null,
				event.endsAt?.getTime() ?? null,
				event.timezone,
			);
			if (days.length > 0 && !days.includes(p.day)) {
				return fail("That day is outside the event.");
			}
			if (
				p.startMinutes < event.agendaDayStartMin ||
				p.startMinutes >= event.agendaDayEndMin
			) {
				return fail("That time is outside the agenda day window.");
			}
			const durationMs =
				sessionDurationMins({
					startsAt: sub.startsAt?.getTime() ?? null,
					endsAt: sub.endsAt?.getTime() ?? null,
					durationMins:
						sub.format?.defaultDurationMins ?? DEFAULT_DURATION_MINS,
				}) * 60_000;
			const startsAt = new Date(
				wallToUtc(p.day, p.startMinutes, event.timezone),
			);
			const endsAt = new Date(startsAt.getTime() + durationMs);
			await timings.time("db-write", () =>
				db
					.update(submissions)
					.set({ startsAt, endsAt, roomId: room.id, updatedAt: new Date() })
					.where(
						and(eq(submissions.id, sub.id), eq(submissions.eventId, event.id)),
					),
			);
			track("agenda.scheduled", {
				eventId: event.id,
				submissionId: sub.id,
				roomId: room.id,
				day: p.day,
				startMinutes: p.startMinutes,
			});
			return data(ok(), {
				headers: { "Server-Timing": timings.header() },
			});
		}

		if (intent === "unschedule") {
			const submissionId = String(form.get("submissionId") ?? "");
			if (!submissionId) return fail("Session not found.");
			const sub = await db.query.submissions.findFirst({
				where: (s, { and: andW, eq: eqW }) =>
					andW(eqW(s.id, submissionId), eqW(s.eventId, event.id)),
			});
			if (!sub) return fail("Session not found.");
			if (!schedulable.includes(sub.status)) {
				return fail(
					`“${sub.title}” is not schedulable (${sub.status.replace("_", " ")}) — only schedulable statuses can be removed from the agenda (see Settings).`,
				);
			}
			await timings.time("db-write", () =>
				db
					.update(submissions)
					.set({
						startsAt: null,
						endsAt: null,
						roomId: null,
						updatedAt: new Date(),
					})
					.where(
						and(eq(submissions.id, sub.id), eq(submissions.eventId, event.id)),
					),
			);
			track("agenda.unscheduled", { eventId: event.id, submissionId: sub.id });
			return data(ok(), {
				headers: { "Server-Timing": timings.header() },
			});
		}

		if (intent === "autoplace") {
			const [roomRows, sessionRows] = await timings.time("db", () =>
				Promise.all([
					db.query.rooms.findMany({
						where: (r, { and: andW, eq: eqW }) =>
							andW(eqW(r.eventId, event.id), eqW(r.visible, true)),
						orderBy: (r, { asc }) => [asc(r.displayOrder), asc(r.name)],
					}),
					loadSessions(db, event.id, schedulable),
				]),
			);
			if (roomRows.length === 0) {
				return fail("Add at least one room before auto-placing.");
			}
			const mapped = sessionRows.map((s) => toAgendaSession(s, schedulable));
			const days = daysFor(event, mapped);
			const { schedulablePlaced, schedulableUnplaced } = classifyAgendaSessions(
				mapped,
				false,
			);
			const { placements, unplacedIds } = autoPlace({
				days,
				timezone: event.timezone,
				dayStartMin: event.agendaDayStartMin,
				dayEndMin: event.agendaDayEndMin,
				rooms: roomRows,
				scheduled: schedulablePlaced.map((s) => ({
					id: s.id,
					startsAt: s.startsAt,
					endsAt: s.endsAt,
					roomId: s.roomId,
					speakerIds: s.speakers.map((sp) => sp.contactId),
				})),
				unscheduled: schedulableUnplaced.map((s) => ({
					id: s.id,
					durationMins: s.durationMins,
					speakerIds: s.speakers.map((sp) => sp.contactId),
				})),
			});
			const now = new Date();
			const writes = placements.map((p) =>
				db
					.update(submissions)
					.set({
						startsAt: new Date(p.startsAtMs),
						endsAt: new Date(p.endsAtMs),
						roomId: p.roomId,
						updatedAt: now,
					})
					.where(
						and(eq(submissions.id, p.id), eq(submissions.eventId, event.id)),
					),
			);
			const [firstWrite, ...restWrites] = writes;
			if (firstWrite) {
				await timings.time("db-write", () =>
					db.batch([firstWrite, ...restWrites]),
				);
			}
			track("agenda.autoplaced", {
				eventId: event.id,
				placed: placements.length,
				unplaced: unplacedIds.length,
			});
			return data(
				ok({ placed: placements.length, unplaced: unplacedIds.length }),
				{ headers: { "Server-Timing": timings.header() } },
			);
		}

		if (intent === "schedule-updates") {
			const changeSet = await timings.time("db", () =>
				computeScheduleChanges(db, event),
			);
			if (changeSet.truncated) {
				return data(
					fail(
						"Invite history could not be checked completely — no schedule updates were sent.",
					),
					{ headers: { "Server-Timing": timings.header() } },
				);
			}
			const outcome = await timings.time("send", () =>
				sendScheduleUpdates(db, env, event, changeSet.changes),
			);
			track("agenda.schedule_updates_sent", {
				eventId: event.id,
				sent: outcome.sent,
				deduped: outcome.deduped,
				failed: outcome.failed,
				remaining: outcome.remaining,
			});
			return data(ok({ updates: outcome }), {
				headers: { "Server-Timing": timings.header() },
			});
		}

		if (intent === "publish" || intent === "unpublish") {
			await timings.time("db-write", () =>
				db
					.update(events)
					.set({
						agendaPublishedAt: intent === "publish" ? new Date() : null,
					})
					.where(eq(events.id, event.id)),
			);
			track(intent === "publish" ? "agenda.published" : "agenda.unpublished", {
				eventId: event.id,
			});
			return data(ok(), {
				headers: { "Server-Timing": timings.header() },
			});
		}

		if (intent === "settings") {
			const parsedWindow = SettingsWindow.safeParse({
				dayStartMin: form.get("dayStartMin"),
				dayEndMin: form.get("dayEndMin"),
			});
			if (!parsedWindow.success) {
				return failFields(z.flattenError(parsedWindow.error).fieldErrors);
			}
			const statuses = form
				.getAll("schedulableStatuses")
				.map(String)
				.filter((s): s is (typeof SUBMISSION_STATUS)[number] =>
					(SUBMISSION_STATUS as readonly string[]).includes(s),
				);
			if (statuses.length === 0) {
				return fail(
					"Pick at least one schedulable status — with none selected the agenda would be empty.",
				);
			}
			const formatRows = await db.query.formats.findMany({
				where: (f, { eq: eqW }) => eqW(f.eventId, event.id),
			});
			const durations: { id: string; mins: number }[] = [];
			const fieldErrors: Record<string, string[]> = {};
			for (const f of formatRows) {
				const raw = form.get(`duration_${f.id}`);
				if (raw == null) continue;
				const mins = Number(raw);
				if (!Number.isInteger(mins) || mins < 5 || mins > 1440) {
					fieldErrors[`duration_${f.id}`] = [
						"Duration must be 5–1440 minutes.",
					];
				} else if (mins !== f.defaultDurationMins) {
					durations.push({ id: f.id, mins });
				}
			}
			if (Object.keys(fieldErrors).length > 0) {
				return failFields(fieldErrors);
			}
			const eventUpdate = db
				.update(events)
				.set({
					agendaDayStartMin: parsedWindow.data.dayStartMin,
					agendaDayEndMin: parsedWindow.data.dayEndMin,
					schedulableStatuses: statuses,
				})
				.where(eq(events.id, event.id));
			const formatUpdates = durations.map((d) =>
				db
					.update(formats)
					.set({ defaultDurationMins: d.mins })
					.where(and(eq(formats.id, d.id), eq(formats.eventId, event.id))),
			);
			// Room visibility: applied only when the form carried the field (the
			// presence marker keeps a partial POST from silently hiding every room).
			const roomChanges: { id: string; visible: boolean }[] = [];
			if (form.get("visibleRooms_present")) {
				const selectedRooms = new Set(form.getAll("visibleRooms").map(String));
				const roomRows = await db.query.rooms.findMany({
					where: (r, { eq: eqW }) => eqW(r.eventId, event.id),
				});
				for (const room of roomRows) {
					const visible = selectedRooms.has(room.id);
					if (room.visible !== visible)
						roomChanges.push({ id: room.id, visible });
				}
			}
			await timings.time("db-write", () =>
				db.batch([
					eventUpdate,
					...formatUpdates,
					...roomChanges.map((c) =>
						db
							.update(roomsTable)
							.set({ visible: c.visible })
							.where(
								and(eq(roomsTable.id, c.id), eq(roomsTable.eventId, event.id)),
							),
					),
				]),
			);
			track("agenda.settings_updated", {
				eventId: event.id,
				dayStartMin: parsedWindow.data.dayStartMin,
				dayEndMin: parsedWindow.data.dayEndMin,
				schedulableStatuses: statuses.join(","),
				formatDurationChanges: durations.length,
			});
			return data(ok({ saved: "settings" }), {
				headers: { "Server-Timing": timings.header() },
			});
		}

		return fail("Unknown action.");
	} catch (error) {
		track("agenda.action_failed", {
			eventId: event.id,
			intent,
			error: errorMessage(error),
		});
		return fail("Could not save that change — please try again.");
	}
}

/* ------------------------------------------------------------- component --- */

/**
 * One keyed fetcher for all drag/unschedule posts, with a queue: a quick
 * second drag must never abort an in-flight write (resubmitting a busy
 * fetcher cancels its request), and a keyed fetcher's `data` persists so a
 * rejected drop surfaces as an inline error instead of a silent snap-back.
 * The next successful mutation clears it.
 */
function useMutationQueue() {
	const fetcher = useFetcher<ActionResult>({ key: "agenda-dnd" });
	const queueRef = useRef<FormData[]>([]);
	const idle = fetcher.state === "idle";
	useEffect(() => {
		if (idle) {
			const next = queueRef.current.shift();
			if (next) fetcher.submit(next, { method: "post" });
		}
	}, [idle, fetcher]);
	const submitMutation = (fd: FormData) => {
		if (fetcher.state === "idle") void fetcher.submit(fd, { method: "post" });
		else queueRef.current.push(fd);
	};
	return { submitMutation, mutationError: fetcher.data?.formError ?? null };
}

function useOptimisticSessions(
	base: AgendaSession[],
	timezone: string,
): AgendaSession[] {
	const fetchers = useFetchers();
	return useMemo(() => {
		let rows = base;
		for (const f of fetchers) {
			if (!f.formData) continue;
			const intent = f.formData.get("intent");
			if (intent === "schedule") {
				const id = String(f.formData.get("submissionId"));
				const day = String(f.formData.get("day"));
				const minutes = Number(f.formData.get("startMinutes"));
				const roomId = String(f.formData.get("roomId"));
				rows = rows.map((s) => {
					if (s.id !== id) return s;
					const startMs = wallToUtc(day, minutes, timezone);
					return {
						...s,
						startsAt: startMs,
						endsAt: startMs + sessionDurationMins(s) * 60_000,
						roomId,
					};
				});
			} else if (intent === "unschedule") {
				const id = String(f.formData.get("submissionId"));
				rows = rows.map((s) =>
					s.id === id
						? { ...s, startsAt: null, endsAt: null, roomId: null }
						: s,
				);
			}
		}
		return rows;
	}, [base, fetchers, timezone]);
}

function patchParams(
	params: URLSearchParams,
	patch: Record<string, string | null>,
): URLSearchParams {
	const next = new URLSearchParams(params);
	for (const [key, value] of Object.entries(patch)) {
		if (value === null || value === "") next.delete(key);
		else next.set(key, value);
	}
	return next;
}

function viewLink(
	params: URLSearchParams,
	patch: Record<string, string | null>,
): string {
	const qs = patchParams(params, patch).toString();
	return qs ? `?${qs}` : "?";
}

const TIME_OPTIONS: number[] = [];
for (let m = 0; m <= 1440; m += 30) TIME_OPTIONS.push(m);

export default function Agenda({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const [searchParams, setSearchParams] = useSearchParams();
	const navigation = useNavigation();
	const busy = useBusy();
	const placeFetcher = useFetcher<ActionResult>();
	const publishFetcher = useFetcher<ActionResult>();
	const updatesFetcher = useFetcher<ActionResult>();
	// Search stays local state (not a URL param): a param write per keystroke
	// would spam history with navigations for a filter nobody deep-links.
	const [q, setQ] = useState("");
	const { submitMutation, mutationError } = useMutationQueue();

	const event = loaderData.event;
	const timezone = event?.timezone ?? "UTC";
	const sessions = useOptimisticSessions(
		(loaderData.sessions ?? []) as AgendaSession[],
		timezone,
	);

	const conflicts = useMemo(
		() => (event ? detectConflicts(sessions, loaderData.rooms) : []),
		[event, sessions, loaderData.rooms],
	);
	const byId = useMemo(() => conflictsById(conflicts), [conflicts]);

	if (!event) {
		return (
			<div className="mx-auto flex max-w-6xl flex-col gap-5 px-7 py-6">
				<PageHeader title="Agenda" />
				<Panel>
					<EmptyState
						icon="calendar"
						title="No event yet"
						body="Create an event first — the agenda builder schedules an event's accepted sessions across its days and rooms."
					/>
				</Panel>
			</div>
		);
	}

	const rawView = searchParams.get("view") ?? "day";
	const view: View = (VIEWS as readonly string[]).includes(rawView)
		? (rawView as View)
		: "day";
	const activeDay = event.days.includes(searchParams.get("day") ?? "")
		? (searchParams.get("day") as string)
		: (event.days[0] ?? "");
	const filters: BoardFilters = {
		q,
		trackId: searchParams.get("track") ?? "",
		roomId: searchParams.get("room") ?? "",
		status: searchParams.get("status") ?? "",
		showDrafts: searchParams.get("drafts") === "1",
	};

	const classification = classifyAgendaSessions(sessions, filters.showDrafts);
	const scheduledCount = classification.scheduled.length;
	const unscheduledCount = classification.unscheduled.length;
	const needsSlot = classification.needsSlot.length;

	const onSchedule = (
		sessionId: string,
		day: string,
		minutes: number,
		roomId: string,
	) => {
		const fd = new FormData();
		fd.set("intent", "schedule");
		fd.set("submissionId", sessionId);
		fd.set("day", day);
		fd.set("startMinutes", String(minutes));
		fd.set("roomId", roomId);
		submitMutation(fd);
	};
	const onUnschedule = (sessionId: string) => {
		const fd = new FormData();
		fd.set("intent", "unschedule");
		fd.set("submissionId", sessionId);
		submitMutation(fd);
	};

	const visibleRooms = loaderData.rooms.filter((r) => r.visible);
	const statusOptions = loaderData.statusOptions;
	const { rows: conflictRows, total: conflictTotal } =
		buildConflictRows(conflicts);

	const showsBoard = view === "day" || view === "week" || view === "track";
	const showsDayStrip = view === "day" || view === "track";

	return (
		<div className="mx-auto flex max-w-[1400px] flex-col gap-4 px-7 py-6">
			<PageHeader
				title="Agenda"
				count={`${scheduledCount} scheduled · ${unscheduledCount} unscheduled`}
				subtitle="Drag sessions from the tray onto the grid; conflicts flag themselves as you build."
				actions={
					<>
						<StatusBadge tone={event.publishedAt ? "success" : "neutral"}>
							{event.publishedAt ? "Published" : "Unpublished"}
						</StatusBadge>
						{event.publishedAt != null && (
							<TextLink to={`/schedule/${event.slug}`}>
								View public schedule
							</TextLink>
						)}
						<publishFetcher.Form method="post">
							<Button
								type="submit"
								variant="ghost"
								name="intent"
								value={event.publishedAt ? "unpublish" : "publish"}
								disabled={publishFetcher.state !== "idle"}
							>
								{event.publishedAt ? "Unpublish" : "Publish agenda"}
							</Button>
						</publishFetcher.Form>
						<placeFetcher.Form method="post">
							<Button
								type="submit"
								icon="star"
								name="intent"
								value="autoplace"
								disabled={
									placeFetcher.state !== "idle" || unscheduledCount === 0
								}
							>
								{placeFetcher.state === "idle"
									? "Auto-place remaining"
									: "Placing…"}
							</Button>
						</placeFetcher.Form>
					</>
				}
			/>

			{needsSlot > 0 && (
				<InfoBar>
					<Strong>{needsSlot}</Strong> accepted{" "}
					{needsSlot === 1 ? "session" : "sessions"} still{" "}
					{needsSlot === 1 ? "needs" : "need"} a time slot.
				</InfoBar>
			)}
			{event.publishedAt != null && event.hiddenFromPublic > 0 && (
				<InfoBar>
					<Strong>{event.hiddenFromPublic}</Strong> scheduled{" "}
					{event.hiddenFromPublic === 1 ? "session isn't" : "sessions aren't"}{" "}
					on the public schedule — a session shows there once its status is
					accepted AND its content is approved.{" "}
					<TextLink to="/admin/sessions">Approve content in Sessions</TextLink>
				</InfoBar>
			)}
			{event.staleSpeakers > 0 && (
				<InfoBar>
					<div className="flex flex-wrap items-center justify-between gap-3">
						<span>
							<Strong>{event.staleSpeakers}</Strong>{" "}
							{event.staleSpeakers === 1 ? "speaker has" : "speakers have"}{" "}
							unsent schedule updates — their calendars still show the last
							invite they were emailed.
							{event.scheduleScanTruncated &&
								" (Matching invite history exceeded the check limit, so these counts may be incomplete.)"}
						</span>
						<updatesFetcher.Form method="post">
							<Button
								type="submit"
								variant="ghost"
								name="intent"
								value="schedule-updates"
								disabled={busy}
							>
								{updatesFetcher.state === "idle"
									? "Send schedule updates"
									: "Sending…"}
							</Button>
						</updatesFetcher.Form>
					</div>
				</InfoBar>
			)}
			{event.staleSpeakers === 0 && event.scheduleScanTruncated && (
				<InfoBar>
					Matching invite history exceeded the check limit, so schedule-update
					counts may be incomplete.
				</InfoBar>
			)}
			{updatesFetcher.data?.updates && updatesFetcher.state === "idle" && (
				<InfoBar>
					Sent <Strong>{updatesFetcher.data.updates.sent}</Strong>{" "}
					schedule-update{" "}
					{updatesFetcher.data.updates.sent === 1 ? "email" : "emails"}
					{updatesFetcher.data.updates.deduped > 0 && (
						<> — {updatesFetcher.data.updates.deduped} already delivered</>
					)}
					{updatesFetcher.data.updates.failed > 0 && (
						<>
							{" "}
							— <Strong>{updatesFetcher.data.updates.failed}</Strong> failed
							(see <TextLink to="/admin/emails/history">Email history</TextLink>{" "}
							and retry)
						</>
					)}
					{updatesFetcher.data.updates.remaining > 0 && (
						<>
							{" "}
							— <Strong>{updatesFetcher.data.updates.remaining}</Strong> more to
							send, click again
						</>
					)}
					.
				</InfoBar>
			)}
			{placeFetcher.data?.placed !== undefined &&
				placeFetcher.state === "idle" && (
					<InfoBar>
						Auto-placed <Strong>{placeFetcher.data.placed}</Strong>{" "}
						{placeFetcher.data.placed === 1 ? "session" : "sessions"}
						{(placeFetcher.data.unplaced ?? 0) > 0 && (
							<>
								{" "}
								— <Strong>{placeFetcher.data.unplaced}</Strong> didn’t fit in
								the current day window
							</>
						)}
						.
					</InfoBar>
				)}
			{(mutationError ??
				placeFetcher.data?.formError ??
				publishFetcher.data?.formError ??
				updatesFetcher.data?.formError) && (
				<ErrorText>
					{mutationError ??
						placeFetcher.data?.formError ??
						publishFetcher.data?.formError ??
						updatesFetcher.data?.formError}
				</ErrorText>
			)}

			<Tabs>
				<Tab
					to={viewLink(searchParams, { view: "list" })}
					active={view === "list"}
				>
					List
				</Tab>
				<Tab
					to={viewLink(searchParams, { view: null })}
					active={view === "day"}
				>
					Day
				</Tab>
				<Tab
					to={viewLink(searchParams, { view: "week" })}
					active={view === "week"}
				>
					Week
				</Tab>
				<Tab
					to={viewLink(searchParams, { view: "track" })}
					active={view === "track"}
				>
					Track
				</Tab>
				<Tab
					to={viewLink(searchParams, { view: "conflicts" })}
					active={view === "conflicts"}
					count={conflictTotal}
				>
					Conflicts
				</Tab>
				<Tab
					to={viewLink(searchParams, { view: "settings" })}
					active={view === "settings"}
				>
					Settings
				</Tab>
			</Tabs>

			{(showsBoard || view === "list") && (
				<div className="flex flex-wrap items-end gap-3">
					<SearchInput
						placeholder="Search sessions or speakers…"
						value={q}
						onChange={(e) => setQ(e.currentTarget.value)}
						aria-label="Search sessions"
					/>
					<Field label="Track">
						<Select
							value={filters.trackId}
							onChange={(e) =>
								setSearchParams(
									(prev) => patchParams(prev, { track: e.currentTarget.value }),
									{ preventScrollReset: true },
								)
							}
						>
							<option value="">All tracks</option>
							{loaderData.tracks.map((t) => (
								<option key={t.id} value={t.id}>
									{t.name}
								</option>
							))}
						</Select>
					</Field>
					<Field label="Room">
						<Select
							value={filters.roomId}
							onChange={(e) =>
								setSearchParams(
									(prev) => patchParams(prev, { room: e.currentTarget.value }),
									{ preventScrollReset: true },
								)
							}
						>
							<option value="">All rooms</option>
							{visibleRooms.map((r) => (
								<option key={r.id} value={r.id}>
									{r.name}
								</option>
							))}
						</Select>
					</Field>
					<Field label="Status">
						<Select
							value={filters.status}
							onChange={(e) =>
								setSearchParams(
									(prev) =>
										patchParams(prev, { status: e.currentTarget.value }),
									{ preventScrollReset: true },
								)
							}
						>
							<option value="">All statuses</option>
							{statusOptions.map((s) => (
								<option key={s} value={s}>
									{s.replace("_", " ")}
								</option>
							))}
						</Select>
					</Field>
					<FilterChip
						active={filters.showDrafts}
						onClick={() =>
							setSearchParams(
								(prev) =>
									patchParams(prev, {
										drafts: filters.showDrafts ? null : "1",
									}),
								{ preventScrollReset: true },
							)
						}
					>
						Drafts
					</FilterChip>
				</div>
			)}

			{showsDayStrip && event.days.length > 1 && (
				<Tabs>
					{event.days.map((day) => (
						<Tab
							key={day}
							to={viewLink(searchParams, { day })}
							active={day === activeDay}
						>
							{formatDayLabel(day)}
						</Tab>
					))}
				</Tabs>
			)}

			{showsBoard && (
				<AgendaBoard
					view={view as BoardView}
					days={event.days}
					activeDay={activeDay}
					timezone={timezone}
					dayStartMin={event.dayStartMin}
					dayEndMin={event.dayEndMin}
					rooms={visibleRooms}
					tracks={loaderData.tracks}
					sessions={sessions}
					conflicts={byId}
					filters={filters}
					onSchedule={onSchedule}
					onUnschedule={onUnschedule}
				/>
			)}

			{view === "list" && (
				<ListView
					sessions={sessions}
					filters={filters}
					timezone={timezone}
					rooms={loaderData.rooms}
					byId={byId}
				/>
			)}

			{view === "conflicts" && (
				<Table>
					<THead>
						<Th>Session</Th>
						<Th>Conflict</Th>
						<Th />
					</THead>
					<TBody>
						{conflictRows.map((row) => (
							<Tr
								key={`${row.conflict.aId}|${row.conflict.bId}|${row.conflict.kind}|${row.conflict.personName ?? ""}|${row.sideId}`}
							>
								<Td kind="strong">
									<span className="inline-flex items-center gap-2">
										<ConflictClock label="Scheduling conflict" />
										{row.sideTitle}
									</span>
								</Td>
								<Td>{conflictSentence(row.conflict, row.sideId, timezone)}</Td>
								<Td>
									<TextLink to={`/admin/submissions/${row.sideId}`}>
										Open
									</TextLink>
								</Td>
							</Tr>
						))}
						{conflictTotal > conflictRows.length && (
							<EmptyRow colSpan={3}>
								Showing the first {conflictRows.length} of {conflictTotal}{" "}
								conflict rows — resolve these and the rest surface here.
							</EmptyRow>
						)}
						{conflictRows.length === 0 && (
							<EmptyRow colSpan={3}>
								No conflicts — no speaker or room is booked twice at the same
								time.
							</EmptyRow>
						)}
					</TBody>
				</Table>
			)}

			{view === "settings" && (
				<Panel>
					<Form method="post" className="flex max-w-2xl flex-col gap-5">
						<div className="flex flex-wrap gap-3">
							<Field
								label="Day starts"
								error={actionData?.fieldErrors?.dayStartMin?.[0]}
							>
								<Select name="dayStartMin" defaultValue={event.dayStartMin}>
									{[...new Set([...TIME_OPTIONS, event.dayStartMin])]
										.sort((a, b) => a - b)
										.map((m) => (
											<option key={m} value={m}>
												{formatMinutes(m)}
											</option>
										))}
								</Select>
							</Field>
							<Field
								label="Day ends"
								error={actionData?.fieldErrors?.dayEndMin?.[0]}
							>
								<Select name="dayEndMin" defaultValue={event.dayEndMin}>
									{[...new Set([...TIME_OPTIONS, event.dayEndMin])]
										.sort((a, b) => a - b)
										.map((m) => (
											<option key={m} value={m}>
												{m === 1440 ? "Midnight" : formatMinutes(m)}
											</option>
										))}
								</Select>
							</Field>
						</div>
						<div className="flex flex-col gap-2">
							<SectionLabel hint="Only sessions in these statuses can be placed on the agenda.">
								Schedulable statuses
							</SectionLabel>
							<ToggleChips
								name="schedulableStatuses"
								options={SUBMISSION_STATUS.map((s) => ({
									value: s,
									label: s.replace("_", " "),
								}))}
								initial={event.schedulableStatuses}
							/>
						</div>
						{loaderData.rooms.length > 0 && (
							<div className="flex flex-col gap-2">
								<SectionLabel hint="Hidden rooms keep their scheduled sessions but leave the day grid.">
									Rooms shown on the grid
								</SectionLabel>
								<ToggleChips
									name="visibleRooms"
									options={loaderData.rooms.map((r) => ({
										value: r.id,
										label: r.name,
									}))}
									initial={loaderData.rooms
										.filter((r) => r.visible)
										.map((r) => r.id)}
								/>
							</div>
						)}
						<div className="flex flex-col gap-2">
							<SectionLabel hint="Auto-fills a block's end time when a session is first placed.">
								Default duration per format (minutes)
							</SectionLabel>
							{loaderData.formats.map((f) => (
								<div key={f.id} className="flex items-center gap-3">
									<span className="w-44">{f.name}</span>
									<Input
										name={`duration_${f.id}`}
										type="number"
										min={5}
										max={1440}
										step={5}
										defaultValue={f.defaultDurationMins}
										invalid={Boolean(
											actionData?.fieldErrors?.[`duration_${f.id}`]?.[0],
										)}
										aria-label={`Default duration for ${f.name}`}
									/>
									{actionData?.fieldErrors?.[`duration_${f.id}`]?.[0] && (
										<ErrorText>
											{actionData.fieldErrors[`duration_${f.id}`]?.[0]}
										</ErrorText>
									)}
								</div>
							))}
							{loaderData.formats.length === 0 && (
								<InfoBar>
									No formats yet — add them in Settings → Library; new
									placements fall back to 30 minutes.
								</InfoBar>
							)}
						</div>
						<div className="flex items-center gap-3">
							<Button
								type="submit"
								name="intent"
								value="settings"
								disabled={navigation.state !== "idle"}
							>
								{navigation.state === "idle" ? "Save settings" : "Saving…"}
							</Button>
							{actionData?.saved === "settings" &&
								navigation.state === "idle" && (
									<StatusBadge tone="success">Saved</StatusBadge>
								)}
							{actionData?.formError && (
								<ErrorText>{actionData.formError}</ErrorText>
							)}
						</div>
					</Form>
				</Panel>
			)}
		</div>
	);
}

function ListView({
	sessions,
	filters,
	timezone,
	rooms,
	byId,
}: {
	sessions: AgendaSession[];
	filters: BoardFilters;
	timezone: string;
	rooms: { id: string; name: string }[];
	byId: Map<string, Conflict[]>;
}) {
	const roomName = new Map(rooms.map((r) => [r.id, r.name]));
	const rows = sessions
		.filter((s) => isSessionVisible(s, filters.showDrafts))
		.filter((s) => matchesSessionFilters(s, filters))
		.sort((a, b) => {
			if (a.startsAt == null && b.startsAt == null)
				return a.title.localeCompare(b.title);
			if (a.startsAt == null) return 1;
			if (b.startsAt == null) return -1;
			return a.startsAt - b.startsAt || a.title.localeCompare(b.title);
		});
	return (
		<Table>
			<THead>
				<Th>Title</Th>
				<Th>Status</Th>
				<Th>When</Th>
				<Th>Room</Th>
				<Th>Track</Th>
				<Th>Format</Th>
			</THead>
			<TBody>
				{rows.map((s) => (
					<Tr key={s.id}>
						<Td kind="strong">
							<span className="inline-flex max-w-md items-center gap-2">
								{byId.has(s.id) && (
									<ConflictClock label="Scheduling conflict" />
								)}
								<span className="truncate">{s.title}</span>
							</span>
						</Td>
						<Td>
							<StatusBadge
								tone={
									SUBMISSION_STATUS_TONE[
										s.status as keyof typeof SUBMISSION_STATUS_TONE
									] ?? "neutral"
								}
							>
								{s.status.replace("_", " ")}
							</StatusBadge>
						</Td>
						<Td kind="mono">
							{s.startsAt != null && s.endsAt != null
								? `${formatDayLabel(utcToWall(s.startsAt, timezone).day)} · ${formatRangeMs(s.startsAt, s.endsAt, timezone)}`
								: "—"}
						</Td>
						<Td>{s.roomId ? (roomName.get(s.roomId) ?? "—") : "—"}</Td>
						<Td>
							<div className="flex flex-wrap gap-3">
								{s.tracks.map((t) => (
									<Chip key={t.id} color={t.color}>
										{t.name}
									</Chip>
								))}
							</div>
						</Td>
						<Td>{s.formatName ?? "—"}</Td>
					</Tr>
				))}
				{rows.length === 0 && (
					<EmptyRow colSpan={6}>
						Nothing matches — accept sessions (or widen the schedulable statuses
						in Settings) and they will appear here.
					</EmptyRow>
				)}
			</TBody>
		</Table>
	);
}

export function ErrorBoundary() {
	// Generic message only — raw errors can carry SQL/row values; the detail is
	// in the server logs.
	return (
		<div className="mx-auto max-w-6xl px-7 py-6">
			<PageHeader
				title="Failed to load the agenda"
				tone="danger"
				subtitle="Something went wrong. Please refresh or try again."
			/>
		</div>
	);
}
