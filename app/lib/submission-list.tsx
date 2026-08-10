import { useEffect, useRef, useState } from "react";
import { Form, Link, useFetcher, useNavigation } from "react-router";
// Pure client-safe module: the Abstracts and Sessions tabs are ONE
// implementation rendered by two type-scoped routes (server half in
// ./submission-list.server.ts). Enums come from ~/db/constants so no drizzle
// code reaches the client bundle.
import {
	CONTENT_STATUS,
	DECISION_STATUS,
	type SUBMISSION_TYPE,
} from "~/db/constants";

import {
	Button,
	Chip,
	EmptyRow,
	ErrorText,
	Field,
	Input,
	PageHeader,
	Panel,
	SearchInput,
	Select,
	StatusBadge,
	SUBMISSION_STATUS_TONE,
	Tab,
	Table,
	TableFooter,
	Tabs,
	TBody,
	Td,
	Textarea,
	TextLink,
	Th,
	THead,
	Tr,
} from "~/ui";
import type { BadgeTone } from "~/ui";

export const PAGE_SIZE = 25;

export const LIST_TABS = [
	"all",
	"accepted",
	"accept_queue",
	"pending",
	"decline_queue",
	"declined",
	"withdrawn",
	"draft",
] as const;
export type ListTab = (typeof LIST_TABS)[number];

export const TAB_LABELS: Record<ListTab, string> = {
	all: "All",
	accepted: "Accepted",
	accept_queue: "Accept Queue",
	pending: "Pending",
	decline_queue: "Decline Queue",
	declined: "Declined",
	withdrawn: "Withdrawn",
	draft: "Drafts",
};

// Keyed on the full enum so a new content status fails compilation here
// instead of rendering an unstyled badge.
export const CONTENT_STATUS_TONE: Record<
	(typeof CONTENT_STATUS)[number],
	BadgeTone
> = {
	draft: "faint",
	in_review: "info",
	approved: "success",
};

export function humanStatus(status: string): string {
	return status.replaceAll("_", " ");
}

export interface SubmissionListRow {
	id: string;
	title: string;
	status: keyof typeof SUBMISSION_STATUS_TONE;
	contentStatus: (typeof CONTENT_STATUS)[number];
	schedule: string | null;
	roomName: string | null;
	speakerCount: number;
	formatName: string | null;
	tracks: Array<{ id: string; name: string; color: string }>;
	submittedAt: string;
}

export interface DrawerContact {
	id: string;
	name: string;
	email: string;
}

export interface SubmissionListLoaded {
	eventName: string;
	tab: ListTab;
	q: string;
	page: number;
	pageCount: number;
	total: number;
	counts: Record<ListTab, number>;
	rows: SubmissionListRow[];
	contacts: DrawerContact[];
	/** True when the drawer's contact list hit its server cap — never truncate silently. */
	contactsTruncated: boolean;
	notPublicCount: number;
}

/** No-event admins get the designed empty state, not a payload of fake zeros. */
export type SubmissionListData = { eventName: null } | SubmissionListLoaded;

export interface ListActionData {
	notice?: string;
	formError?: string;
	skipped?: string[];
}

type ListKind = (typeof SUBMISSION_TYPE)[number];

function hrefFor(tab: ListTab, q: string, page = 1): string {
	const params = new URLSearchParams();
	if (tab !== "all") params.set("status", tab);
	if (q) params.set("q", q);
	if (page > 1) params.set("page", String(page));
	const s = params.toString();
	return s ? `?${s}` : "?";
}

/**
 * The manual "+ Add Submission / Add Session" drawer. It POSTs to the ONE
 * create action on /admin/submissions (never a second create path); the
 * `drawer` field makes that action answer with data instead of redirecting,
 * so errors render in place and success closes the drawer after the fetcher's
 * revalidation refreshes the list. Controlled: the trigger lives in the page
 * header while this panel renders as its own full-width block.
 */
export function AddSubmissionDrawer({
	kind,
	contacts,
	contactsTruncated,
	onClose,
}: {
	kind: ListKind;
	contacts: DrawerContact[];
	contactsTruncated: boolean;
	onClose: () => void;
}) {
	const [filter, setFilter] = useState("");
	const fetcher = useFetcher<{
		created?: boolean;
		warning?: string;
		fieldErrors?: Record<string, string[] | undefined>;
		formError?: string;
	}>();
	// A clean create closes the drawer (unmounting resets it — reopening mounts
	// fresh state and a fresh fetcher). A degraded create ("created, but
	// accepting it failed") stays open so the warning is actually read.
	useEffect(() => {
		if (
			fetcher.state === "idle" &&
			fetcher.data?.created &&
			!fetcher.data.warning
		) {
			onClose();
		}
	}, [fetcher.state, fetcher.data, onClose]);

	const needle = filter.trim().toLowerCase();
	const visibleContacts = needle
		? contacts.filter(
				(c) =>
					c.name.toLowerCase().includes(needle) ||
					c.email.toLowerCase().includes(needle),
			)
		: contacts;
	const fieldErrors = fetcher.data?.fieldErrors;

	return (
		<div className="flex w-full flex-col gap-4">
			<Panel>
				<fetcher.Form
					method="post"
					action="/admin/submissions"
					className="flex flex-col gap-4"
				>
					<Input type="hidden" name="drawer" value="1" readOnly />
					<Input type="hidden" name="type" value={kind} readOnly />
					<div className="flex flex-wrap items-end gap-3">
						<div className="min-w-64 flex-1">
							<Field label="Title" error={fieldErrors?.title?.[0]}>
								<Input
									name="title"
									invalid={Boolean(fieldErrors?.title?.[0])}
									placeholder={
										kind === "session" ? "Session title" : "Submission title"
									}
								/>
							</Field>
						</div>
						<Field label="Status">
							<Select name="status" defaultValue="pending">
								{DECISION_STATUS.map((s) => (
									<option key={s} value={s}>
										{humanStatus(s)}
									</option>
								))}
							</Select>
						</Field>
					</div>
					<Field label="Description" error={fieldErrors?.description?.[0]}>
						<Textarea name="description" rows={4} />
					</Field>
					<div className="flex flex-col gap-2">
						<Field label="Speakers (existing contacts)">
							<Input
								placeholder="Filter contacts by name or email…"
								value={filter}
								onChange={(e) => setFilter(e.currentTarget.value)}
							/>
						</Field>
						<div className="flex max-h-52 flex-col gap-1 overflow-y-auto">
							{visibleContacts.map((c) => (
								<label key={c.id} className="flex items-center gap-2">
									<Input
										type="checkbox"
										name="participantContactIds"
										value={c.id}
									/>
									<span>
										{c.name} · {c.email}
									</span>
								</label>
							))}
							{contacts.length === 0 && (
								<p>
									No contacts on this event yet — contacts are created when
									submissions arrive or when you add speakers to the roster.
								</p>
							)}
							{contacts.length > 0 && visibleContacts.length === 0 && (
								<p>No contacts match &quot;{filter}&quot;.</p>
							)}
							{contactsTruncated && (
								<p>
									Showing the first {contacts.length} contacts — manage the full
									roster from the speakers area.
								</p>
							)}
						</div>
					</div>
					{fetcher.data?.formError && (
						<ErrorText>{fetcher.data.formError}</ErrorText>
					)}
					{fetcher.data?.warning && (
						<ErrorText>{fetcher.data.warning}</ErrorText>
					)}
					<div className="flex gap-2">
						<Button type="submit" disabled={fetcher.state !== "idle"}>
							Create
						</Button>
						<Button type="button" variant="ghost" onClick={onClose}>
							Cancel
						</Button>
					</div>
				</fetcher.Form>
			</Panel>
		</div>
	);
}

export function SubmissionListPage({
	kind,
	title,
	data,
	actionData,
}: {
	kind: ListKind;
	title: string;
	data: SubmissionListData;
	actionData?: ListActionData;
}) {
	const loaded = data.eventName === null ? null : data;
	const [drawerOpen, setDrawerOpen] = useState(false);
	// Bulk apply is a document POST — block the double-click that would replay
	// the transition before the first response lands.
	const busy = useNavigation().state !== "idle";
	const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
	// A new page/tab/search renders different rows — a stale selection would
	// silently act on rows the admin can no longer see.
	const view = loaded ? `${loaded.tab}|${loaded.q}|${loaded.page}` : "";
	const lastView = useRef(view);
	useEffect(() => {
		if (lastView.current !== view) {
			lastView.current = view;
			setSelected(new Set());
		}
	}, [view]);
	const toggleSelected = (id: string, checked: boolean) => {
		setSelected((prev) => {
			const next = new Set(prev);
			if (checked) next.add(id);
			else next.delete(id);
			return next;
		});
	};

	if (!loaded) {
		return (
			<div className="mx-auto flex max-w-6xl flex-col gap-5 px-7 py-6">
				<PageHeader title={title} />
				<Panel>
					<p>
						No event is configured yet — create your event to start collecting{" "}
						{kind === "abstract" ? "abstracts" : "sessions"}.
					</p>
				</Panel>
			</div>
		);
	}

	const { tab, q, page, pageCount, total, counts, rows } = loaded;
	const colSpan = kind === "session" ? 8 : 7;
	const rangeStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
	const rangeEnd = (page - 1) * PAGE_SIZE + rows.length;
	const bulkFormId = `bulk-${kind}`;

	return (
		<div className="mx-auto flex max-w-6xl flex-col gap-5 px-7 py-6">
			<PageHeader
				title={title}
				count={`${counts.all} total`}
				actions={
					<Button icon="plus" onClick={() => setDrawerOpen((o) => !o)}>
						{kind === "session" ? "Add Session" : "Add Submission"}
					</Button>
				}
			/>

			{drawerOpen && (
				<AddSubmissionDrawer
					kind={kind}
					contacts={loaded.contacts}
					contactsTruncated={loaded.contactsTruncated}
					onClose={() => setDrawerOpen(false)}
				/>
			)}

			{kind === "session" && (
				<Panel>
					<Form
						method="post"
						className="flex flex-wrap items-center justify-between gap-3"
					>
						<p>
							{loaded.notPublicCount === 0
								? "Every accepted submission is approved for the public program."
								: `${loaded.notPublicCount} accepted submission${loaded.notPublicCount === 1 ? " isn't" : "s aren't"} public yet — approval covers accepted abstracts too; content stays off public pages until it's approved.`}
						</p>
						<Button
							type="submit"
							name="intent"
							value="approve-all-accepted"
							disabled={loaded.notPublicCount === 0 || busy}
						>
							Approve all accepted
						</Button>
					</Form>
				</Panel>
			)}

			<Tabs>
				{LIST_TABS.map((t) => (
					<Tab key={t} to={hrefFor(t, q)} active={tab === t} count={counts[t]}>
						{TAB_LABELS[t]}
					</Tab>
				))}
			</Tabs>

			<div className="flex flex-wrap items-center gap-3">
				<Form method="get" className="flex flex-1 items-center gap-2">
					{tab !== "all" && (
						<Input type="hidden" name="status" value={tab} readOnly />
					)}
					<SearchInput
						key={q}
						name="q"
						defaultValue={q}
						placeholder="Search titles…"
						aria-label={`Search ${title.toLowerCase()}`}
					/>
					<Button type="submit" variant="ghost" icon="search">
						Search
					</Button>
					{q && <TextLink to={hrefFor(tab, "")}>Clear</TextLink>}
				</Form>
				<Form method="post" id={bulkFormId} className="flex items-end gap-2">
					<Field label={`${selected.size} selected — set status to`}>
						<Select name="status" defaultValue="accept_queue">
							{DECISION_STATUS.map((s) => (
								<option key={s} value={s}>
									{humanStatus(s)}
								</option>
							))}
						</Select>
					</Field>
					<Button
						type="submit"
						name="intent"
						value="bulk-set-status"
						variant="ghost"
						disabled={selected.size === 0 || busy}
					>
						Apply
					</Button>
				</Form>
			</div>

			<p>
				Apply never emails anyone — accepting links speaker accounts and mints
				onboarding tasks; decision emails are sent explicitly from All
				Submissions.
			</p>

			{actionData?.notice && <p>{actionData.notice}</p>}
			{actionData?.formError && <ErrorText>{actionData.formError}</ErrorText>}
			{actionData?.skipped?.map((s) => (
				<ErrorText key={s}>Skipped {s}</ErrorText>
			))}

			<Table>
				<THead>
					<Th> </Th>
					<Th>Title</Th>
					<Th>Status</Th>
					{kind === "session" && <Th>Content</Th>}
					{kind === "session" && <Th>Schedule</Th>}
					<Th>Tracks</Th>
					<Th>Speakers</Th>
					<Th>{kind === "session" ? "Format" : "Submitted"}</Th>
				</THead>
				<TBody>
					{rows.map((s) => (
						<Tr key={s.id} selected={selected.has(s.id)}>
							<Td>
								<Input
									type="checkbox"
									name="submissionIds"
									value={s.id}
									form={bulkFormId}
									aria-label={`Select ${s.title}`}
									checked={selected.has(s.id)}
									onChange={(e) =>
										toggleSelected(s.id, e.currentTarget.checked)
									}
								/>
							</Td>
							{/* Table titles stay ink (petrol is wayfinding only) — a bare
							    Link inherits the cell's ink color; the row hover carries
							    the affordance. */}
							<Td kind="strong">
								<Link to={`/admin/submissions/${s.id}`}>{s.title}</Link>
							</Td>
							<Td>
								<StatusBadge tone={SUBMISSION_STATUS_TONE[s.status]}>
									{humanStatus(s.status)}
								</StatusBadge>
							</Td>
							{kind === "session" && (
								<Td>
									<StatusBadge tone={CONTENT_STATUS_TONE[s.contentStatus]}>
										{s.contentStatus === "approved"
											? "approved"
											: s.contentStatus === "in_review"
												? "in review"
												: "not public"}
									</StatusBadge>
								</Td>
							)}
							{kind === "session" && (
								<Td>
									{s.schedule
										? `${s.schedule}${s.roomName ? ` · ${s.roomName}` : ""}`
										: "Unscheduled"}
								</Td>
							)}
							<Td>
								<div className="flex flex-wrap gap-3">
									{s.tracks.map((t) => (
										<Chip key={t.id} color={t.color}>
											{t.name}
										</Chip>
									))}
								</div>
							</Td>
							<Td kind="mono">{s.speakerCount}</Td>
							<Td>
								{kind === "session" ? (s.formatName ?? "—") : s.submittedAt}
							</Td>
						</Tr>
					))}
					{rows.length === 0 && (
						<EmptyRow colSpan={colSpan}>
							{q
								? `No ${title.toLowerCase()} match "${q}" — try a different search or clear it.`
								: tab !== "all"
									? `No ${TAB_LABELS[tab].toLowerCase()} ${title.toLowerCase()} yet.`
									: kind === "abstract"
										? "No abstracts yet — share your call for papers and CFP submissions will land here."
										: "No sessions yet — accepted talks appear here, or add one manually."}
						</EmptyRow>
					)}
				</TBody>
			</Table>
			<TableFooter>
				<span>
					{rangeStart}–{rangeEnd} of {total}
				</span>
				<span className="ml-auto flex items-center gap-4">
					{page > 1 && (
						<TextLink to={hrefFor(tab, q, page - 1)}>← Previous</TextLink>
					)}
					<span>
						Page {page} of {pageCount}
					</span>
					{page < pageCount && (
						<TextLink to={hrefFor(tab, q, page + 1)}>Next →</TextLink>
					)}
				</span>
			</TableFooter>
		</div>
	);
}
