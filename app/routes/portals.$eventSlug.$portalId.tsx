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
import { Button, Input, PageHeader, Panel, StatusBadge, Tab, Tabs } from "~/ui";
import type { Route } from "./+types/portals.$eventSlug.$portalId";

/**
 * Portal shell. This loader gates GET navigation, but children still
 * self-authenticate — single-fetch can run a child loader alone.
 */
export async function loader({ context, request, params }: Route.LoaderArgs) {
	const env = context.cloudflare.env;
	const user = await requireUser(env, request);
	const ctx = await getPortalContext(env, user, params, request);
	return {
		base: portalPath(ctx),
		portal: {
			name: ctx.portal.name,
			accentColor: ctx.portal.accentColor,
			hasLogo: ctx.portal.logoKey !== null,
		},
		eventName: ctx.event.name,
		user: { name: ctx.contact?.firstName ?? user.name, email: user.email },
		preview: ctx.preview,
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
	const { base, portal, eventName, user, preview } = loaderData;
	const { pathname } = useLocation();
	return (
		<div className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-4 px-4 py-5 sm:px-7">
			{preview && (
				<Panel>
					<div className="flex flex-wrap items-center gap-3">
						<StatusBadge tone="warning">Preview</StatusBadge>
						<span className="flex-1">
							Previewing this portal as <strong>{preview.contactName}</strong> —
							actions are disabled.
						</span>
						<Form method="post" action="/admin/portals">
							<Input type="hidden" name="intent" value="exit-preview" />
							<Button type="submit" variant="ghost">
								Exit preview
							</Button>
						</Form>
					</div>
				</Panel>
			)}
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
				{/* Native fieldset[disabled] turns off EVERY nested control in every
				    child view at once — the UI honors "actions are disabled" without
				    each portal page knowing about preview (the server chokepoint
				    still refuses hand-crafted POSTs). min-w-0 cancels the fieldset
				    min-content default that would break narrow layouts. */}
				<fieldset disabled={preview !== null} className="min-w-0">
					<Outlet />
				</fieldset>
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
	const previewBlocked = isRouteErrorResponse(error) && error.status === 403;
	// Generic copy only — a denial page must carry zero foreign data.
	return (
		<div className="mx-auto max-w-4xl px-7 py-16">
			<PageHeader
				title={
					previewBlocked
						? "Actions are disabled in preview"
						: notFound
							? "This page isn't available"
							: "Something went wrong"
				}
				subtitle={
					previewBlocked
						? "You are viewing this portal as a speaker — nothing can be submitted or changed while previewing. Go back to the portal, or end the preview from the admin Portals page."
						: notFound
							? "The link may be wrong, or you may not have access to this content. Check the portal link from your email, or log in with the account you submitted with."
							: "Please refresh the page or try again in a moment."
				}
			/>
		</div>
	);
}
