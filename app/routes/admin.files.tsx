import { asc, eq } from "drizzle-orm";
import { useState } from "react";
import { Form, data } from "react-router";
import { FilePicker } from "~/components/file-picker";
import { getDb } from "~/db";
import { submissions } from "~/db/schema";
import {
	FILE_REVIEW_LABEL,
	FILE_REVIEW_TONE,
	listFileGroups,
	UPLOAD_ACCEPT,
	UPLOAD_CONSTRAINTS,
	UPLOAD_ERRORS,
	type UploadErrorCode,
} from "~/domain/files";
import { getActiveEvent, requireAdmin } from "~/lib/auth";
import { formatBytes, formatDateUTC } from "~/lib/format";
import { createTimings } from "~/lib/track";
import {
	Button,
	EmptyRow,
	ErrorText,
	Field,
	Input,
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
import type { Route } from "./+types/admin.files";

const PAGE_SIZE = 50;

const REVIEW_FILTERS = [
	["", "All review states"],
	["pending", "Pending review"],
	["approved", "Approved"],
	["denied", "Changes requested"],
	["none", "Not reviewed"],
] as const;

export function headers({ loaderHeaders }: Route.HeadersArgs) {
	return loaderHeaders;
}

export async function loader({ context, request }: Route.LoaderArgs) {
	const env = context.cloudflare.env;
	// Self-authenticate — never rely on the admin.tsx layout loader.
	const user = await requireAdmin(env, request);
	const event = await getActiveEvent(env, user);
	const url = new URL(request.url);
	const q = url.searchParams.get("q")?.trim() ?? "";
	const status = url.searchParams.get("status") ?? "";
	const submissionId = url.searchParams.get("submission") ?? "";
	const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
	const uploadError = url.searchParams.get("uploadError");
	const uploaded = url.searchParams.get("notice") === "uploaded";
	if (!event) {
		return {
			rows: [],
			total: 0,
			page: 1,
			q,
			status,
			submissionId,
			sessionOptions: [],
			uploadError: null,
			uploaded: false,
		};
	}
	const db = getDb(env);
	const timings = createTimings();
	const { rows, total } = await timings.time("db", () =>
		listFileGroups(db, event.id, {
			q: q || undefined,
			reviewStatus: isReviewStatus(status) ? status : undefined,
			submissionId: submissionId || undefined,
			page,
			pageSize: PAGE_SIZE,
		}),
	);
	const sessionOptions = await timings.time("db", () =>
		db
			.select({ id: submissions.id, title: submissions.title })
			.from(submissions)
			.where(eq(submissions.eventId, event.id))
			.orderBy(asc(submissions.title)),
	);
	return data(
		{
			rows,
			total,
			page,
			q,
			status,
			submissionId,
			sessionOptions,
			uploadError:
				uploadError && uploadError in UPLOAD_ERRORS
					? UPLOAD_ERRORS[uploadError as UploadErrorCode]
					: null,
			uploaded,
		},
		{ headers: { "Server-Timing": timings.header() } },
	);
}

function isReviewStatus(
	value: string,
): value is "pending" | "approved" | "denied" | "none" {
	return (
		value === "pending" ||
		value === "approved" ||
		value === "denied" ||
		value === "none"
	);
}

export default function FilesLibrary({ loaderData }: Route.ComponentProps) {
	const {
		rows,
		total,
		page,
		q,
		status,
		submissionId,
		sessionOptions,
		uploadError,
		uploaded,
	} = loaderData;
	const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
	const toggleSelected = (id: string, checked: boolean) => {
		setSelected((prev) => {
			const next = new Set(prev);
			if (checked) next.add(id);
			else next.delete(id);
			return next;
		});
	};
	const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
	const filteredSession = submissionId
		? (sessionOptions.find((s) => s.id === submissionId) ?? null)
		: null;
	const filterQuery = (target: number) => {
		const params = new URLSearchParams();
		if (q) params.set("q", q);
		if (status) params.set("status", status);
		if (submissionId) params.set("submission", submissionId);
		if (target > 1) params.set("page", String(target));
		const s = params.toString();
		return s ? `?${s}` : "";
	};

	return (
		<div className="mx-auto flex max-w-6xl flex-col gap-5 px-7 py-6">
			<PageHeader
				title="Files"
				count={`${total} file${total === 1 ? "" : "s"}`}
				subtitle="Every upload across the event — speaker deliverables, admin uploads, and portal downloads — with version history and review state."
			/>

			<Panel>
				<Form
					method="post"
					action="/files/upload"
					encType="multipart/form-data"
					className="flex flex-wrap items-end gap-3"
				>
					<Input type="hidden" name="redirectTo" value="/admin/files" />
					<div className="min-w-64">
						<FilePicker
							name="file"
							accept={UPLOAD_ACCEPT}
							constraints={UPLOAD_CONSTRAINTS}
							required
						/>
					</div>
					<Field label="Attach to session (optional)">
						<Select name="submissionId" defaultValue="">
							<option value="">No session — event-level file</option>
							{sessionOptions.map((s) => (
								<option key={s.id} value={s.id}>
									{s.title}
								</option>
							))}
						</Select>
					</Field>
					<Field label="Portal downloads">
						<span className="flex h-[34px] items-center gap-2">
							<Input type="checkbox" name="sharedToPortal" />
							Share with speakers
						</span>
					</Field>
					<Button type="submit" icon="plus">
						Upload
					</Button>
					{uploadError && <ErrorText>{uploadError}</ErrorText>}
					{uploaded && <StatusBadge tone="success">File uploaded.</StatusBadge>}
				</Form>
			</Panel>

			<Form method="get" className="flex flex-wrap items-end gap-3">
				{submissionId && (
					<Input type="hidden" name="submission" value={submissionId} />
				)}
				<SearchInput
					name="q"
					defaultValue={q}
					placeholder="Search files, sessions, speakers…"
					aria-label="Search files"
				/>
				<Select name="status" defaultValue={status} aria-label="Review state">
					{REVIEW_FILTERS.map(([value, label]) => (
						<option key={value} value={value}>
							{label}
						</option>
					))}
				</Select>
				<Button type="submit" variant="ghost" icon="filter">
					Filter
				</Button>
				{filteredSession && (
					<StatusBadge tone="info">
						Session: {filteredSession.title}
					</StatusBadge>
				)}
				{(q || status || submissionId) && (
					<TextLink to="/admin/files">Clear filters</TextLink>
				)}
			</Form>

			<Form method="get" action="/admin/files/export.zip" id="zip-export">
				<div className="flex flex-wrap items-center gap-3">
					<Button type="submit" icon="export" disabled={selected.size === 0}>
						Download ZIP ({selected.size} selected)
					</Button>
					<Button
						type="submit"
						variant="ghost"
						icon="export"
						name="all"
						value="1"
					>
						Download ZIP (everything)
					</Button>
					<span>
						Latest version of each file, grouped in one folder per session.
					</span>
				</div>
			</Form>

			<Table>
				<THead>
					<Th> </Th>
					<Th>File</Th>
					<Th>Session</Th>
					<Th>Speaker</Th>
					<Th>Versions</Th>
					<Th>Review</Th>
					<Th>Size</Th>
					<Th>Uploaded</Th>
				</THead>
				<TBody>
					{rows.map((f) => (
						<Tr key={f.id} selected={selected.has(f.id)}>
							<Td>
								<Input
									type="checkbox"
									name="fileIds"
									value={f.id}
									form="zip-export"
									aria-label={`Select ${f.fileName}`}
									checked={selected.has(f.id)}
									onChange={(e) =>
										toggleSelected(f.id, e.currentTarget.checked)
									}
								/>
							</Td>
							<Td kind="strong">
								<TextLink to={`/admin/files/${f.id}`}>{f.fileName}</TextLink>
							</Td>
							<Td>
								{f.submissionId ? (
									<TextLink to={`/admin/files?submission=${f.submissionId}`}>
										{f.submissionTitle ?? "Untitled session"}
									</TextLink>
								) : (
									"—"
								)}
							</Td>
							<Td>{f.speakerName ?? "—"}</Td>
							<Td kind="mono">
								v{f.version} · {f.versionCount} version
								{f.versionCount === 1 ? "" : "s"}
							</Td>
							<Td>
								<div className="flex flex-wrap items-center gap-2">
									<StatusBadge
										tone={FILE_REVIEW_TONE[f.reviewStatus] ?? "neutral"}
									>
										{FILE_REVIEW_LABEL[f.reviewStatus] ?? f.reviewStatus}
									</StatusBadge>
									{f.sharedToPortal && (
										<StatusBadge tone="info">Portal download</StatusBadge>
									)}
								</div>
							</Td>
							<Td kind="mono">{formatBytes(f.sizeBytes)}</Td>
							<Td kind="mono">{formatDateUTC(f.createdAt)}</Td>
						</Tr>
					))}
					{rows.length === 0 && (
						<EmptyRow colSpan={8}>
							{q || status || submissionId
								? "No files match these filters — clear them to see everything."
								: "No files yet — speaker uploads land here automatically, or upload the first file above."}
						</EmptyRow>
					)}
				</TBody>
			</Table>
			{total > PAGE_SIZE && (
				<TableFooter>
					<span>
						{(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of{" "}
						{total}
					</span>
					<span className="ml-auto flex gap-3">
						{page > 1 && (
							<TextLink to={`/admin/files${filterQuery(page - 1)}`}>
								Previous
							</TextLink>
						)}
						{page < pageCount && (
							<TextLink to={`/admin/files${filterQuery(page + 1)}`}>
								Next
							</TextLink>
						)}
					</span>
				</TableFooter>
			)}
		</div>
	);
}

export function ErrorBoundary() {
	return (
		<div className="mx-auto max-w-6xl px-7 py-6">
			<PageHeader
				title="Failed to load the files library"
				tone="danger"
				subtitle="Something went wrong. Please refresh or try again."
			/>
		</div>
	);
}
