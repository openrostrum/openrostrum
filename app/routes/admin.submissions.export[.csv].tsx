import { and, eq } from "drizzle-orm";
import { getDb } from "~/db";
import { submissions } from "~/db/schema";
import { getActiveEvent, requireAdmin } from "~/lib/auth";
import { formatInTimeZone } from "~/lib/dates";
import { toCsv } from "~/lib/evaluation";
import { parseSubmissionFilters } from "~/lib/submission-list.server";
import { createTimings, track } from "~/lib/track";
import type { Route } from "./+types/admin.submissions.export[.csv]";

/**
 * Resource route: CSV of the submissions list. Honors the same `type`/`status`
 * filters as `/admin/submissions`, so "export what I'm looking at" is exact —
 * unknown values fall back to unfiltered, matching the list loader.
 */
export async function loader({ context, request }: Route.LoaderArgs) {
	const env = context.cloudflare.env;
	const user = await requireAdmin(env, request);
	const event = await getActiveEvent(env, user);
	if (!event) throw new Response("Not found", { status: 404 });

	const { filterType, filterStatus } = parseSubmissionFilters(
		new URL(request.url),
	);

	const db = getDb(env);
	const timings = createTimings();
	// The export's product IS the whole filtered set — bounded by the event,
	// with columns narrowed to what the CSV carries (no descriptions/bodies).
	const rows = await timings.time("db", () =>
		db.query.submissions.findMany({
			columns: {
				id: true,
				title: true,
				type: true,
				status: true,
				contentStatus: true,
				language: true,
				startsAt: true,
				endsAt: true,
				createdAt: true,
			},
			where: and(
				eq(submissions.eventId, event.id),
				filterType ? eq(submissions.type, filterType) : undefined,
				filterStatus ? eq(submissions.status, filterStatus) : undefined,
			),
			with: {
				format: { columns: { name: true } },
				room: { columns: { name: true } },
				participants: {
					columns: { role: true, isPrimary: true },
					with: {
						contact: {
							columns: { firstName: true, lastName: true, email: true },
						},
					},
					orderBy: (p, { asc, desc }) => [desc(p.isPrimary), asc(p.position)],
				},
				submissionTracks: { with: { track: { columns: { name: true } } } },
			},
			orderBy: (s, { desc }) => [desc(s.createdAt), desc(s.id)],
		}),
	);

	const tz = event.timezone;
	const csv = toCsv([
		[
			"Title",
			"Type",
			"Status",
			"Content status",
			"Language",
			"Tracks",
			"Format",
			"Room",
			"Starts at",
			"Ends at",
			"Speakers",
			"Speaker emails",
			"Submitted at",
		],
		...rows.map((r) => {
			const speakers = r.participants.filter((p) => p.role === "speaker");
			return [
				r.title,
				r.type,
				r.status,
				r.contentStatus,
				r.language,
				r.submissionTracks.map((st) => st.track.name).join("; "),
				r.format?.name ?? "",
				r.room?.name ?? "",
				r.startsAt ? formatInTimeZone(r.startsAt, tz) : "",
				r.endsAt ? formatInTimeZone(r.endsAt, tz) : "",
				speakers
					.map((p) => `${p.contact.firstName} ${p.contact.lastName}`)
					.join("; "),
				speakers.map((p) => p.contact.email).join("; "),
				formatInTimeZone(r.createdAt, tz),
			];
		}),
	]);

	track("submission.exported", {
		eventId: event.id,
		rows: rows.length,
		type: filterType || "all",
		status: filterStatus || "all",
	});
	const suffix = [filterType, filterStatus].filter(Boolean).join("-");
	return new Response(csv, {
		headers: {
			"Content-Type": "text/csv; charset=utf-8",
			"Content-Disposition": `attachment; filename="submissions${suffix ? `-${suffix}` : ""}.csv"`,
			"Server-Timing": timings.header(),
		},
	});
}
