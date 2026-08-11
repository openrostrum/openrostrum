import { data, Link } from "react-router";
import { getDb } from "~/db";
import { StatCard } from "~/components/stat-card";
import { queryCrmDashboard } from "~/domain/crm";
import { requireAdmin, resolveActiveOrg } from "~/lib/auth";
import { formatDateUTC } from "~/lib/format";
import { PIPELINE_STAGE_LABEL, PIPELINE_STAGE_TONE } from "~/lib/pipeline";
import { createTimings } from "~/lib/track";
import {
	ButtonLink,
	EmptyState,
	Panel,
	StatusBadge,
	Table,
	TBody,
	Td,
	TextLink,
	Th,
	THead,
	Tr,
} from "~/ui";
import type { Route } from "./+types/admin.crm._index";

export function headers({ loaderHeaders }: Route.HeadersArgs) {
	return loaderHeaders;
}

export async function loader({ context, request }: Route.LoaderArgs) {
	const env = context.cloudflare.env;
	// Self-authenticate — never rely on the admin.tsx layout loader.
	const user = await requireAdmin(env, request);
	const db = getDb(env);
	const timings = createTimings();
	const org = await timings.time("org", () => resolveActiveOrg(env, user));
	// No org: return empty data instead of redirecting — this route IS
	// /admin/crm, so a redirect here would loop; the shell layout renders the
	// "No organization yet" state and never mounts this component.
	if (!org) {
		return data(
			{ dashboard: null },
			{ headers: { "Server-Timing": timings.header() } },
		);
	}
	const dashboard = await timings.time("db", () =>
		queryCrmDashboard(db, org.id),
	);
	return data(
		{ dashboard },
		{ headers: { "Server-Timing": timings.header() } },
	);
}

export default function CrmOverview({ loaderData }: Route.ComponentProps) {
	const d = loaderData.dashboard;
	if (!d) return null; // the shell's no-org empty state owns this render

	if (d.people === 0) {
		return (
			<Panel>
				<EmptyState
					icon="users"
					title="Your speaker database is empty"
					body="The CRM unions every event's contacts into one cross-event directory. Add speakers to an event — by hand, from submissions, or with a CSV import — and the numbers light up here."
					action={
						<ButtonLink to="/admin/contacts" icon="plus">
							Go to the event roster
						</ButtonLink>
					}
				/>
			</Panel>
		);
	}

	return (
		<div className="flex flex-col gap-5">
			<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
				<StatCard
					label="People"
					value={d.people}
					hint={<TextLink to="/admin/crm/directory">Open directory</TextLink>}
				/>
				<StatCard label="Events" value={d.eventCount} />
				<StatCard
					label="Returning speakers"
					value={d.returningSpeakers}
					hint="People appearing in two or more events"
				/>
				<StatCard
					label="In pipeline"
					value={d.inPipeline}
					hint={<TextLink to="/admin/crm/pipeline">Open pipeline</TextLink>}
				/>
			</div>

			<div className="grid items-start gap-5 lg:grid-cols-2">
				<Table>
					<THead>
						<Th>Pipeline stage</Th>
						<Th>Prospects</Th>
					</THead>
					<TBody>
						{d.byStage.map((row) => (
							<Tr key={row.stage}>
								<Td>
									<StatusBadge tone={PIPELINE_STAGE_TONE[row.stage]}>
										{PIPELINE_STAGE_LABEL[row.stage]}
									</StatusBadge>
								</Td>
								<Td kind="mono">
									{row.n > 0 ? (
										<Link to="/admin/crm/pipeline">{row.n}</Link>
									) : (
										row.n
									)}
								</Td>
							</Tr>
						))}
					</TBody>
				</Table>

				<div className="flex flex-col gap-5">
					<Table>
						<THead>
							<Th>Top companies</Th>
							<Th>People</Th>
						</THead>
						<TBody>
							{d.topCompanies.map((c) => (
								<Tr key={c.companyName}>
									<Td kind="strong">
										<Link
											to={`/admin/crm/directory?company=${encodeURIComponent(c.companyName ?? "")}`}
										>
											{c.companyName}
										</Link>
									</Td>
									<Td kind="mono">{c.people}</Td>
								</Tr>
							))}
							{d.topCompanies.length === 0 && (
								<Tr>
									<Td>No company data on record yet</Td>
									<Td kind="mono">—</Td>
								</Tr>
							)}
						</TBody>
					</Table>

					<Table>
						<THead>
							<Th>Most active events</Th>
							<Th>Contacts</Th>
						</THead>
						<TBody>
							{d.topEvents.map((e) => (
								<Tr key={e.eventId}>
									<Td kind="strong">
										<Link to={`/admin/crm/directory?event=${e.eventId}`}>
											{e.name}
										</Link>
									</Td>
									<Td kind="mono">{e.contacts}</Td>
								</Tr>
							))}
						</TBody>
					</Table>
				</div>
			</div>

			<Table>
				<THead>
					<Th>Recent additions</Th>
					<Th>Email</Th>
					<Th>First seen</Th>
				</THead>
				<TBody>
					{d.recentPeople.map((p) => (
						<Tr key={p.email}>
							<Td kind="strong">
								<Link to={`/admin/crm/person/${encodeURIComponent(p.email)}`}>
									{`${p.firstName} ${p.lastName}`.trim()}
								</Link>
							</Td>
							<Td kind="mono">{p.email}</Td>
							<Td kind="mono">{formatDateUTC(p.firstSeenAt)}</Td>
						</Tr>
					))}
				</TBody>
			</Table>
		</div>
	);
}

export function ErrorBoundary() {
	return (
		<Panel>
			<EmptyState
				icon="users"
				title="Failed to load the CRM overview"
				body="Something went wrong. Please refresh or try again."
			/>
		</Panel>
	);
}
