import { Outlet, data } from "react-router";
import { EventSwitcher } from "~/components/event-switcher";
import { ThemeToggle } from "~/components/theme-toggle";
import { getActiveEvent, listMyEvents, requireAdmin } from "~/lib/auth";
import { toSwitcherEvents } from "~/lib/event-switcher.server";
import { createTimings } from "~/lib/track";
import { useBusy } from "~/lib/use-busy";
import { navBySection } from "~/nav/registry";
import { Sidebar, SidebarSection, SideNavLink } from "~/ui";
import type { IconName } from "~/ui";
import type { Route } from "./+types/admin";

// Without this export, RR7 drops loader headers from DOCUMENT responses —
// Server-Timing would silently vanish on full page loads.
export function headers({ loaderHeaders }: Route.HeadersArgs) {
	return loaderHeaders;
}

/**
 * This layout's `requireAdmin` gates rendering the shell, but does NOT protect
 * children: single-fetch lets a client run any child loader alone via
 * `?_routes=`, and a POST never runs this loader — so every child loader AND
 * action still authenticates itself. The sidebar auto-discovers
 * `app/nav/*.nav.ts`, so features add entries without touching this file.
 */
export async function loader({ context, request }: Route.LoaderArgs) {
	const env = context.cloudflare.env;
	const user = await requireAdmin(env, request);
	const timings = createTimings();
	const [active, mine] = await timings.time("db", () =>
		Promise.all([getActiveEvent(env, user), listMyEvents(env, user.id)]),
	);
	return data(
		{
			user: { name: user.name, email: user.email },
			events: toSwitcherEvents(mine, active?.id ?? null),
		},
		{ headers: { "Server-Timing": timings.header() } },
	);
}

export default function AdminShell({ loaderData }: Route.ComponentProps) {
	const busy = useBusy();
	return (
		<div className="flex min-h-screen">
			<Sidebar
				user={loaderData.user}
				themeControl={<ThemeToggle />}
				logoutDisabled={busy}
			>
				<EventSwitcher events={loaderData.events} />
				{navBySection().map(([section, items]) => (
					<SidebarSection key={section} label={section}>
						{items.map((item) => (
							<SideNavLink
								key={item.to}
								to={item.to}
								icon={item.icon as IconName | undefined}
							>
								{item.label}
							</SideNavLink>
						))}
					</SidebarSection>
				))}
			</Sidebar>
			<main className="min-w-0 flex-1">
				<Outlet />
			</main>
		</div>
	);
}
