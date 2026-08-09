import { getDb } from "~/db";
import type { Route } from "./+types/submissions";

/**
 * GOLDEN PATH — the canonical feature slice. Copy this shape for every route:
 *   loader (server, Cloudflare env → Drizzle → D1)  →  typed component (Route.*)
 *   →  Tailwind UI. Types flow end-to-end: `loaderData` is inferred from `loader`
 *   via the generated `./+types/submissions`. No client fetching — RR loaders
 *   are the data layer (see docs/tech-stack.md).
 */
export async function loader({ context }: Route.LoaderArgs) {
	const db = getDb(context.cloudflare.env);
	const submissions = await db.query.submissions.findMany({
		with: {
			participants: true,
			submissionTracks: { with: { track: true } },
		},
		orderBy: (s, { desc }) => [desc(s.createdAt)],
	});
	return { submissions };
}

const STATUS_STYLES: Record<string, string> = {
	accepted: "bg-emerald-100 text-emerald-800",
	pending: "bg-amber-100 text-amber-800",
	accept_queue: "bg-sky-100 text-sky-800",
	decline_queue: "bg-orange-100 text-orange-800",
	declined: "bg-rose-100 text-rose-800",
	withdrawn: "bg-zinc-200 text-zinc-700",
	draft: "bg-zinc-100 text-zinc-500",
};

export default function Submissions({ loaderData }: Route.ComponentProps) {
	const { submissions } = loaderData;
	return (
		<main className="mx-auto max-w-5xl px-6 py-10">
			<h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
				Submissions
			</h1>
			<p className="mt-1 text-sm text-zinc-500">
				{submissions.length} submission{submissions.length === 1 ? "" : "s"}
			</p>

			<div className="mt-6 overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
				<table className="w-full text-left text-sm">
					<thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-900">
						<tr>
							<th className="px-4 py-3 font-medium">Title</th>
							<th className="px-4 py-3 font-medium">Status</th>
							<th className="px-4 py-3 font-medium">Tracks</th>
							<th className="px-4 py-3 font-medium">Speakers</th>
							<th className="px-4 py-3 font-medium">Format</th>
						</tr>
					</thead>
					<tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
						{submissions.map((s) => (
							<tr key={s.id}>
								<td className="px-4 py-3 font-medium text-zinc-900 dark:text-zinc-100">
									{s.title}
								</td>
								<td className="px-4 py-3">
									<span
										className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[s.status] ?? "bg-zinc-100 text-zinc-600"}`}
									>
										{s.status.replace("_", " ")}
									</span>
								</td>
								<td className="px-4 py-3">
									<div className="flex flex-wrap gap-1">
										{s.submissionTracks.map((st) => (
											<span
												key={st.trackId}
												className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium text-white"
												style={{ backgroundColor: st.track.color }}
											>
												{st.track.name}
											</span>
										))}
									</div>
								</td>
								<td className="px-4 py-3 tabular-nums text-zinc-600 dark:text-zinc-300">
									{s.participants.length}
								</td>
								<td className="px-4 py-3 text-zinc-600 dark:text-zinc-300">
									{s.format ?? "—"}
								</td>
							</tr>
						))}
						{submissions.length === 0 && (
							<tr>
								<td
									colSpan={5}
									className="px-4 py-10 text-center text-zinc-400"
								>
									No submissions yet.
								</td>
							</tr>
						)}
					</tbody>
				</table>
			</div>
		</main>
	);
}
