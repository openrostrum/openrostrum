import { useState } from "react";
import { CopyButton } from "~/components/copy-button";
import { data, Form, useOutlet } from "react-router";
import { and, desc, eq, gt, isNull, lte, or, sql } from "drizzle-orm";
import { getDb } from "~/db";
import { forms, submissions } from "~/db/schema";
import { adminFormPath, cfpPath } from "~/domain/forms";
import { getActiveEvent, requireAdmin } from "~/lib/auth";
import { effectiveFormStatus, FORM_STATUS_TONE } from "~/lib/forms";
import { likeContains } from "~/lib/like";
import { createTimings } from "~/lib/track";
import { useBusy } from "~/lib/use-busy";
import {
	Button,
	ButtonLink,
	DialogSurface,
	EmptyState,
	Icon,
	Input,
	MenuItem,
	NoteText,
	PageHeader,
	Panel,
	PopoverSurface,
	SearchInput,
	StatusBadge,
	Tab,
	TableFooter,
	Tabs,
} from "~/ui";
import type { Route } from "./+types/admin.forms";

const PAGE_SIZE = 50;

type FormRow = {
	id: string;
	internalName: string;
	typeLabel: string;
	rawStatus: "draft" | "open" | "closed";
	status: "draft" | "open" | "closed";
	submissionsCount: number;
	draftsCount: number;
	closesLabel: string | null;
	createdLabel: string;
	shareUrl: string | null;
};

// Without this export, RR7 drops loader headers from DOCUMENT responses —
// Server-Timing would silently vanish on full page loads.
export function headers({ loaderHeaders }: Route.HeadersArgs) {
	return loaderHeaders;
}
export async function loader({ context, request }: Route.LoaderArgs) {
	const env = context.cloudflare.env;
	const user = await requireAdmin(env, request);
	const event = await getActiveEvent(env, user);
	const url = new URL(request.url);
	const q = url.searchParams.get("q")?.trim() ?? "";
	const tab = url.searchParams.get("tab") ?? "all";
	const origin = url.origin;
	const empty = {
		forms: [] as FormRow[],
		tabCounts: { all: 0, open: 0, closed: 0, draft: 0 },
		q,
		tab,
		page: 1,
		pages: 1,
		total: 0,
		hasEvent: event !== null,
	};
	// Flat routes also make this file the layout for the $formId editor — when
	// a child route is rendering, the list data would be thrown away unseen.
	if (url.pathname.replace(/\/+$/, "") !== "/admin/forms") return data(empty);
	if (!event) return data(empty);

	const db = getDb(env);
	const timings = createTimings();
	const now = new Date();
	const base = and(
		eq(forms.eventId, event.id),
		q
			? or(
					likeContains(forms.internalName, q),
					likeContains(forms.externalTitle, q),
				)
			: undefined,
	);
	// Effective-status predicates: a backdated close date closes an OPEN form
	// without any status flip (see effectiveFormStatus).
	const statusPredicate = {
		draft: eq(forms.status, "draft"),
		open: and(
			eq(forms.status, "open"),
			or(isNull(forms.closeAt), gt(forms.closeAt, now)),
		),
		closed: or(
			eq(forms.status, "closed"),
			and(eq(forms.status, "open"), lte(forms.closeAt, now)),
		),
	} as const;
	const tabbed =
		tab === "open" || tab === "closed" || tab === "draft"
			? and(base, statusPredicate[tab])
			: base;

	const countWhere = async (predicate: typeof base) => {
		const [row] = await db
			.select({ n: sql<number>`count(*)` })
			.from(forms)
			.where(predicate);
		return row?.n ?? 0;
	};
	const [all, open, closed, draft] = await timings.time("tabs", () =>
		Promise.all([
			countWhere(base),
			countWhere(and(base, statusPredicate.open)),
			countWhere(and(base, statusPredicate.closed)),
			countWhere(and(base, statusPredicate.draft)),
		]),
	);
	const tabCounts = { all, open, closed, draft };
	const total =
		tab === "open" || tab === "closed" || tab === "draft"
			? tabCounts[tab]
			: all;
	const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
	const page = Math.min(
		pages,
		Math.max(1, Number(url.searchParams.get("page")) || 1),
	);

	const rows = await timings.time("db", () =>
		db
			.select()
			.from(forms)
			.where(tabbed)
			.orderBy(desc(forms.createdAt))
			.limit(PAGE_SIZE)
			.offset((page - 1) * PAGE_SIZE),
	);
	const subCounts = await timings.time("counts", () =>
		db
			.select({
				formId: submissions.formId,
				total: sql<number>`count(*)`,
				drafts: sql<number>`coalesce(sum(case when ${submissions.status} = 'draft' then 1 else 0 end), 0)`,
			})
			.from(submissions)
			.where(eq(submissions.eventId, event.id))
			.groupBy(submissions.formId),
	);
	const countsByForm = new Map(subCounts.map((c) => [c.formId, c]));

	const dateFmt = new Intl.DateTimeFormat("en-US", {
		timeZone: event.timezone,
		dateStyle: "medium",
	});
	const decorated: FormRow[] = rows.map((f) => {
		const c = countsByForm.get(f.id);
		const status = effectiveFormStatus(f.status, f.closeAt, now.getTime());
		return {
			id: f.id,
			internalName: f.internalName,
			typeLabel:
				(f.type === "abstract" ? "Abstracts" : "Sessions") +
				(f.participantsStep ? " & Participants" : ""),
			rawStatus: f.status,
			status,
			submissionsCount: (c?.total ?? 0) - (c?.drafts ?? 0),
			draftsCount: c?.drafts ?? 0,
			closesLabel: f.closeAt ? dateFmt.format(f.closeAt) : null,
			createdLabel: dateFmt.format(f.createdAt),
			shareUrl: status === "open" ? `${origin}${cfpPath(event.slug)}` : null,
		};
	});

	return data(
		{ forms: decorated, tabCounts, q, tab, page, pages, total, hasEvent: true },
		{ headers: { "Server-Timing": timings.header() } },
	);
}

/** Shared by the list and the editor's results views (this file is the
 * editor's flat-route layout, so it is always in both bundles). */
export function PaginationBar({
	page,
	pages,
	total,
	hrefFor,
}: {
	page: number;
	pages: number;
	total: number;
	hrefFor: (page: number) => string;
}) {
	if (pages <= 1) return null;
	return (
		<div className="flex items-center gap-2">
			<TableFooter>
				Page {page} of {pages} · {total} total
			</TableFooter>
			<div className="ml-auto flex gap-2">
				{page > 1 && (
					<ButtonLink variant="ghost" to={hrefFor(page - 1)}>
						← Previous
					</ButtonLink>
				)}
				{page < pages && (
					<ButtonLink variant="ghost" to={hrefFor(page + 1)}>
						Next →
					</ButtonLink>
				)}
			</div>
		</div>
	);
}

function listHref(tab: string, q: string, page = 1): string {
	const params = new URLSearchParams();
	if (tab !== "all") params.set("tab", tab);
	if (q) params.set("q", q);
	if (page > 1) params.set("page", String(page));
	const qs = params.toString();
	return qs ? `/admin/forms?${qs}` : "/admin/forms";
}

function NewFormButton() {
	const busy = useBusy();
	return (
		<Form method="post" action="/admin/forms/new">
			<Input type="hidden" name="intent" value="create" readOnly />
			<Button type="submit" icon="plus" disabled={busy}>
				New form
			</Button>
		</Form>
	);
}

function FormActionsMenu({
	form,
	onDelete,
}: {
	form: FormRow;
	onDelete: () => void;
}) {
	const busy = useBusy();
	return (
		<details className="relative">
			<summary
				className="flex h-[34px] w-[34px] cursor-pointer list-none items-center justify-center [&::-webkit-details-marker]:hidden"
				aria-label={`Actions for ${form.internalName}`}
			>
				<Icon name="dots" />
			</summary>
			<PopoverSurface side="bottom" align="end" width="md" padding="menu">
				<MenuItem to={adminFormPath(form.id)}>Edit</MenuItem>
				{form.rawStatus !== "open" && (
					<Form method="post" action={adminFormPath(form.id)}>
						<Input type="hidden" name="intent" value="publish" readOnly />
						<MenuItem type="submit" disabled={busy}>
							Open form
						</MenuItem>
					</Form>
				)}
				<MenuItem to={`${adminFormPath(form.id)}?view=results`}>
					View results
				</MenuItem>
				<MenuItem to={`${adminFormPath(form.id)}?view=drafts`}>
					View draft submissions
				</MenuItem>
				<Form method="post" action={adminFormPath(form.id)}>
					<Input type="hidden" name="intent" value="duplicate" readOnly />
					<MenuItem type="submit" disabled={busy}>
						Duplicate
					</MenuItem>
				</Form>
				<MenuItem type="button" disabled={busy} onClick={onDelete}>
					Delete
				</MenuItem>
			</PopoverSurface>
		</details>
	);
}

function DeleteFormDialog({
	form,
	onCancel,
}: {
	form: FormRow;
	onCancel: () => void;
}) {
	const busy = useBusy();
	return (
		<DialogSurface
			role="alertdialog"
			size="sm"
			ariaLabel={`Delete ${form.internalName}`}
			onDismiss={onCancel}
		>
			<div className="flex flex-col gap-3">
				<strong>Delete “{form.internalName}”?</strong>
				<p>
					The form and its questions are removed permanently and its public link
					stops working. Submissions already received are kept — they just lose
					their link to this form.
				</p>
				<div className="flex justify-end gap-2">
					<Button variant="ghost" type="button" onClick={onCancel}>
						Cancel
					</Button>
					<Form method="post" action={adminFormPath(form.id)}>
						<Input type="hidden" name="intent" value="delete" readOnly />
						<Button type="submit" disabled={busy}>
							Delete form
						</Button>
					</Form>
				</div>
			</div>
		</DialogSurface>
	);
}

export default function FormsList({ loaderData }: Route.ComponentProps) {
	const {
		forms: rows,
		tabCounts,
		q,
		tab,
		page,
		pages,
		total,
		hasEvent,
	} = loaderData;
	const [deleteId, setDeleteId] = useState<string | null>(null);
	const deleteTarget = rows.find((f) => f.id === deleteId) ?? null;
	// Flat routes make this file the LAYOUT for admin.forms.$formId — when the
	// editor matches, it replaces the list rather than nesting inside it.
	const outlet = useOutlet();
	if (outlet) return outlet;

	return (
		<div className="mx-auto flex max-w-5xl flex-col gap-5 px-7 py-6">
			<PageHeader
				title="Forms"
				count={`${tabCounts.all} total`}
				subtitle="Collect abstract, session and participant information."
				actions={hasEvent ? <NewFormButton /> : undefined}
			/>

			<Form method="get" className="flex items-center gap-2">
				{tab !== "all" && (
					<Input type="hidden" name="tab" value={tab} readOnly />
				)}
				<SearchInput name="q" defaultValue={q} placeholder="Search forms…" />
				<Button variant="ghost" type="submit" icon="search">
					Search
				</Button>
			</Form>

			<Tabs>
				<Tab
					to={listHref("all", q)}
					active={tab === "all"}
					count={tabCounts.all}
				>
					All
				</Tab>
				<Tab
					to={listHref("open", q)}
					active={tab === "open"}
					count={tabCounts.open}
				>
					Open
				</Tab>
				<Tab
					to={listHref("closed", q)}
					active={tab === "closed"}
					count={tabCounts.closed}
				>
					Closed
				</Tab>
				<Tab
					to={listHref("draft", q)}
					active={tab === "draft"}
					count={tabCounts.draft}
				>
					Drafts
				</Tab>
			</Tabs>

			{rows.length === 0 ? (
				<Panel>
					{!hasEvent ? (
						<EmptyState
							icon="calendar"
							title="No event yet"
							body="Forms belong to an event — create your event first, then build its call-for-proposals form here."
						/>
					) : q || tab !== "all" ? (
						<EmptyState
							icon="search"
							title="No forms match"
							body={
								q
									? `Nothing matches “${q}” — try another search or switch tabs.`
									: "No forms in this state yet — switch tabs to see the rest."
							}
						/>
					) : (
						<EmptyState
							icon="sliders"
							title="No forms yet"
							body="Create a submission form to start collecting proposals — its public link becomes shareable the moment you publish."
							action={<NewFormButton />}
						/>
					)}
				</Panel>
			) : (
				<div className="flex flex-col gap-3">
					{rows.map((f) => (
						<Panel key={f.id}>
							<div className="flex items-center gap-4">
								<div className="flex min-w-0 flex-1 flex-col gap-1">
									<div className="flex flex-wrap items-center gap-2">
										<strong>{f.internalName}</strong>
										<StatusBadge tone={FORM_STATUS_TONE[f.status]}>
											{f.status}
										</StatusBadge>
									</div>
									<p>
										{f.typeLabel} · {f.submissionsCount}{" "}
										{f.submissionsCount === 1 ? "submission" : "submissions"} ·{" "}
										{f.draftsCount} {f.draftsCount === 1 ? "draft" : "drafts"}
										{f.closesLabel ? ` · Closes ${f.closesLabel}` : ""} ·
										Created {f.createdLabel}
									</p>
									{f.shareUrl && (
										<div className="flex min-w-0 flex-wrap items-center gap-2">
											<NoteText>{f.shareUrl}</NoteText>
											<CopyButton
												value={f.shareUrl}
												label="Copy CFP link"
												failedLabel="Copy failed — select the link"
											/>
										</div>
									)}
								</div>
								<FormActionsMenu form={f} onDelete={() => setDeleteId(f.id)} />
							</div>
						</Panel>
					))}
				</div>
			)}

			<PaginationBar
				page={page}
				pages={pages}
				total={total}
				hrefFor={(p) => listHref(tab, q, p)}
			/>

			{deleteTarget && (
				<DeleteFormDialog
					form={deleteTarget}
					onCancel={() => setDeleteId(null)}
				/>
			)}
		</div>
	);
}

export function ErrorBoundary() {
	return (
		<div className="mx-auto max-w-5xl px-7 py-6">
			<PageHeader
				title="Failed to load forms"
				tone="danger"
				subtitle="Something went wrong. Please refresh or try again."
			/>
		</div>
	);
}
