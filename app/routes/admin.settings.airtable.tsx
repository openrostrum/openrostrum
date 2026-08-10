import { count, inArray } from "drizzle-orm";
import { Form, data, redirect, useNavigation } from "react-router";
import { getDb } from "~/db";
import { airtableLinks } from "~/db/schema";
import { SYNCED_TABLES, TABLE_MAPS } from "~/lib/airtable-map";
import { getActiveEvent, requireAdmin } from "~/lib/auth";
import { createTimings } from "~/lib/track";
import {
	DEMO_ORG_ID,
	readLastWebhookPing,
	readSyncState,
	runAirtableSync,
	type TableRunStats,
} from "~/sync/runner";
import {
	Button,
	EmptyState,
	ErrorText,
	PageHeader,
	Panel,
	StatusBadge,
	Table,
	TBody,
	Td,
	Th,
	THead,
	Tr,
} from "~/ui";
import type { Route } from "./+types/admin.settings.airtable";

const NOT_CONFIGURED_FOR_ORG =
	"Airtable isn't configured for this organization.";

export function headers({ loaderHeaders }: Route.HeadersArgs) {
	return loaderHeaders;
}

export async function loader({ context, request }: Route.LoaderArgs) {
	const env = context.cloudflare.env;
	// Self-authenticate — never rely on the admin.tsx layout loader.
	const user = await requireAdmin(env, request);
	const event = await getActiveEvent(env, user);
	const url = new URL(request.url);
	const flash = url.searchParams.get("sync");

	if (!event) {
		return data({ state: "no_event" as const, flash });
	}
	// The env-configured base is bound to the Demo organization — other
	// organizations get this explicit state, never a silent no-op
	// (docs/multi-tenancy-design.md §Airtable).
	if (event.organizationId !== DEMO_ORG_ID) {
		return data({ state: "org_unbound" as const, flash });
	}
	if (!env.AIRTABLE_API_KEY || !env.AIRTABLE_BASE_ID) {
		return data({ state: "env_unconfigured" as const, flash });
	}

	const db = getDb(env);
	const timings = createTimings();
	const { linkCounts, syncState, lastPingAt } = await timings.time(
		"db",
		async () => ({
			linkCounts: await db
				.select({ tableName: airtableLinks.tableName, linked: count() })
				.from(airtableLinks)
				.where(inArray(airtableLinks.tableName, [...SYNCED_TABLES]))
				.groupBy(airtableLinks.tableName),
			syncState: await readSyncState(db),
			lastPingAt: await readLastWebhookPing(db),
		}),
	);
	const countByTable = new Map(linkCounts.map((c) => [c.tableName, c.linked]));
	return data(
		{
			state: "ready" as const,
			flash,
			webhook: {
				secretSet: Boolean(env.AIRTABLE_WEBHOOK_SECRET),
				refreshConfigured: Boolean(env.AIRTABLE_WEBHOOK_ID),
				// Liveness evidence — a received ping, never inferred from config.
				lastPingAt,
			},
			recentConflicts: syncState.recentConflicts ?? [],
			paused: syncState.pausedAt
				? { at: syncState.pausedAt, reason: syncState.pausedReason ?? "" }
				: null,
			lastRun: syncState.lastRunAt
				? {
						at: syncState.lastRunAt,
						trigger: syncState.lastRunTrigger ?? "unknown",
						status: syncState.lastRunStatus ?? "ok",
						tables: syncState.lastRunTables ?? null,
						error: syncState.lastError ?? null,
					}
				: null,
			tables: SYNCED_TABLES.map((t) => ({
				table: t,
				airtableTable: TABLE_MAPS[t].airtableTable,
				linked: countByTable.get(t) ?? 0,
			})),
		},
		{ headers: { "Server-Timing": timings.header() } },
	);
}

export async function action({ context, request }: Route.ActionArgs) {
	const env = context.cloudflare.env;
	// Actions self-authenticate — a POST never runs the layout loader.
	const user = await requireAdmin(env, request);
	const event = await getActiveEvent(env, user);
	if (!event || event.organizationId !== DEMO_ORG_ID) {
		return { formError: NOT_CONFIGURED_FOR_ORG };
	}
	if (!env.AIRTABLE_API_KEY || !env.AIRTABLE_BASE_ID) {
		return {
			formError:
				"AIRTABLE_API_KEY and AIRTABLE_BASE_ID are not set for this deployment.",
		};
	}
	const form = await request.formData();
	const intent = form.get("intent");
	if (intent !== "sync" && intent !== "resume") {
		return { formError: "Unknown action." };
	}
	// Airtable I/O never runs in the request path — the tick continues after
	// this response returns; the page shows the recorded outcome on reload.
	context.cloudflare.ctx.waitUntil(
		runAirtableSync(env, {
			trigger: "manual",
			acknowledgeDeletions: intent === "resume",
		}),
	);
	return redirect(
		`/admin/settings/airtable?sync=${intent === "resume" ? "resumed" : "started"}`,
	);
}

const timeFormat = new Intl.DateTimeFormat("en-US", {
	month: "short",
	day: "numeric",
	hour: "numeric",
	minute: "2-digit",
	timeZoneName: "short",
});

function formatTime(iso: string): string {
	const parsed = new Date(iso);
	return Number.isNaN(parsed.getTime()) ? iso : timeFormat.format(parsed);
}

const RUN_STATUS_TONE = {
	ok: "success",
	failed: "danger",
	breaker_tripped: "caution",
} as const;

function runSummary(stats: TableRunStats): string {
	const parts: string[] = [];
	if (stats.created) parts.push(`${stats.created} created`);
	if (stats.pushed) parts.push(`${stats.pushed} pushed`);
	if (stats.pulled) parts.push(`${stats.pulled} pulled`);
	if (stats.conflicts)
		parts.push(`${stats.conflicts} conflicts (Airtable won)`);
	if (stats.rejected) parts.push(`${stats.rejected} rejected`);
	if (stats.archived) parts.push(`${stats.archived} archived`);
	if (stats.deletedRemote) parts.push(`${stats.deletedRemote} deleted`);
	if (stats.refusedLinks) parts.push(`${stats.refusedLinks} links refused`);
	return parts.length > 0 ? parts.join(" · ") : "no changes";
}

export default function AirtableSync({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const navigation = useNavigation();
	const busy = navigation.state !== "idle";

	if (loaderData.state === "no_event") {
		return (
			<Page>
				<Panel>
					<EmptyState
						icon="sliders"
						title="No event yet"
						body="Create your first event and Airtable sync options will appear here."
					/>
				</Panel>
			</Page>
		);
	}

	if (loaderData.state === "org_unbound") {
		return (
			<Page>
				<Panel>
					<EmptyState
						icon="sliders"
						title={NOT_CONFIGURED_FOR_ORG}
						body="This deployment's Airtable base is connected to a different organization. Per-organization Airtable credentials are on the roadmap — until then, sync stays off here rather than mixing tenants."
					/>
				</Panel>
			</Page>
		);
	}

	if (loaderData.state === "env_unconfigured") {
		return (
			<Page>
				<Panel>
					<EmptyState
						icon="sliders"
						title="Airtable isn't connected"
						body="Set AIRTABLE_API_KEY and AIRTABLE_BASE_ID for this deployment to mirror sessions, contacts, and task assignments into your team's base."
					/>
				</Panel>
			</Page>
		);
	}

	const { flash, webhook, recentConflicts, paused, lastRun, tables } =
		loaderData;
	const linkedTotal = tables.reduce((n, t) => n + t.linked, 0);

	return (
		<Page
			count={`${linkedTotal} linked`}
			actions={
				!paused ? (
					<Form method="post">
						<Button type="submit" name="intent" value="sync" disabled={busy}>
							Sync now
						</Button>
					</Form>
				) : undefined
			}
		>
			{actionData?.formError && <ErrorText>{actionData.formError}</ErrorText>}
			{flash === "started" && (
				<Panel>
					<p>
						Sync started in the background — reload in a moment to see the
						outcome below.
					</p>
				</Panel>
			)}
			{flash === "resumed" && (
				<Panel>
					<p>
						Sync resumed — the pending Airtable deletions are being applied in
						the background.
					</p>
				</Panel>
			)}

			{paused && (
				<Panel>
					<div className="flex flex-col gap-3">
						<div className="flex items-center gap-2">
							<StatusBadge tone="danger">Sync paused</StatusBadge>
							<span>since {formatTime(paused.at)}</span>
						</div>
						<p>{paused.reason}</p>
						<Form method="post">
							<Button
								type="submit"
								name="intent"
								value="resume"
								disabled={busy}
							>
								Resume and apply the deletions
							</Button>
						</Form>
					</div>
				</Panel>
			)}

			<Panel>
				<div className="flex flex-wrap items-center gap-3">
					<StatusBadge
						tone={lastRun ? RUN_STATUS_TONE[lastRun.status] : "faint"}
					>
						{lastRun
							? lastRun.status === "ok"
								? "Last sync succeeded"
								: lastRun.status === "failed"
									? "Last sync failed"
									: "Circuit breaker tripped"
							: "Never synced"}
					</StatusBadge>
					{lastRun && (
						<span>
							{formatTime(lastRun.at)} · trigger: {lastRun.trigger}
						</span>
					)}
					<StatusBadge tone={webhook.lastPingAt ? "success" : "neutral"}>
						{webhook.lastPingAt
							? `Webhook ping received ${formatTime(webhook.lastPingAt)}`
							: webhook.secretSet
								? "Webhook secret set — no ping received yet"
								: "No webhook — background poll only"}
					</StatusBadge>
					{webhook.secretSet && !webhook.refreshConfigured && (
						<span>
							AIRTABLE_WEBHOOK_ID is unset, so the poll cannot refresh the
							webhook&apos;s 7-day expiry.
						</span>
					)}
				</div>
				{lastRun?.error && <ErrorText>{lastRun.error}</ErrorText>}
			</Panel>

			{recentConflicts.length > 0 && (
				<Panel>
					<div className="flex flex-col gap-3">
						<div className="flex items-center gap-2">
							<StatusBadge tone="info">Recent conflicts</StatusBadge>
							<span>
								Both sides had edited these fields — Airtable&apos;s value won.
							</span>
						</div>
						<Table>
							<THead>
								<Th>When</Th>
								<Th>Table</Th>
								<Th>Record</Th>
								<Th>Field</Th>
							</THead>
							<TBody>
								{recentConflicts.map((c) => (
									<Tr key={`${c.at}:${c.table}:${c.recordId}:${c.field}`}>
										<Td kind="mono">{formatTime(c.at)}</Td>
										<Td>{c.table}</Td>
										<Td kind="mono">{c.recordId}</Td>
										<Td>{c.field}</Td>
									</Tr>
								))}
							</TBody>
						</Table>
					</div>
				</Panel>
			)}

			<Table>
				<THead>
					<Th>App table</Th>
					<Th>Airtable table</Th>
					<Th>Linked records</Th>
					<Th>Last run</Th>
				</THead>
				<TBody>
					{tables.map((t) => {
						const stats = lastRun?.tables?.[t.table];
						return (
							<Tr key={t.table}>
								<Td kind="strong">{t.table}</Td>
								<Td>{t.airtableTable}</Td>
								<Td kind="mono">{t.linked}</Td>
								<Td>{stats ? runSummary(stats) : "—"}</Td>
							</Tr>
						);
					})}
				</TBody>
			</Table>
		</Page>
	);
}

function Page({
	children,
	count,
	actions,
}: {
	children: React.ReactNode;
	count?: string;
	actions?: React.ReactNode;
}) {
	return (
		<div className="mx-auto flex max-w-5xl flex-col gap-5 px-7 py-6">
			<PageHeader
				title="Airtable sync"
				count={count}
				actions={actions}
				subtitle="Two-way mirror of sessions, contacts, and task assignments. The app pushes its changes; team edits in Airtable flow back, and Airtable wins conflicts on team-editable fields."
			/>
			{children}
		</div>
	);
}

export function ErrorBoundary() {
	return (
		<div className="mx-auto max-w-5xl px-7 py-6">
			<PageHeader
				title="Failed to load Airtable sync"
				tone="danger"
				subtitle="Something went wrong. Please refresh or try again."
			/>
		</div>
	);
}
