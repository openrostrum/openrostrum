import { data } from "react-router";
import { TasksView } from "~/components/portal/tasks-view";
import { getPortalContext, listPortalTasks, portalPath } from "~/domain/portal";
import { requireUser } from "~/lib/auth";
import { formatInTz } from "~/lib/format";
import { createTimings } from "~/lib/track";
import type { Route } from "./+types/portals.$eventSlug.$portalId.tasks";

export function headers({ loaderHeaders }: Route.HeadersArgs) {
	return loaderHeaders;
}

export async function loader({ context, request, params }: Route.LoaderArgs) {
	const env = context.cloudflare.env;
	const user = await requireUser(env, request);
	const ctx = await getPortalContext(env, user, params);
	const timings = createTimings();
	const rows = await timings.time("db", () => listPortalTasks(env, ctx));
	return data(
		{
			base: portalPath(ctx),
			tasks: rows.map((t) => ({
				id: t.id,
				name: t.name,
				required: t.required,
				type: t.type,
				status: t.status,
				open: t.open,
				overdue: t.overdue,
				due:
					t.dueAtMs !== null
						? formatInTz(new Date(t.dueAtMs), ctx.event.timezone, "date")
						: null,
				submissionTitle: t.submissionTitle,
			})),
		},
		{ headers: { "Server-Timing": timings.header() } },
	);
}

export default function PortalTasks({ loaderData }: Route.ComponentProps) {
	return <TasksView data={loaderData} />;
}
