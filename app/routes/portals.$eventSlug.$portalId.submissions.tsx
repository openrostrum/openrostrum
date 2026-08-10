import { data } from "react-router";
import { SubmissionsView } from "~/components/portal/submissions-view";
import {
	getPortalContext,
	listPortalSubmissions,
	portalPath,
} from "~/domain/portal";
import { requireUser } from "~/lib/auth";
import { createTimings } from "~/lib/track";
import type { Route } from "./+types/portals.$eventSlug.$portalId.submissions";

export function headers({ loaderHeaders }: Route.HeadersArgs) {
	return loaderHeaders;
}

export async function loader({ context, request, params }: Route.LoaderArgs) {
	const env = context.cloudflare.env;
	const user = await requireUser(env, request);
	const ctx = await getPortalContext(env, user, params, request);
	const timings = createTimings();
	const rows = await timings.time("db", () =>
		listPortalSubmissions(env, ctx, user.id),
	);
	return data(
		{
			base: portalPath(ctx),
			submissions: rows.map((s) => ({
				id: s.id,
				title: s.title,
				status: s.status,
				format: s.format,
				participation: s.participation,
			})),
		},
		{ headers: { "Server-Timing": timings.header() } },
	);
}

export default function PortalSubmissions({
	loaderData,
}: Route.ComponentProps) {
	return (
		<SubmissionsView
			base={loaderData.base}
			submissions={loaderData.submissions}
		/>
	);
}
