import { data } from "react-router";
import { HomeView } from "~/components/portal/home-view";
import {
	getPortalContext,
	listPortalSubmissions,
	listPortalTasks,
	portalPath,
} from "~/domain/portal";
import { requireUser } from "~/lib/auth";
import { createTimings } from "~/lib/track";
import type { Route } from "./+types/portals.$eventSlug.$portalId.home";

export function headers({ loaderHeaders }: Route.HeadersArgs) {
	return loaderHeaders;
}

export async function loader({ context, request, params }: Route.LoaderArgs) {
	const env = context.cloudflare.env;
	const user = await requireUser(env, request);
	const ctx = await getPortalContext(env, user, params, request);
	const timings = createTimings();
	const [submissionRows, taskRows] = await timings.time("db", () =>
		Promise.all([listPortalSubmissions(env, ctx), listPortalTasks(env, ctx)]),
	);
	return data(
		{
			base: portalPath(ctx),
			welcomeHtml: ctx.portal.welcomeMessage,
			firstName: ctx.contact?.firstName ?? user.name,
			profile: ctx.contact
				? {
						name: `${ctx.contact.firstName} ${ctx.contact.lastName}`,
						email: ctx.contact.email,
						jobTitle: ctx.contact.jobTitle,
						companyName: ctx.contact.companyName,
					}
				: null,
			userEmail: user.email,
			submissionCount: submissionRows.length,
			submissions: submissionRows.slice(0, 5).map((s) => ({
				id: s.id,
				title: s.title,
				status: s.status,
				format: s.format,
			})),
			tasks: taskRows,
		},
		{ headers: { "Server-Timing": timings.header() } },
	);
}

export default function PortalHome({ loaderData }: Route.ComponentProps) {
	return <HomeView data={loaderData} />;
}
