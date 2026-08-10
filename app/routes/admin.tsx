import { Outlet } from "react-router";
import { EventSwitcher } from "~/components/event-switcher";
import { getActiveEvent, listMyEvents, requireAdmin } from "~/lib/auth";
import { toSwitcherEvents } from "~/lib/event-switcher.server";
import { navBySection } from "~/nav/registry";
import { Sidebar, SidebarSection, SideNavLink } from "~/ui";
import type { IconName } from "~/ui";
import type { Route } from "./+types/admin";

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
	const [active, mine] = await Promise.all([
		getActiveEvent(env, user),
		listMyEvents(env, user.id),
	]);
	return {
		user: { name: user.name, email: user.email },
		events: toSwitcherEvents(mine, active?.id ?? null),
	};
}

export default function AdminShell({ loaderData }: Route.ComponentProps) {
	return (
		<div className="flex min-h-screen">
			<Sidebar user={loaderData.user}>
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
