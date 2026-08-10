import {
	Form,
	isRouteErrorResponse,
	Outlet,
	useLocation,
	useRouteError,
} from "react-router";
import { PortalBrand } from "~/components/portal-brand";
import { FooterNote } from "~/components/portal/bits";
import { getPortalContext, portalPath } from "~/domain/portal";
import { requireUser } from "~/lib/auth";
import { Button, PageHeader, Tab, Tabs } from "~/ui";
import type { Route } from "./+types/portals.$eventSlug.$portalId";

/**
 * Portal shell. This loader gates GET navigation, but children still
 * self-authenticate — single-fetch can run a child loader alone.
 */
export async function loader({ context, request, params }: Route.LoaderArgs) {
	const env = context.cloudflare.env;
	const user = await requireUser(env, request);
	const ctx = await getPortalContext(env, user, params);
	return {
		base: portalPath(ctx),
		portal: {
			name: ctx.portal.name,
			accentColor: ctx.portal.accentColor,
			hasLogo: ctx.portal.logoKey !== null,
		},
		eventName: ctx.event.name,
		user: { name: ctx.contact?.firstName ?? user.name, email: user.email },
	};
}

const TABS = [
	{ label: "Home", segment: "/home" },
	{ label: "Submissions", segment: "/submissions" },
	{ label: "Profile", segment: "/profile" },
	{ label: "Tasks", segment: "/tasks" },
	{ label: "Files", segment: "/files" },
] as const;

export default function PortalShell({ loaderData }: Route.ComponentProps) {
	const { base, portal, eventName, user } = loaderData;
	const { pathname } = useLocation();
	return (
		<div className="mx-auto flex min-h-screen w-full max-w-4xl flex-col px-4 py-5 sm:px-7">
			<header className="flex flex-col gap-4">
				<div className="flex flex-wrap items-center justify-between gap-3">
					<PortalBrand
						name={portal.name}
						eventName={eventName}
						accentColor={portal.accentColor}
						logoUrl={portal.hasLogo ? `${base}/logo` : null}
					/>
					<Form method="post" action="/logout">
						<Button type="submit" variant="ghost" icon="logout">
							Log out
						</Button>
					</Form>
				</div>
				<div className="overflow-x-auto">
					<Tabs>
						{TABS.map((tab) => (
							<Tab
								key={tab.segment}
								to={`${base}${tab.segment}`}
								active={pathname.startsWith(`${base}${tab.segment}`)}
							>
								{tab.label}
							</Tab>
						))}
					</Tabs>
				</div>
			</header>
			<main className="flex-1 py-5">
				<Outlet />
			</main>
			<footer>
				<FooterNote>
					<span>
						You are logged in as {user.name ?? user.email} ({user.email}).
					</span>
					<span>Not you?</span>
					<Form method="post" action="/logout">
						<Button type="submit" variant="ghost">
							Log out
						</Button>
					</Form>
				</FooterNote>
			</footer>
		</div>
	);
}

export function ErrorBoundary() {
	const error = useRouteError();
	const notFound = isRouteErrorResponse(error) && error.status === 404;
	// Generic copy only — a denial page must carry zero foreign data.
	return (
		<div className="mx-auto max-w-4xl px-7 py-16">
			<PageHeader
				title={notFound ? "This page isn't available" : "Something went wrong"}
				subtitle={
					notFound
						? "The link may be wrong, or you may not have access to this content. Check the portal link from your email, or log in with the account you submitted with."
						: "Please refresh the page or try again in a moment."
				}
			/>
		</div>
	);
}
