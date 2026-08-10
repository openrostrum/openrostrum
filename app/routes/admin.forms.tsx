import { useEffect, useState } from "react";
import { data, Form, useOutlet } from "react-router";
import { and, desc, eq, like, or, sql } from "drizzle-orm";
import { getDb } from "~/db";
import { forms, submissions } from "~/db/schema";
import { getActiveEvent, requireAdmin } from "~/lib/auth";
import { createTimings } from "~/lib/track";
import {
	type BadgeTone,
	Button,
	ButtonLink,
	EmptyState,
	Icon,
	Input,
	PageHeader,
	Panel,
	SearchInput,
	StatusBadge,
	Tab,
	Tabs,
} from "~/ui";
import type { Route } from "./+types/admin.forms";

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
};

// A form can be off (draft/closed) or auto-closed by its close date — the list
// shows ONE effective state so "why is my link dead?" is answerable at a glance.
export function effectiveFormStatus(
	status: "draft" | "open" | "closed",
	closeAt: Date | null,
	now: number,
): "draft" | "open" | "closed" {
	if (status !== "open") return status;
	if (closeAt && closeAt.getTime() <= now) return "closed";
	return "open";
}

// Without this export, RR7 drops loader headers from DOCUMENT responses —
// Server-Timing would silently vanish on full page loads.
export function headers({ loaderHeaders }: Route.HeadersArgs) {
	return loaderHeaders;
}

export async function loader({ context, request }: Route.LoaderArgs) {
	const env = context.cloudflare.env;
	// Self-authenticate — never rely on the admin.tsx layout loader (single
	// fetch can run this loader alone via `?_routes=`).
	const user = await requireAdmin(env, request);
	const event = await getActiveEvent(env, user);
	const url = new URL(request.url);
	const q = url.searchParams.get("q")?.trim() ?? "";
	const tab = url.searchParams.get("tab") ?? "all";
	const empty = {
		forms: [] as FormRow[],
		tabCounts: { all: 0, open: 0, closed: 0, draft: 0 },
		q,
		tab,
	};
	if (!event) return data(empty);

	const db = getDb(env);
	const timings = createTimings();
	const rows = await timings.time("db", () =>
		db
			.select()
			.from(forms)
			.where(
				and(
					eq(forms.eventId, event.id),
					q
						? or(
								like(forms.internalName, `%${q}%`),
								like(forms.externalTitle, `%${q}%`),
							)
						: undefined,
				),
			)
			.orderBy(desc(forms.createdAt))
			.limit(100),
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

	const now = Date.now();
	const dateFmt = new Intl.DateTimeFormat("en-US", {
		timeZone: event.timezone,
		dateStyle: "medium",
	});
	const decorated: FormRow[] = rows.map((f) => {
		const c = countsByForm.get(f.id);
		return {
			id: f.id,
			internalName: f.internalName,
			typeLabel:
				(f.type === "abstract" ? "Abstracts" : "Sessions") +
				(f.participantsStep ? " & Participants" : ""),
			rawStatus: f.status,
			status: effectiveFormStatus(f.status, f.closeAt, now),
			submissionsCount: (c?.total ?? 0) - (c?.drafts ?? 0),
			draftsCount: c?.drafts ?? 0,
			closesLabel: f.closeAt ? dateFmt.format(f.closeAt) : null,
			createdLabel: dateFmt.format(f.createdAt),
		};
	});
	const tabCounts = {
		all: decorated.length,
		open: decorated.filter((f) => f.status === "open").length,
		closed: decorated.filter((f) => f.status === "closed").length,
		draft: decorated.filter((f) => f.status === "draft").length,
	};
	const visible =
		tab === "all" ? decorated : decorated.filter((f) => f.status === tab);

	return data(
		{ forms: visible, tabCounts, q, tab },
		{ headers: { "Server-Timing": timings.header() } },
	);
}

const STATUS_TONE: Record<string, BadgeTone> = {
	open: "success",
	closed: "neutral",
	draft: "faint",
};

function tabHref(tab: string, q: string): string {
	const params = new URLSearchParams();
	if (tab !== "all") params.set("tab", tab);
	if (q) params.set("q", q);
	const qs = params.toString();
	return qs ? `/admin/forms?${qs}` : "/admin/forms";
}

function NewFormButton() {
	return (
		<Form method="post" action="/admin/forms/new">
			<Input type="hidden" name="intent" value="create" readOnly />
			<Button type="submit" icon="plus">
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
	return (
		<details className="relative">
			<summary
				className="flex h-[34px] w-[34px] cursor-pointer list-none items-center justify-center [&::-webkit-details-marker]:hidden"
				aria-label={`Actions for ${form.internalName}`}
			>
				<Icon name="dots" />
			</summary>
			<div className="absolute right-0 top-full z-30 mt-1 w-64">
				<Panel>
					<div className="flex flex-col items-stretch gap-1">
						<ButtonLink variant="ghost" to={`/admin/forms/${form.id}`}>
							Edit
						</ButtonLink>
						{form.rawStatus !== "open" && (
							<Form method="post" action={`/admin/forms/${form.id}`}>
								<Input type="hidden" name="intent" value="publish" readOnly />
								<Button variant="ghost" type="submit">
									Open form
								</Button>
							</Form>
						)}
						<ButtonLink
							variant="ghost"
							to={`/admin/forms/${form.id}?view=results`}
						>
							View results
						</ButtonLink>
						<ButtonLink
							variant="ghost"
							to={`/admin/forms/${form.id}?view=drafts`}
						>
							View draft submissions
						</ButtonLink>
						<Form method="post" action={`/admin/forms/${form.id}`}>
							<Input type="hidden" name="intent" value="duplicate" readOnly />
							<Button variant="ghost" type="submit">
								Duplicate
							</Button>
						</Form>
						<Button variant="ghost" type="button" onClick={onDelete}>
							Delete
						</Button>
					</div>
				</Panel>
			</div>
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
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") onCancel();
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [onCancel]);
	return (
		<div
			role="dialog"
			aria-modal="true"
			aria-label={`Delete ${form.internalName}`}
			className="fixed inset-0 z-50 flex items-center justify-center p-6"
		>
			<div className="w-full max-w-md">
				<Panel>
					<div className="flex flex-col gap-3">
						<strong>Delete “{form.internalName}”?</strong>
						<p>
							The form and its questions are removed permanently and its public
							link stops working. Submissions already received are kept — they
							just lose their link to this form.
						</p>
						<div className="flex justify-end gap-2">
							<Button variant="ghost" type="button" onClick={onCancel}>
								Cancel
							</Button>
							<Form method="post" action={`/admin/forms/${form.id}`}>
								<Input type="hidden" name="intent" value="delete" readOnly />
								<Button type="submit">Delete form</Button>
							</Form>
						</div>
					</div>
				</Panel>
			</div>
		</div>
	);
}

export default function FormsList({ loaderData }: Route.ComponentProps) {
	const { forms: rows, tabCounts, q, tab } = loaderData;
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
				actions={<NewFormButton />}
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
					to={tabHref("all", q)}
					active={tab === "all"}
					count={tabCounts.all}
				>
					All
				</Tab>
				<Tab
					to={tabHref("open", q)}
					active={tab === "open"}
					count={tabCounts.open}
				>
					Open
				</Tab>
				<Tab
					to={tabHref("closed", q)}
					active={tab === "closed"}
					count={tabCounts.closed}
				>
					Closed
				</Tab>
				<Tab
					to={tabHref("draft", q)}
					active={tab === "draft"}
					count={tabCounts.draft}
				>
					Drafts
				</Tab>
			</Tabs>

			{rows.length === 0 ? (
				<Panel>
					{q || tab !== "all" ? (
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
										<StatusBadge tone={STATUS_TONE[f.status] ?? "neutral"}>
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
								</div>
								<FormActionsMenu form={f} onDelete={() => setDeleteId(f.id)} />
							</div>
						</Panel>
					))}
				</div>
			)}

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
