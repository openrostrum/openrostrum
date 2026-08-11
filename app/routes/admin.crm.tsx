import { count, eq } from "drizzle-orm";
import { data, Outlet, useLocation } from "react-router";
import { getDb } from "~/db";
import { crmSegments, pipelineCards } from "~/db/schema";
import { countDirectory } from "~/domain/crm";
import { requireAdmin, resolveActiveOrg } from "~/lib/auth";
import { createTimings } from "~/lib/track";
import { ButtonLink, EmptyState, PageHeader, Panel, Tab, Tabs } from "~/ui";
import type { Route } from "./+types/admin.crm";

export function headers({ loaderHeaders }: Route.HeadersArgs) {
	return loaderHeaders;
}

/**
 * Speaker CRM shell: header + module tabs. The modules live in children —
 * overview, directory, pipeline, segments — each with its own
 * self-authenticating loader/action; this layout only paints chrome.
 */
export async function loader({ context, request }: Route.LoaderArgs) {
	const env = context.cloudflare.env;
	// Self-authenticate — never rely on the admin.tsx layout loader.
	const user = await requireAdmin(env, request);
	const db = getDb(env);
	const timings = createTimings();
	const org = await timings.time("org", () => resolveActiveOrg(env, user));
	if (!org) {
		return data(
			{ org: null, counts: null },
			{ headers: { "Server-Timing": timings.header() } },
		);
	}
	const [people, [cardRow], [segmentRow]] = await timings.time("counts", () =>
		Promise.all([
			countDirectory(db, org.id, {}),
			db
				.select({ n: count() })
				.from(pipelineCards)
				.where(eq(pipelineCards.organizationId, org.id)),
			db
				.select({ n: count() })
				.from(crmSegments)
				.where(eq(crmSegments.organizationId, org.id)),
		]),
	);
	return data(
		{
			org: { id: org.id, name: org.name },
			counts: {
				people,
				cards: cardRow?.n ?? 0,
				segments: segmentRow?.n ?? 0,
			},
		},
		{ headers: { "Server-Timing": timings.header() } },
	);
}

export default function CrmShell({ loaderData }: Route.ComponentProps) {
	const { org, counts } = loaderData;
	const { pathname } = useLocation();
	if (!org) {
		return (
			<div className="mx-auto flex max-w-6xl flex-col gap-5 px-7 py-6">
				<PageHeader title="Speaker CRM" />
				<Panel>
					<EmptyState
						icon="users"
						title="No organization yet"
						body="The Speaker CRM sits above your events — one directory of every person across your organization. Create your organization and first event to get started."
						action={
							<ButtonLink to="/onboarding" icon="plus">
								Set up your organization
							</ButtonLink>
						}
					/>
				</Panel>
			</div>
		);
	}
	return (
		<div className="mx-auto flex max-w-6xl flex-col gap-5 px-7 py-6">
			<PageHeader
				title="Speaker CRM"
				subtitle={`${org.name} — every speaker and contact across your organization's events, in one place.`}
			/>
			<Tabs>
				<Tab to="/admin/crm" active={pathname === "/admin/crm"}>
					Overview
				</Tab>
				<Tab
					to="/admin/crm/directory"
					active={
						pathname.startsWith("/admin/crm/directory") ||
						pathname.startsWith("/admin/crm/person")
					}
					count={counts?.people}
				>
					Directory
				</Tab>
				<Tab
					to="/admin/crm/pipeline"
					active={pathname.startsWith("/admin/crm/pipeline")}
					count={counts?.cards}
				>
					Pipeline
				</Tab>
				<Tab
					to="/admin/crm/segments"
					active={pathname.startsWith("/admin/crm/segments")}
					count={counts?.segments}
				>
					Segments
				</Tab>
				<Tab
					to="/admin/crm/fields"
					active={pathname.startsWith("/admin/crm/fields")}
				>
					Fields
				</Tab>
			</Tabs>
			<Outlet />
		</div>
	);
}

export function ErrorBoundary() {
	// Generic message only — never render the raw error (it can carry SQL /
	// row values). The detail is in the server logs.
	return (
		<div className="mx-auto max-w-6xl px-7 py-6">
			<PageHeader
				title="Failed to load the Speaker CRM"
				tone="danger"
				subtitle="Something went wrong. Please refresh or try again."
			/>
		</div>
	);
}
