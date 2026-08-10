import { and, count, desc, eq, or, sql } from "drizzle-orm";
import { Form, data, useSearchParams } from "react-router";
import { getDb } from "~/db";
import { EMAIL_STATUS, emailOutbox, emailTemplates } from "~/db/schema";
import { HistoryDetail } from "~/emails/history-detail";
import { getActiveEvent, requireAdmin } from "~/lib/auth";
import { formatInTimeZone } from "~/lib/dates";
import { createTimings } from "~/lib/track";
import {
	type BadgeTone,
	Button,
	ButtonLink,
	EmptyRow,
	Field,
	PageHeader,
	Panel,
	SearchInput,
	Select,
	StatusBadge,
	Table,
	TableFooter,
	TBody,
	Td,
	TextLink,
	Th,
	THead,
	Tr,
} from "~/ui";
import type { Route } from "./+types/admin.emails_.history";

const PAGE_SIZE = 25;

const STATUS_TONE: Record<string, BadgeTone> = {
	sent: "success",
	queued: "warning",
	failed: "danger",
	bounced: "caution",
};

export function headers({ loaderHeaders }: Route.HeadersArgs) {
	return loaderHeaders;
}

function kindOf(category: string | null): string {
	if (category === "lifecycle") return "Transactional";
	if (category === "custom") return "Announcement";
	return "—";
}

export async function loader({ context, request }: Route.LoaderArgs) {
	const env = context.cloudflare.env;
	const user = await requireAdmin(env, request);
	const event = await getActiveEvent(env, user);
	const statuses = [...EMAIL_STATUS];
	if (!event) {
		return {
			rows: [],
			total: 0,
			page: 1,
			pageSize: PAGE_SIZE,
			statuses,
			detail: null,
			q: "",
			status: "",
		};
	}
	const db = getDb(env);
	const timings = createTimings();
	const url = new URL(request.url);
	const q = url.searchParams.get("q")?.trim() ?? "";
	const statusParam = url.searchParams.get("status") ?? "";
	const status = (EMAIL_STATUS as readonly string[]).includes(statusParam)
		? (statusParam as (typeof EMAIL_STATUS)[number])
		: undefined;
	const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
	const openId = url.searchParams.get("open");

	// Escape LIKE wildcards so searching for "100%" matches literally.
	const escaped = q.replace(/[\\%_]/g, (c) => `\\${c}`);
	const pattern = `%${escaped}%`;
	const where = and(
		eq(emailOutbox.eventId, event.id),
		status ? eq(emailOutbox.status, status) : undefined,
		q
			? or(
					sql`${emailOutbox.to} LIKE ${pattern} ESCAPE '\\'`,
					sql`${emailOutbox.subject} LIKE ${pattern} ESCAPE '\\'`,
				)
			: undefined,
	);

	const [rows, [totalRow], detailRow] = await timings.time("db", () =>
		Promise.all([
			db
				.select({
					id: emailOutbox.id,
					to: emailOutbox.to,
					subject: emailOutbox.subject,
					status: emailOutbox.status,
					sentAt: emailOutbox.sentAt,
					createdAt: emailOutbox.createdAt,
					templateName: emailTemplates.name,
					templateCategory: emailTemplates.category,
				})
				.from(emailOutbox)
				.leftJoin(emailTemplates, eq(emailOutbox.templateId, emailTemplates.id))
				.where(where)
				.orderBy(desc(emailOutbox.createdAt), desc(emailOutbox.id))
				.limit(PAGE_SIZE)
				.offset((page - 1) * PAGE_SIZE),
			db.select({ n: count() }).from(emailOutbox).where(where),
			openId
				? db
						.select({
							id: emailOutbox.id,
							to: emailOutbox.to,
							replyTo: emailOutbox.replyTo,
							subject: emailOutbox.subject,
							status: emailOutbox.status,
							sentAt: emailOutbox.sentAt,
							error: emailOutbox.error,
							icsAttachment: emailOutbox.icsAttachment,
							html: emailOutbox.html,
							templateName: emailTemplates.name,
						})
						.from(emailOutbox)
						.leftJoin(
							emailTemplates,
							eq(emailOutbox.templateId, emailTemplates.id),
						)
						// Scoped to the active event — an id from another event 404s to null.
						.where(
							and(
								eq(emailOutbox.id, openId),
								eq(emailOutbox.eventId, event.id),
							),
						)
						.limit(1)
				: Promise.resolve([]),
		]),
	);

	const tz = event.timezone;
	const open = detailRow[0];
	return data(
		{
			rows: rows.map((r) => ({
				id: r.id,
				to: r.to,
				subject: r.subject,
				status: r.status,
				kind: kindOf(r.templateCategory),
				templateName: r.templateName ?? "—",
				sentAtLabel: formatInTimeZone(r.sentAt ?? r.createdAt, tz),
			})),
			total: totalRow?.n ?? 0,
			page,
			pageSize: PAGE_SIZE,
			statuses,
			q,
			status: status ?? "",
			detail: open
				? {
						to: open.to,
						replyTo: open.replyTo,
						subject: open.subject,
						statusLabel: open.status,
						sentAtLabel: formatInTimeZone(open.sentAt, tz),
						templateName: open.templateName,
						error: open.error,
						hasIcs: Boolean(open.icsAttachment),
						html: open.html,
					}
				: null,
		},
		{ headers: { "Server-Timing": timings.header() } },
	);
}

export default function EmailHistory({ loaderData }: Route.ComponentProps) {
	const { rows, total, page, pageSize, statuses, detail, q, status } =
		loaderData;
	const [searchParams] = useSearchParams();
	const filtered = Boolean(q || status);
	const pageCount = Math.max(1, Math.ceil(total / pageSize));

	const linkWith = (updates: Record<string, string | null>) => {
		const next = new URLSearchParams(searchParams);
		for (const [k, v] of Object.entries(updates)) {
			if (v === null) next.delete(k);
			else next.set(k, v);
		}
		const qs = next.toString();
		return `/admin/emails/history${qs ? `?${qs}` : ""}`;
	};

	return (
		<div className="mx-auto flex max-w-6xl flex-col gap-5 px-7 py-6">
			<PageHeader
				title="Email history"
				count={`${total} ${filtered ? "matching" : "sent"}`}
				subtitle="Every email this event has sent — frozen as delivered, searchable by recipient or subject."
				actions={
					<ButtonLink to="/admin/emails" variant="ghost">
						Edit templates
					</ButtonLink>
				}
			/>

			<Panel>
				<Form method="get" className="flex flex-wrap items-end gap-3">
					<Field label="Search recipient or subject">
						<SearchInput
							name="q"
							defaultValue={q}
							placeholder="e.g. dana.wu or You're in"
						/>
					</Field>
					<Field label="Status">
						<Select name="status" defaultValue={status}>
							<option value="">All statuses</option>
							{statuses.map((s) => (
								<option key={s} value={s}>
									{s}
								</option>
							))}
						</Select>
					</Field>
					<Button type="submit" variant="ghost" icon="filter">
						Filter
					</Button>
				</Form>
			</Panel>

			{detail && (
				<HistoryDetail
					email={detail}
					closeAction={<TextLink to={linkWith({ open: null })}>Close</TextLink>}
				/>
			)}

			<Table>
				<THead>
					<Th>To</Th>
					<Th>Subject</Th>
					<Th>Template</Th>
					<Th>Kind</Th>
					<Th>Status</Th>
					<Th>Sent at</Th>
				</THead>
				<TBody>
					{rows.map((r) => (
						<Tr key={r.id}>
							<Td kind="strong">{r.to}</Td>
							<Td>
								<TextLink to={linkWith({ open: r.id })}>{r.subject}</TextLink>
							</Td>
							<Td>{r.templateName}</Td>
							<Td>{r.kind}</Td>
							<Td>
								<StatusBadge tone={STATUS_TONE[r.status] ?? "neutral"}>
									{r.status}
								</StatusBadge>
							</Td>
							<Td kind="mono">{r.sentAtLabel}</Td>
						</Tr>
					))}
					{rows.length === 0 && (
						<EmptyRow colSpan={6}>
							{filtered
								? "No emails match your search — clear the filters to see everything."
								: "No emails sent yet — sends land here the moment they happen (confirmations, decisions, reminders)."}
						</EmptyRow>
					)}
				</TBody>
			</Table>

			{total > pageSize && (
				<TableFooter>
					<span>
						{(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of{" "}
						{total}
					</span>
					<div className="ml-auto flex gap-4">
						{page > 1 && (
							<TextLink to={linkWith({ page: String(page - 1), open: null })}>
								← Newer
							</TextLink>
						)}
						{page < pageCount && (
							<TextLink to={linkWith({ page: String(page + 1), open: null })}>
								Older →
							</TextLink>
						)}
					</div>
				</TableFooter>
			)}
		</div>
	);
}

export function ErrorBoundary() {
	return (
		<div className="mx-auto max-w-6xl px-7 py-6">
			<PageHeader
				title="Failed to load email history"
				tone="danger"
				subtitle="Something went wrong. Please refresh or try again."
			/>
		</div>
	);
}
