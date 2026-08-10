import { Outlet } from "react-router";
import { getActiveEvent, requireAdmin } from "~/lib/auth";
import { ButtonLink, EmptyState, PageHeader, Panel, Tab, Tabs } from "~/ui";
import type { Route } from "./+types/admin.settings";

/**
 * Settings shell: header + section tabs. The pages live in children —
 * admin.settings._index.tsx (event details + images) and
 * admin.settings.library.tsx — each with its own self-authenticating
 * loader/action.
 */
export async function loader({ context, request }: Route.LoaderArgs) {
	const env = context.cloudflare.env;
	// Self-authenticate — never rely on the admin.tsx layout loader.
	const user = await requireAdmin(env, request);
	const event = await getActiveEvent(env, user);
	return { event: event ? { id: event.id, name: event.name } : null };
}

export default function SettingsLayout({ loaderData }: Route.ComponentProps) {
	if (!loaderData.event) {
		return (
			<div className="mx-auto flex max-w-5xl flex-col gap-5 px-7 py-6">
				<PageHeader title="Event settings" />
				<Panel>
					<EmptyState
						icon="sliders"
						title="No event to configure yet"
						body="Settings, branding, and the library live on an event. Create your first event to get started."
						action={
							<ButtonLink to="/admin/events/new" icon="plus">
								Create an event
							</ButtonLink>
						}
					/>
				</Panel>
			</div>
		);
	}
	return (
		<div className="mx-auto flex max-w-5xl flex-col gap-5 px-7 py-6">
			<PageHeader
				title="Event settings"
				subtitle={loaderData.event.name}
				actions={
					<ButtonLink to="/admin/events/new" variant="ghost" icon="plus">
						New event
					</ButtonLink>
				}
			/>
			<Tabs>
				<Tab to="/admin/settings">Event details</Tab>
				<Tab to="/admin/settings/library">Library</Tab>
			</Tabs>
			<Outlet />
		</div>
	);
}

export function ErrorBoundary() {
	// Generic message only — never render the raw error (it can carry SQL /
	// row values). The detail is in the server logs.
	return (
		<div className="mx-auto max-w-5xl px-7 py-6">
			<PageHeader
				title="Failed to load event settings"
				tone="danger"
				subtitle="Something went wrong. Please refresh or try again."
			/>
		</div>
	);
}
