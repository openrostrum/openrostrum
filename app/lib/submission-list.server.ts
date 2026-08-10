import { and, asc, count, eq, inArray, ne, type SQL, sql } from "drizzle-orm";
import { data } from "react-router";
import { z } from "zod";
import { getDb } from "~/db";
import {
	DECISION_STATUS,
	SUBMISSION_STATUS,
	SUBMISSION_TYPE,
} from "~/db/constants";
import { contacts, type events, submissions } from "~/db/schema";
import { transitionSubmissions } from "~/domain/accept";
import { formatInTimezone, formatScheduleRange } from "~/lib/format-date";
import {
	humanStatus,
	type ListActionData,
	LIST_TABS,
	type ListTab,
	PAGE_SIZE,
	type SubmissionListData,
	type SubmissionListLoaded,
} from "~/lib/submission-list";
import { createTimings, track } from "~/lib/track";

type EventRow = typeof events.$inferSelect;
type SubmissionType = (typeof submissions.$inferSelect)["type"];
type SubmissionStatus = (typeof submissions.$inferSelect)["status"];

/**
 * The ONE parser for the All-Submissions `?type=`/`?status=` filters — the
 * list loader and the CSV export both consume it, so "export what I'm looking
 * at" stays exact by construction. Unknown values fall back to "no filter"
 * (a stale link never errors); "" means unfiltered.
 */
export function parseSubmissionFilters(url: URL): {
	filterType: SubmissionType | "";
	filterStatus: SubmissionStatus | "";
} {
	const typeParam = url.searchParams.get("type") ?? "";
	const statusParam = url.searchParams.get("status") ?? "";
	return {
		filterType: (SUBMISSION_TYPE as readonly string[]).includes(typeParam)
			? (typeParam as SubmissionType)
			: "",
		filterStatus: (SUBMISSION_STATUS as readonly string[]).includes(statusParam)
			? (statusParam as SubmissionStatus)
			: "",
	};
}

/** One bound for every contact-picker roster (drawer, detail attach): fetch
 * one past it so truncation is detectable, never silent. */
export const CONTACT_PICKER_CAP = 1000;

function emptyCounts(): Record<ListTab, number> {
	return Object.fromEntries(LIST_TABS.map((t) => [t, 0])) as Record<
		ListTab,
		number
	>;
}

/** Escapes LIKE wildcards so a literal "%"/"_" in the search matches itself. */
function titleLike(q: string): SQL {
	const pattern = `%${q.replaceAll(/[\\%_]/g, (c) => `\\${c}`)}%`;
	return sql`${submissions.title} LIKE ${pattern} ESCAPE '\\'`;
}

export async function loadSubmissionList(
	env: Env,
	event: EventRow | null,
	request: Request,
	type: SubmissionType,
) {
	if (!event) {
		return data({ eventName: null } satisfies SubmissionListData);
	}
	const url = new URL(request.url);
	const rawTab = url.searchParams.get("status") ?? "all";
	const tab: ListTab = (LIST_TABS as readonly string[]).includes(rawTab)
		? (rawTab as ListTab)
		: "all";
	const q = (url.searchParams.get("q") ?? "").trim();
	const pageParam = Number.parseInt(url.searchParams.get("page") ?? "1", 10);
	const requestedPage =
		Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;

	const db = getDb(env);
	const timings = createTimings();
	const payload = await timings.time(
		"db",
		async (): Promise<SubmissionListLoaded> => {
			const base = and(
				eq(submissions.eventId, event.id),
				eq(submissions.type, type),
			);
			const where = and(
				base,
				tab === "all"
					? ne(submissions.status, "draft")
					: eq(submissions.status, tab),
				q ? titleLike(q) : undefined,
			);

			const grouped = await db
				.select({ status: submissions.status, n: count() })
				.from(submissions)
				.where(base)
				.groupBy(submissions.status);
			const counts = emptyCounts();
			for (const g of grouped) {
				counts[g.status] = g.n;
				if (g.status !== "draft") counts.all += g.n;
			}

			const [totalRow] = await db
				.select({ n: count() })
				.from(submissions)
				.where(where);
			const total = totalRow?.n ?? 0;
			const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
			const page = Math.min(requestedPage, pageCount);

			const rows = await db.query.submissions.findMany({
				// Columns match the row projection below (docs/rules/engineering.md
				// "Bounded loaders") — full rows haul multi-KB descriptions per page.
				columns: {
					id: true,
					title: true,
					status: true,
					contentStatus: true,
					startsAt: true,
					endsAt: true,
					createdAt: true,
				},
				where,
				with: {
					format: { columns: { name: true } },
					room: { columns: { name: true } },
					participants: { columns: { id: true } },
					submissionTracks: {
						with: { track: { columns: { name: true, color: true } } },
					},
				},
				orderBy: (s, { desc }) => [desc(s.createdAt), desc(s.id)],
				limit: PAGE_SIZE,
				offset: (page - 1) * PAGE_SIZE,
			});

			// The sessions tab renders per-speaker eye toggles; abstracts render only
			// a count, so the contact columns are fetched for sessions alone (bounded
			// loaders: never haul columns a projection drops). Keyed on THIS page's
			// submission ids — at most PAGE_SIZE bind params.
			const speakersBySubmission = new Map<
				string,
				Array<{ contactId: string; name: string; publicVisible: boolean }>
			>();
			if (type === "session" && rows.length > 0) {
				const pageIds = rows.map((r) => r.id);
				const speakerRows = await db.query.participants.findMany({
					columns: { submissionId: true, contactId: true, position: true },
					where: (p, { inArray: inArrayOp }) =>
						inArrayOp(p.submissionId, pageIds),
					with: {
						contact: {
							columns: { firstName: true, lastName: true, publicVisible: true },
						},
					},
					orderBy: (p, { asc: ascOp }) => [ascOp(p.position)],
				});
				for (const p of speakerRows) {
					const list = speakersBySubmission.get(p.submissionId) ?? [];
					list.push({
						contactId: p.contactId,
						name: `${p.contact.firstName} ${p.contact.lastName}`.trim(),
						publicVisible: p.contact.publicVisible,
					});
					speakersBySubmission.set(p.submissionId, list);
				}
			}

			// Fetch one past the cap so truncation is detectable, never silent.
			const contactCap = CONTACT_PICKER_CAP;
			const contactRows = await db
				.select({
					id: contacts.id,
					firstName: contacts.firstName,
					lastName: contacts.lastName,
					email: contacts.email,
				})
				.from(contacts)
				.where(eq(contacts.eventId, event.id))
				.orderBy(asc(contacts.lastName), asc(contacts.firstName))
				.limit(contactCap + 1);
			const contactsTruncated = contactRows.length > contactCap;
			if (contactsTruncated) contactRows.length = contactCap;

			// The publish-gate banner renders on the Sessions tab only.
			const [notPublic] =
				type === "session"
					? await db
							.select({ n: count() })
							.from(submissions)
							.where(
								and(
									eq(submissions.eventId, event.id),
									eq(submissions.status, "accepted"),
									ne(submissions.contentStatus, "approved"),
								),
							)
					: [{ n: 0 }];

			return {
				eventName: event.name,
				tab,
				q,
				page,
				pageCount,
				total,
				counts,
				rows: rows.map((r) => ({
					id: r.id,
					title: r.title,
					status: r.status,
					contentStatus: r.contentStatus,
					schedule: formatScheduleRange(r.startsAt, r.endsAt, event.timezone),
					roomName: r.room?.name ?? null,
					speakerCount: r.participants.length,
					speakers: speakersBySubmission.get(r.id) ?? [],
					formatName: r.format?.name ?? null,
					tracks: r.submissionTracks.map((st) => ({
						id: st.trackId,
						name: st.track.name,
						color: st.track.color,
					})),
					submittedAt: formatInTimezone(r.createdAt, event.timezone, "date"),
				})),
				contacts: contactRows.map((c) => ({
					id: c.id,
					name: `${c.firstName} ${c.lastName}`,
					email: c.email,
				})),
				contactsTruncated,
				notPublicCount: notPublic?.n ?? 0,
			};
		},
	);
	return data(payload, { headers: { "Server-Timing": timings.header() } });
}

const BulkSetStatus = z.object({
	submissionIds: z
		.array(z.string().min(1))
		.min(1, "Select at least one submission.")
		// D1 caps bind variables per statement — an oversized (forged) selection
		// must refuse cleanly, not throw mid-transition.
		.max(100, "Apply status in batches of up to 100 — narrow the selection."),
	status: z.enum(DECISION_STATUS),
});

/** Bulk intents shared by the Abstracts and Sessions tabs. Caller has already
 * authenticated and resolved the active event. */
export async function submissionListAction(
	env: Env,
	event: EventRow,
	request: Request,
) {
	const db = getDb(env);
	const form = await request.formData();
	const intent = form.get("intent");
	if (intent === "bulk-set-status") {
		return bulkSetStatus(db, event.id, form);
	}
	if (intent === "approve-all-accepted") {
		return approveAllAccepted(db, event.id);
	}
	if (intent === "set-speaker-visibility") {
		return setSpeakerVisibility(db, event.id, form);
	}
	return { formError: "Unknown action." } satisfies ListActionData;
}

const SetSpeakerVisibility = z.object({
	contactId: z.string().min(1),
	visible: z.enum(["1", "0"]),
});

/**
 * The per-speaker eye toggle. `publicVisible` lives on the CONTACT, so hiding
 * a speaker removes them from every public surface (pages, embeds, feeds) —
 * across all their sessions — the next time those load.
 */
async function setSpeakerVisibility(
	db: ReturnType<typeof getDb>,
	eventId: string,
	form: FormData,
) {
	const parsed = SetSpeakerVisibility.safeParse({
		contactId: form.get("contactId"),
		visible: form.get("visible"),
	});
	if (!parsed.success) {
		return {
			formError: "Invalid visibility request.",
		} satisfies ListActionData;
	}
	const publicVisible = parsed.data.visible === "1";
	const timings = createTimings();
	const result = await timings.time("db", async (): Promise<ListActionData> => {
		// Event scoping in the WHERE is the cross-tenant denial: a foreign
		// contactId matches no row and nothing is written.
		const updated = await db
			.update(contacts)
			.set({ publicVisible })
			.where(
				and(
					eq(contacts.id, parsed.data.contactId),
					eq(contacts.eventId, eventId),
				),
			)
			.returning({ id: contacts.id });
		if (!updated[0]) {
			return {
				formError: "That speaker isn't part of this event.",
			} satisfies ListActionData;
		}
		track("contact.visibility_set", {
			eventId,
			contactId: parsed.data.contactId,
			publicVisible,
		});
		// Success needs no message: revalidation flips the eye/badge in place.
		return {} satisfies ListActionData;
	});
	return timed(timings, result);
}

function timed(
	timings: ReturnType<typeof createTimings>,
	body: ListActionData,
) {
	return data(body, { headers: { "Server-Timing": timings.header() } });
}

async function bulkSetStatus(
	db: ReturnType<typeof getDb>,
	eventId: string,
	form: FormData,
) {
	const parsed = BulkSetStatus.safeParse({
		submissionIds: form.getAll("submissionIds"),
		status: form.get("status"),
	});
	if (!parsed.success) {
		return {
			formError: parsed.error.issues[0]?.message ?? "Invalid request.",
		} satisfies ListActionData;
	}
	const timings = createTimings();
	const result = await timings.time("db", async (): Promise<ListActionData> => {
		// Only rows of the ACTIVE event may be acted on — foreign ids are refused.
		const rows = await db
			.select()
			.from(submissions)
			.where(
				and(
					inArray(submissions.id, parsed.data.submissionIds),
					eq(submissions.eventId, eventId),
				),
			);
		const found = new Set(rows.map((r) => r.id));
		const skipped = parsed.data.submissionIds
			.filter((id) => !found.has(id))
			.map((id) => `"${id}": not part of this event.`);
		const results = await transitionSubmissions(db, rows, parsed.data.status);
		for (const r of results.filter((r) => !r.ok)) {
			const title = rows.find((row) => row.id === r.submissionId)?.title;
			skipped.push(`"${title ?? r.submissionId}": ${r.reason}`);
		}
		const changed = results.filter((r) => r.ok).length;
		return {
			notice: `${changed} submission${changed === 1 ? "" : "s"} set to ${humanStatus(parsed.data.status)}.`,
			skipped: skipped.length ? skipped : undefined,
		};
	});
	return timed(timings, result);
}

async function approveAllAccepted(
	db: ReturnType<typeof getDb>,
	eventId: string,
) {
	const timings = createTimings();
	const result = await timings.time("db", async (): Promise<ListActionData> => {
		// One predicate UPDATE: no id list to blow D1's bind-variable cap at
		// real scale, and no select→update race window.
		const updated = await db
			.update(submissions)
			.set({ contentStatus: "approved" })
			.where(
				and(
					eq(submissions.eventId, eventId),
					eq(submissions.status, "accepted"),
					ne(submissions.contentStatus, "approved"),
				),
			);
		const changed = updated.meta.changes ?? 0;
		if (changed === 0) {
			return {
				notice:
					"All accepted submissions are already approved for public display.",
			};
		}
		track("submission.content_bulk_approved", { eventId, count: changed });
		return {
			notice: `${changed} accepted submission${changed === 1 ? "" : "s"} approved for public display.`,
		};
	});
	return timed(timings, result);
}
