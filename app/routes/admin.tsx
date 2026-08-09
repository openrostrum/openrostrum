import { Outlet } from "react-router";
import { requireAdmin } from "~/lib/auth";
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
	const user = await requireAdmin(context.cloudflare.env, request);
	return { user: { name: user.name, email: user.email } };
}

export default function AdminShell({ loaderData }: Route.ComponentProps) {
	return (
		<div className="flex min-h-screen">
			<Sidebar user={loaderData.user}>
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
