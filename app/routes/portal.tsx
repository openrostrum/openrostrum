import { data, redirect } from "react-router";
import { FullPageEmptyState } from "~/components/full-page-empty-state";
import { type AccessiblePortal, listAccessiblePortals } from "~/domain/portal";
import { requireUser } from "~/lib/auth";
import { createTimings } from "~/lib/track";
import { PageHeader, Panel, TextLink } from "~/ui";
import type { Route } from "./+types/portal";

export type PortalResolverData = {
	choices: AccessiblePortal[];
};

export function headers({ loaderHeaders }: Route.HeadersArgs) {
	return loaderHeaders;
}

/**
 * Speaker landing after a bare login (homePathForRole → /portal). One
 * accessible portal still redirects; more than one stays here as a chooser.
 */
export async function loader({ context, request }: Route.LoaderArgs) {
	const env = context.cloudflare.env;
	const user = await requireUser(env, request);
	const timings = createTimings();
	const accessible = await timings.time("db", () =>
		listAccessiblePortals(env, user),
	);
	const headers = { "Server-Timing": timings.header() };
	if (accessible.length === 1) {
		const [only] = accessible;
		if (only) throw redirect(only.href);
	}
	return data({ choices: accessible }, { headers });
}

export default function PortalResolver({ loaderData }: Route.ComponentProps) {
	const { choices } = loaderData;
	if (choices.length === 0) {
		return (
			<FullPageEmptyState
				icon="mic"
				title="No portal access yet"
				body="Your speaker portal appears once you submit to an event's call for papers, or once an organizer adds you to a session. Use the portal link from your confirmation email if you have one."
			/>
		);
	}
	return (
		<main className="mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center gap-6 px-6">
			<PageHeader
				title="Choose an event"
				subtitle="You have a speaker portal in more than one event. Open the one you want to work in."
			/>
			<Panel>
				<ul className="flex flex-col gap-3">
					{choices.map((choice) => (
						<li key={choice.href}>
							<TextLink to={choice.href}>{choice.eventName}</TextLink>
						</li>
					))}
				</ul>
			</Panel>
		</main>
	);
}
