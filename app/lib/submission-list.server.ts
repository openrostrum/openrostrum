import { and, asc, count, eq, inArray, ne, type SQL, sql } from "drizzle-orm";
import { data } from "react-router";
import { z } from "zod";
import { getDb } from "~/db";
import { DECISION_STATUS } from "~/db/constants";
import { contacts, type events, submissions } from "~/db/schema";
import { transitionSubmissions } from "~/domain/accept";
import { formatInTimezone, formatScheduleRange } from "~/lib/format-date";
import {
	type ListActionData,
	LIST_TABS,
	type ListTab,
	PAGE_SIZE,
	type SubmissionListData,
} from "~/lib/submission-list";
import { createTimings, track } from "~/lib/track";

type EventRow = typeof events.$inferSelect;
type SubmissionType = (typeof submissions.$inferSelect)["type"];

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
		const payload: SubmissionListData = {
			eventName: null,
			tab: "all",
			q: "",
			page: 1,
			pageCount: 1,
			total: 0,
			counts: emptyCounts(),
			rows: [],
			contacts: [],
			notPublicCount: 0,
		};
		return data(payload);
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
		async (): Promise<SubmissionListData> => {
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
				where,
				with: {
					format: true,
					room: true,
					participants: { columns: { id: true } },
					submissionTracks: { with: { track: true } },
				},
				orderBy: (s, { desc }) => [desc(s.createdAt), desc(s.id)],
				limit: PAGE_SIZE,
				offset: (page - 1) * PAGE_SIZE,
			});

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
				.limit(1000);

			const [notPublic] = await db
				.select({ n: count() })
				.from(submissions)
				.where(
					and(
						eq(submissions.eventId, event.id),
						eq(submissions.status, "accepted"),
						ne(submissions.contentStatus, "approved"),
					),
				);

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
				notPublicCount: notPublic?.n ?? 0,
			};
		},
	);
	return data(payload, { headers: { "Server-Timing": timings.header() } });
}

const BulkSetStatus = z.object({
	submissionIds: z
		.array(z.string().min(1))
		.min(1, "Select at least one submission."),
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
	return { formError: "Unknown action." } satisfies ListActionData;
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
			notice: `${changed} submission${changed === 1 ? "" : "s"} set to ${parsed.data.status.replaceAll("_", " ")}.`,
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
		const pending = await db
			.select({ id: submissions.id })
			.from(submissions)
			.where(
				and(
					eq(submissions.eventId, eventId),
					eq(submissions.status, "accepted"),
					ne(submissions.contentStatus, "approved"),
				),
			);
		if (pending.length === 0) {
			return {
				notice:
					"All accepted sessions are already approved for public display.",
			};
		}
		await db
			.update(submissions)
			.set({ contentStatus: "approved" })
			.where(
				inArray(
					submissions.id,
					pending.map((p) => p.id),
				),
			);
		track("submission.content_bulk_approved", {
			eventId,
			count: pending.length,
		});
		return {
			notice: `${pending.length} accepted session${pending.length === 1 ? "" : "s"} approved for public display.`,
		};
	});
	return timed(timings, result);
}
