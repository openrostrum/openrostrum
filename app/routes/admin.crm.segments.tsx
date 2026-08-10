import { and, asc, count, eq } from "drizzle-orm";
import { data, Form, redirect } from "react-router";
import { getDb } from "~/db";
import { crmSegments, events } from "~/db/schema";
import {
	countDirectory,
	type DirectoryFilters,
	isCrmContactStatus,
	resolveCrmOrg,
} from "~/domain/crm";
import { requireAdmin } from "~/lib/auth";
import { formatDateUTC } from "~/lib/format";
import { createTimings, track } from "~/lib/track";
import {
	ButtonLink,
	ConfirmButton,
	EmptyRow,
	EmptyState,
	ErrorText,
	Input,
	Panel,
	Table,
	TableFooter,
	TBody,
	Td,
	Th,
	THead,
	Tr,
} from "~/ui";
import type { Route } from "./+types/admin.crm.segments";

const SEGMENTS_SHOWN = 50;

export function headers({ actionHeaders, loaderHeaders }: Route.HeadersArgs) {
	return actionHeaders.has("Server-Timing") ? actionHeaders : loaderHeaders;
}

type StoredFilters = typeof crmSegments.$inferSelect.filters;

function toDirectoryFilters(stored: StoredFilters): DirectoryFilters {
	return {
		q: stored.q ?? null,
		company: stored.company ?? null,
		title: stored.title ?? null,
		eventId: stored.eventId ?? null,
		status: isCrmContactStatus(stored.status) ? stored.status : null,
	};
}

function segmentUrl(id: string, stored: StoredFilters): string {
	const params = new URLSearchParams();
	if (stored.q) params.set("q", stored.q);
	if (stored.company) params.set("company", stored.company);
	if (stored.title) params.set("title", stored.title);
	if (stored.eventId) params.set("event", stored.eventId);
	if (stored.status) params.set("status", stored.status);
	params.set("segment", id);
	return `/admin/crm/directory?${params.toString()}`;
}

export async function loader({ context, request }: Route.LoaderArgs) {
	const env = context.cloudflare.env;
	const user = await requireAdmin(env, request);
	const db = getDb(env);
	const timings = createTimings();
	const org = await timings.time("org", () => resolveCrmOrg(env, db, user));
	if (!org) throw redirect("/admin/crm");
	const { segments, total, eventNames } = await timings.time("db", async () => {
		const [rows, [totalRow], orgEvents] = await Promise.all([
			db
				.select()
				.from(crmSegments)
				.where(eq(crmSegments.organizationId, org.id))
				.orderBy(asc(crmSegments.name))
				.limit(SEGMENTS_SHOWN),
			db
				.select({ n: count() })
				.from(crmSegments)
				.where(eq(crmSegments.organizationId, org.id)),
			db
				.select({ id: events.id, name: events.name })
				.from(events)
				.where(eq(events.organizationId, org.id)),
		]);
		// Segments are dynamic: membership is computed live from the same
		// predicate the directory filters with, never stored.
		const members = await Promise.all(
			rows.map((s) =>
				countDirectory(db, org.id, toDirectoryFilters(s.filters)),
			),
		);
		return {
			segments: rows.map((s, i) => ({
				id: s.id,
				name: s.name,
				filters: s.filters,
				members: members[i] ?? 0,
				createdAt: s.createdAt,
			})),
			total: totalRow?.n ?? 0,
			eventNames: new Map(orgEvents.map((e) => [e.id, e.name])),
		};
	});
	return data(
		{
			segments: segments.map((s) => ({
				...s,
				summary: filterSummary(s.filters, eventNames),
				url: segmentUrl(s.id, s.filters),
			})),
			total,
		},
		{ headers: { "Server-Timing": timings.header() } },
	);
}

function filterSummary(
	stored: StoredFilters,
	eventNames: Map<string, string>,
): string {
	const parts: string[] = [];
	if (stored.q) parts.push(`search "${stored.q}"`);
	if (stored.company) parts.push(`company "${stored.company}"`);
	if (stored.title) parts.push(`title "${stored.title}"`);
	if (stored.eventId) {
		parts.push(`event ${eventNames.get(stored.eventId) ?? "(deleted event)"}`);
	}
	if (stored.status) parts.push(`status ${stored.status}`);
	return parts.join(" · ") || "no filters";
}

export async function action({ context, request }: Route.ActionArgs) {
	const env = context.cloudflare.env;
	// Actions MUST self-authenticate — a POST does not re-run the layout loader.
	const user = await requireAdmin(env, request);
	const db = getDb(env);
	const org = await resolveCrmOrg(env, db, user);
	if (!org) return { formError: "No organization is configured yet." };
	const form = await request.formData();
	if (form.get("intent") !== "delete") {
		return { formError: "Unknown action." };
	}
	const segmentId = String(form.get("segmentId") ?? "");
	const timings = createTimings();
	// Org-scoped delete: a foreign segment id deletes nothing.
	const deleted = await timings.time("db", () =>
		db
			.delete(crmSegments)
			.where(
				and(
					eq(crmSegments.id, segmentId),
					eq(crmSegments.organizationId, org.id),
				),
			)
			.returning({ id: crmSegments.id }),
	);
	if (deleted.length === 0) {
		return { formError: "That segment does not belong to your organization." };
	}
	track("crm.segment_deleted", { orgId: org.id, segmentId });
	return data(
		{ notice: "Segment deleted." },
		{ headers: { "Server-Timing": timings.header() } },
	);
}

export default function CrmSegments({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { segments, total } = loaderData;
	const formError =
		actionData && "formError" in actionData ? actionData.formError : undefined;
	const notice =
		actionData && "notice" in actionData ? actionData.notice : undefined;

	if (segments.length === 0) {
		return (
			<Panel>
				<EmptyState
					icon="filter"
					title="No saved segments yet"
					body="Filter the directory — by search, company, title, event, or status — then save the filter set as a named segment. Segments are dynamic: they always show whoever matches right now."
					action={
						<ButtonLink to="/admin/crm/directory" icon="users">
							Open the directory
						</ButtonLink>
					}
				/>
			</Panel>
		);
	}

	return (
		<div className="flex flex-col gap-5">
			{(notice || formError) && (
				<div className="flex items-center gap-3">
					{notice && <p>{notice}</p>}
					{formError && <ErrorText>{formError}</ErrorText>}
				</div>
			)}
			<Table>
				<THead>
					<Th>Segment</Th>
					<Th>Filters</Th>
					<Th>People</Th>
					<Th>Saved</Th>
					<Th />
				</THead>
				<TBody>
					{segments.map((s) => (
						<Tr key={s.id}>
							<Td kind="strong">{s.name}</Td>
							<Td>{s.summary}</Td>
							<Td kind="mono">{s.members}</Td>
							<Td kind="mono">{formatDateUTC(s.createdAt)}</Td>
							<Td>
								<div className="flex items-center justify-end gap-2">
									<ButtonLink to={s.url} variant="ghost">
										Open
									</ButtonLink>
									<Form method="post">
										<Input
											type="hidden"
											name="segmentId"
											value={s.id}
											readOnly
										/>
										<ConfirmButton
											label="Delete"
											prompt={`Delete “${s.name}”? People in it are unaffected.`}
											confirmLabel="Delete segment"
											name="intent"
											value="delete"
										/>
									</Form>
								</div>
							</Td>
						</Tr>
					))}
					{total > segments.length && (
						<EmptyRow colSpan={5}>
							Showing the first {segments.length} of {total} segments.
						</EmptyRow>
					)}
				</TBody>
			</Table>
			{total > 0 && (
				<TableFooter>
					<span>
						{segments.length} of {total} segments
					</span>
				</TableFooter>
			)}
		</div>
	);
}

export function ErrorBoundary() {
	return (
		<Panel>
			<EmptyState
				icon="filter"
				title="Failed to load segments"
				body="Something went wrong. Please refresh or try again."
			/>
		</Panel>
	);
}
