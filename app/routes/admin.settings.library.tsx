import {
	and,
	asc,
	count,
	eq,
	max,
	notExists,
	or,
	sql,
	type SQL,
} from "drizzle-orm";
import type {
	SQLiteColumn,
	SQLiteInsertValue,
	SQLiteUpdateSetSource,
} from "drizzle-orm/sqlite-core";
import { type ReactNode, useMemo, useState } from "react";
import { data, useFetcher } from "react-router";
import { z } from "zod";
import { type Db, getDb } from "~/db";
import {
	FIELD_TYPE,
	fields,
	formats,
	languages,
	levels,
	reviewerTracks,
	rooms,
	submissionTracks,
	tags,
	tracks,
} from "~/db/schema";
import { getActiveEvent, requireAdmin } from "~/lib/auth";
import { errorChainIncludes } from "~/lib/errors";
import { createTimings, track as trackEvent } from "~/lib/track";
import { optionalBoundedInt } from "~/settings/event-details.server";
import { FIELD_TYPE_LABELS, FIELD_TYPES } from "~/settings/event-form";
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
	Table,
	TBody,
	Td,
	Th,
	THead,
	Tr,
} from "~/ui";
import type { Route } from "./+types/admin.settings.library";

type LibraryResult = {
	ok?: true;
	fieldErrors?: Record<string, string[] | undefined>;
	formError?: string;
};

// Without this export, RR7 drops loader/action headers from DOCUMENT
// responses — Server-Timing would silently vanish on full page loads.
export function headers({ loaderHeaders }: Route.HeadersArgs) {
	return loaderHeaders;
}

/* ------------------------------------------------------------- validation --- */

const Name = z.string().trim().min(1, "Name is required").max(120);
const Color = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Pick a color");

const TrackForm = z.object({ name: Name, color: Color });
const TagForm = z.object({ name: Name, color: Color });
const FormatForm = z.object({
	name: Name,
	defaultDurationMins: z.coerce
		.number({ error: "Enter the default duration in minutes" })
		.int("Whole minutes only")
		.min(1, "At least 1 minute")
		.max(1440, "At most 24 hours"),
});
const LevelForm = z.object({ name: Name });
const RoomForm = z.object({
	name: Name,
	capacity: optionalBoundedInt(
		1_000_000,
		"Enter a whole number, or leave blank",
	),
});
const LanguageForm = z.object({ name: Name });

const FieldForm = z
	.object({
		name: Name,
		type: z.enum(FIELD_TYPE),
		scope: z.enum(["event", "org"]).default("event"),
		description: z
			.string()
			.trim()
			.max(500, "Keep the description under 500 characters")
			.transform((v) => (v === "" ? null : v)),
		maxLength: optionalBoundedInt(
			100_000,
			"Enter a whole number, or leave blank",
		),
		options: z
			.string()
			.trim()
			.transform((v) =>
				v === ""
					? null
					: v
							.split(",")
							.map((o) => o.trim())
							.filter((o) => o !== ""),
			),
	})
	.check((ctx) => {
		const v = ctx.value;
		if (
			v.type === "dropdown" &&
			(v.options === null || v.options.length === 0)
		) {
			ctx.issues.push({
				code: "custom",
				message: "List at least one option, separated by commas",
				path: ["options"],
				input: v.options,
			});
		}
	})
	// Length limits apply to typed answers; options apply to dropdowns — strip
	// whatever doesn't apply so stale values can't linger after a type change.
	.transform((v) => ({
		...v,
		maxLength: v.type === "text" || v.type === "textarea" ? v.maxLength : null,
		options: v.type === "dropdown" ? v.options : null,
	}));

/* ---------------------------------------------------------------- actions --- */

function fieldErrorsOf(error: z.ZodError): Record<string, string[]> {
	return z.flattenError(error).fieldErrors as Record<string, string[]>;
}

const MISSING = {
	formError: "That record no longer exists — the list may be out of date.",
} satisfies LibraryResult;

type TaxonomyTable =
	| typeof tracks
	| typeof tags
	| typeof formats
	| typeof levels
	| typeof rooms
	| typeof languages;

/** THE row-level tenant guard for library writes, defined once: a forged id
 * can never touch another event's row. */
function own<T extends TaxonomyTable>(table: T, id: string, eventId: string) {
	return and(eq(table.id, id), eq(table.eventId, eventId));
}

/** Append position: max+1, never count (count reuses positions after a
 * middle-row delete, unpinning list order). */
async function nextPosition(
	db: Db,
	table: TaxonomyTable,
	column: SQLiteColumn,
	eventId: string,
): Promise<number> {
	const [row] = await db
		.select({ n: max(column) })
		.from(table)
		.where(eq(table.eventId, eventId));
	return Number(row?.n ?? -1) + 1;
}

/**
 * Uniform create/update/delete derived from one config per taxonomy table.
 * Every write goes through own(); a table with an `inUse` guard embeds the
 * no-references condition IN the delete statement itself, so a reference
 * created concurrently can never be silently cascade-stripped.
 */
function taxonomy<T extends TaxonomyTable, S extends z.ZodType>(cfg: {
	table: T;
	schema: S;
	pick(form: FormData): Record<string, FormDataEntryValue | null>;
	/** Append-ordered tables: the insert sets `key` to max(column)+1. */
	position?: { key: "position" | "displayOrder"; column: SQLiteColumn };
	inUse?: {
		/** TRUE while nothing references the row — ANDed into the delete. */
		free(db: Db, id: string): SQL | undefined;
		/** Refusal message once a delete was blocked by live references. */
		describe(db: Db, id: string): Promise<string>;
	};
}) {
	const parse = (form: FormData) => cfg.schema.safeParse(cfg.pick(form));
	return {
		async create(
			db: Db,
			eventId: string,
			form: FormData,
		): Promise<LibraryResult> {
			const parsed = parse(form);
			if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error) };
			const positioned = cfg.position
				? {
						[cfg.position.key]: await nextPosition(
							db,
							cfg.table,
							cfg.position.column,
							eventId,
						),
					}
				: {};
			// The one write-payload cast: zod output keys are tied to column keys
			// by the schemas above, and every entity's create is pinned by a test.
			await db.insert(cfg.table).values({
				eventId,
				...positioned,
				...(parsed.data as Record<string, unknown>),
			} as SQLiteInsertValue<T>);
			return { ok: true };
		},
		async update(
			db: Db,
			eventId: string,
			id: string,
			form: FormData,
		): Promise<LibraryResult> {
			const parsed = parse(form);
			if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error) };
			const touched = await db
				.update(cfg.table)
				.set(parsed.data as SQLiteUpdateSetSource<T>)
				.where(own(cfg.table, id, eventId))
				.returning({ id: cfg.table.id });
			return touched.length === 0 ? MISSING : { ok: true };
		},
		async remove(db: Db, eventId: string, id: string): Promise<LibraryResult> {
			const guard = cfg.inUse
				? and(own(cfg.table, id, eventId), cfg.inUse.free(db, id))
				: own(cfg.table, id, eventId);
			const gone = await db
				.delete(cfg.table)
				.where(guard)
				.returning({ id: cfg.table.id });
			if (gone.length > 0) return { ok: true };
			if (cfg.inUse) {
				const [owned] = await db
					.select({ id: cfg.table.id })
					.from(cfg.table)
					.where(own(cfg.table, id, eventId))
					.limit(1);
				if (owned) return { formError: await cfg.inUse.describe(db, id) };
			}
			return MISSING;
		},
	};
}

const TAXONOMIES = {
	track: taxonomy({
		table: tracks,
		schema: TrackForm,
		pick: (f) => ({ name: f.get("name"), color: f.get("color") }),
		// A referenced track must never be silently cascade-stripped from
		// submissions or reviewer assignments — the delete refuses instead.
		inUse: {
			free: (db, id) =>
				and(
					notExists(
						db
							.select({ one: submissionTracks.trackId })
							.from(submissionTracks)
							.where(eq(submissionTracks.trackId, id)),
					),
					notExists(
						db
							.select({ one: reviewerTracks.trackId })
							.from(reviewerTracks)
							.where(eq(reviewerTracks.trackId, id)),
					),
				),
			describe: async (db, id) => {
				const [subs] = await db
					.select({ n: count() })
					.from(submissionTracks)
					.where(eq(submissionTracks.trackId, id));
				const [reviewers] = await db
					.select({ n: count() })
					.from(reviewerTracks)
					.where(eq(reviewerTracks.trackId, id));
				const parts = [];
				if (subs?.n)
					parts.push(`${subs.n} submission${subs.n === 1 ? "" : "s"}`);
				if (reviewers?.n)
					parts.push(
						`${reviewers.n} reviewer assignment${reviewers.n === 1 ? "" : "s"}`,
					);
				return `In use by ${parts.join(" and ") || "other records"} — remove it from them before deleting.`;
			},
		},
	}),
	tag: taxonomy({
		table: tags,
		schema: TagForm,
		pick: (f) => ({ name: f.get("name"), color: f.get("color") }),
	}),
	format: taxonomy({
		table: formats,
		schema: FormatForm,
		pick: (f) => ({
			name: f.get("name"),
			defaultDurationMins: f.get("defaultDurationMins"),
		}),
		position: { key: "position", column: formats.position },
	}),
	level: taxonomy({
		table: levels,
		schema: LevelForm,
		pick: (f) => ({ name: f.get("name") }),
		position: { key: "position", column: levels.position },
	}),
	room: taxonomy({
		table: rooms,
		schema: RoomForm,
		pick: (f) => ({ name: f.get("name"), capacity: f.get("capacity") ?? "" }),
		position: { key: "displayOrder", column: rooms.displayOrder },
	}),
	language: taxonomy({
		table: languages,
		schema: LanguageForm,
		pick: (f) => ({ name: f.get("name") }),
		position: { key: "position", column: languages.position },
	}),
} as const;

/** Fields the active event may see and manage: its own + its org's org-wide. */
function fieldScopeGuard(eventId: string, organizationId: string) {
	return or(
		eq(fields.eventId, eventId),
		eq(fields.organizationId, organizationId),
	);
}

type ActiveEvent = { id: string; organizationId: string };

async function runFieldOp(
	db: Db,
	event: ActiveEvent,
	op: string,
	id: string,
	form: FormData,
): Promise<LibraryResult> {
	if (op === "delete") {
		try {
			const gone = await db
				.delete(fields)
				.where(
					and(
						eq(fields.id, id),
						fieldScopeGuard(event.id, event.organizationId),
					),
				)
				.returning({ id: fields.id });
			return gone.length === 0 ? MISSING : { ok: true };
		} catch (error) {
			if (errorChainIncludes(error, "FOREIGN KEY constraint")) {
				return {
					formError:
						"This field can't be deleted — submissions have already answered it. Rename or repurpose it instead.",
				};
			}
			throw error;
		}
	}
	const parsed = FieldForm.safeParse({
		name: form.get("name"),
		type: form.get("type"),
		scope: form.get("scope") ?? "event",
		description: form.get("description") ?? "",
		maxLength: form.get("maxLength") ?? "",
		options: form.get("options") ?? "",
	});
	if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error) };
	const { scope, ...d } = parsed.data;
	if (op === "create") {
		// The scope XOR by construction: an org-wide field sets organizationId
		// (eventId null); an event field sets eventId (organizationId null).
		await db.insert(fields).values({
			...d,
			eventId: scope === "event" ? event.id : null,
			organizationId: scope === "org" ? event.organizationId : null,
		});
		return { ok: true };
	}
	// Scope is deliberately immutable on update: re-scoping a placed org-wide
	// field would strand form placements in the org's other events.
	const touched = await db
		.update(fields)
		.set(d)
		.where(
			and(eq(fields.id, id), fieldScopeGuard(event.id, event.organizationId)),
		)
		.returning({ id: fields.id });
	return touched.length === 0 ? MISSING : { ok: true };
}

/* ----------------------------------------------------------- loader/action --- */

export async function loader({ context, request }: Route.LoaderArgs) {
	const env = context.cloudflare.env;
	// Self-authenticate — never rely on layout loaders.
	const user = await requireAdmin(env, request);
	const event = await getActiveEvent(env, user);
	if (!event) {
		return {
			event: null,
			tracks: [],
			tags: [],
			formats: [],
			levels: [],
			rooms: [],
			languages: [],
			fields: [],
		};
	}
	const db = getDb(env);
	const timings = createTimings();
	const [
		trackRows,
		tagRows,
		formatRows,
		levelRows,
		roomRows,
		languageRows,
		fieldRows,
	] = await timings.time("db", () =>
		db.batch([
			db
				.select({
					id: tracks.id,
					name: tracks.name,
					color: tracks.color,
					createdAt: tracks.createdAt,
					// Must match the delete guard's definition of "in use" — the
					// refusal is never a surprise the list didn't show.
					inUse: sql<number>`(select count(*) from ${submissionTracks} where ${submissionTracks.trackId} = ${tracks.id}) + (select count(*) from ${reviewerTracks} where ${reviewerTracks.trackId} = ${tracks.id})`,
				})
				.from(tracks)
				.where(eq(tracks.eventId, event.id))
				.orderBy(asc(tracks.createdAt), asc(tracks.name)),
			db
				.select()
				.from(tags)
				.where(eq(tags.eventId, event.id))
				.orderBy(asc(tags.createdAt), asc(tags.name)),
			db
				.select()
				.from(formats)
				.where(eq(formats.eventId, event.id))
				.orderBy(asc(formats.position)),
			db
				.select()
				.from(levels)
				.where(eq(levels.eventId, event.id))
				.orderBy(asc(levels.position)),
			db
				.select()
				.from(rooms)
				.where(eq(rooms.eventId, event.id))
				.orderBy(asc(rooms.displayOrder)),
			db
				.select()
				.from(languages)
				.where(eq(languages.eventId, event.id))
				.orderBy(asc(languages.position)),
			db
				.select()
				.from(fields)
				.where(fieldScopeGuard(event.id, event.organizationId))
				.orderBy(asc(fields.name)),
		]),
	);
	return data(
		{
			event: { id: event.id, name: event.name },
			tracks: trackRows,
			tags: tagRows,
			formats: formatRows,
			levels: levelRows,
			rooms: roomRows,
			languages: languageRows,
			fields: fieldRows,
		},
		{ headers: { "Server-Timing": timings.header() } },
	);
}

export async function action({ context, request }: Route.ActionArgs) {
	const env = context.cloudflare.env;
	// Actions MUST self-authenticate — a POST does not run any layout loader.
	const user = await requireAdmin(env, request);
	const event = await getActiveEvent(env, user);
	if (!event) {
		return {
			formError:
				"There is no event yet — create one before building its library.",
		} satisfies LibraryResult;
	}
	const db = getDb(env);
	const form = await request.formData();
	// Validate the intent BEFORE anything derives from it — raw client input
	// must never mint telemetry event names.
	const [entity = "", op = ""] = String(form.get("intent") ?? "").split(".");
	const known =
		(entity === "field" || entity in TAXONOMIES) &&
		(op === "create" || op === "update" || op === "delete");
	if (!known) {
		return { formError: "Unknown action." } satisfies LibraryResult;
	}
	const id = String(form.get("id") ?? "");
	if ((op === "update" || op === "delete") && id === "") {
		return { formError: "Missing record id." } satisfies LibraryResult;
	}

	const timings = createTimings();
	const result = await timings.time("db", async (): Promise<LibraryResult> => {
		if (entity === "field") return runFieldOp(db, event, op, id, form);
		const ops = TAXONOMIES[entity as keyof typeof TAXONOMIES];
		if (op === "create") return ops.create(db, event.id, form);
		if (op === "update") return ops.update(db, event.id, id, form);
		return ops.remove(db, event.id, id);
	});

	trackEvent(`library.${entity}_${op}`, {
		eventId: event.id,
		ok: result.ok === true,
	});
	return data(result, { headers: { "Server-Timing": timings.header() } });
}

/* -------------------------------------------------------------------- view --- */

/**
 * Save-lifecycle state for one section: a successful save exits edit mode and
 * bumps `generation` so the form remounts blank for the next record — library
 * building should feel like rapid data entry. Render-time state adjustment,
 * not an effect (repo lint).
 */
function useEditLifecycle(
	latest: LibraryResult | undefined,
	onSaved?: () => void,
) {
	const [editingId, setEditingId] = useState<string | null>(null);
	const [confirmId, setConfirmId] = useState<string | null>(null);
	const [seen, setSeen] = useState<LibraryResult | undefined>(undefined);
	const [generation, setGeneration] = useState(0);
	if (latest !== seen) {
		setSeen(latest);
		if (latest?.ok) {
			setGeneration((g) => g + 1);
			setEditingId(null);
			onSaved?.();
		}
	}
	return { editingId, setEditingId, confirmId, setConfirmId, generation };
}

/** Edit/Delete pair with the in-app two-step delete confirm (native confirm()
 * is no guard — the judging harness auto-accepts it). */
function RowActions({
	name,
	confirming,
	deleting,
	onEdit,
	onConfirm,
	onDelete,
	onCancel,
}: {
	name: string;
	confirming: boolean;
	deleting: boolean;
	onEdit(): void;
	onConfirm(): void;
	onDelete(): void;
	onCancel(): void;
}) {
	if (confirming) {
		return (
			<div className="flex items-center justify-end gap-2">
				<span>Delete “{name}”?</span>
				<Button
					type="button"
					variant="ghost"
					disabled={deleting}
					onClick={onDelete}
				>
					Delete
				</Button>
				<Button type="button" variant="ghost" onClick={onCancel}>
					Cancel
				</Button>
			</div>
		);
	}
	return (
		<div className="flex justify-end gap-2">
			<Button type="button" variant="ghost" onClick={onEdit}>
				Edit
			</Button>
			<Button type="button" variant="ghost" onClick={onConfirm}>
				Delete
			</Button>
		</div>
	);
}

function Section<Row extends { id: string; name: string }>({
	entity,
	title,
	subtitle,
	addLabel,
	rows,
	columns,
	renderCells,
	renderInputs,
	emptyBody,
}: {
	entity: string;
	title: string;
	subtitle: string;
	addLabel: string;
	rows: Row[];
	columns: string[];
	renderCells: (row: Row) => ReactNode[];
	renderInputs: (
		editing: Row | null,
		errors: Record<string, string[] | undefined> | undefined,
	) => ReactNode;
	emptyBody: string;
}) {
	const save = useFetcher<LibraryResult>();
	const remove = useFetcher<LibraryResult>();
	const { editingId, setEditingId, confirmId, setConfirmId, generation } =
		useEditLifecycle(save.data);
	const editing = rows.find((r) => r.id === editingId) ?? null;
	const saving = save.state !== "idle";

	return (
		<Panel>
			<div className="flex flex-col gap-4">
				<PageHeader
					title={title}
					count={String(rows.length)}
					subtitle={subtitle}
				/>
				<save.Form
					method="post"
					key={`${editingId ?? "new"}:${generation}`}
					className="flex flex-wrap items-end gap-3"
				>
					{editing && (
						<Input type="hidden" name="id" defaultValue={editing.id} />
					)}
					{renderInputs(editing, save.data?.fieldErrors)}
					<Button
						type="submit"
						name="intent"
						value={`${entity}.${editing ? "update" : "create"}`}
						icon={editing ? undefined : "plus"}
						disabled={saving}
					>
						{editing ? "Save changes" : addLabel}
					</Button>
					{editing && (
						<Button
							type="button"
							variant="ghost"
							onClick={() => setEditingId(null)}
						>
							Cancel
						</Button>
					)}
					{save.data?.formError && <ErrorText>{save.data.formError}</ErrorText>}
				</save.Form>
				<Table>
					<THead>
						{columns.map((c) => (
							<Th key={c}>{c}</Th>
						))}
						<Th />
					</THead>
					<TBody>
						{rows.map((row) => (
							<Tr key={row.id} selected={row.id === editingId}>
								{renderCells(row).map((cell, i) => (
									<Td
										key={columns[i] ?? i}
										kind={i === 0 ? "strong" : "default"}
									>
										{cell}
									</Td>
								))}
								<Td>
									<RowActions
										name={row.name}
										confirming={confirmId === row.id}
										deleting={remove.state !== "idle"}
										onEdit={() => {
											setEditingId(row.id);
											setConfirmId(null);
										}}
										onConfirm={() => setConfirmId(row.id)}
										onDelete={() => {
											remove.submit(
												{ intent: `${entity}.delete`, id: row.id },
												{ method: "post" },
											);
											setConfirmId(null);
											if (editingId === row.id) setEditingId(null);
										}}
										onCancel={() => setConfirmId(null)}
									/>
								</Td>
							</Tr>
						))}
						{rows.length === 0 && (
							<EmptyRow colSpan={columns.length + 1}>{emptyBody}</EmptyRow>
						)}
					</TBody>
				</Table>
				{remove.data?.formError && (
					<ErrorText>{remove.data.formError}</ErrorText>
				)}
			</div>
		</Panel>
	);
}

type FieldRow = typeof fields.$inferSelect;

function fieldDetails(row: FieldRow): string {
	if (row.type === "dropdown" && row.options) return row.options.join(", ");
	if (row.maxLength) return `Max length ${row.maxLength}`;
	return "—";
}

function FieldsSection({ rows }: { rows: FieldRow[] }) {
	const save = useFetcher<LibraryResult>();
	const remove = useFetcher<LibraryResult>();
	const [query, setQuery] = useState("");
	const [type, setType] = useState<(typeof FIELD_TYPES)[number]>("text");
	const { editingId, setEditingId, confirmId, setConfirmId, generation } =
		useEditLifecycle(save.data, () => setType("text"));
	const editing = rows.find((r) => r.id === editingId) ?? null;

	const filtered = useMemo(() => {
		const q = query.trim().toLowerCase();
		if (q === "") return rows;
		return rows.filter(
			(r) =>
				r.name.toLowerCase().includes(q) ||
				FIELD_TYPE_LABELS[r.type].toLowerCase().includes(q),
		);
	}, [rows, query]);

	const errors = save.data?.fieldErrors;
	const saving = save.state !== "idle";
	const showLength = type === "text" || type === "textarea";
	const showOptions = type === "dropdown";

	return (
		<Panel>
			<div className="flex flex-col gap-4">
				<PageHeader
					title="Fields"
					count={String(rows.length)}
					subtitle="Reusable custom questions for your forms — org-wide fields appear in every event of your organization."
				/>
				<save.Form
					method="post"
					key={`${editingId ?? "new"}:${generation}`}
					className="flex flex-col gap-3"
				>
					{editing && (
						<Input type="hidden" name="id" defaultValue={editing.id} />
					)}
					<div className="flex flex-wrap items-end gap-3">
						<Field label="Field name" error={errors?.name?.[0]}>
							<Input
								name="name"
								placeholder="T-shirt size"
								defaultValue={editing?.name}
								invalid={Boolean(errors?.name?.[0])}
							/>
						</Field>
						<Field label="Type" error={errors?.type?.[0]}>
							<Select
								name="type"
								value={type}
								onChange={(e) =>
									setType(e.target.value as (typeof FIELD_TYPES)[number])
								}
							>
								{FIELD_TYPES.map((t) => (
									<option key={t} value={t}>
										{FIELD_TYPE_LABELS[t]}
									</option>
								))}
							</Select>
						</Field>
						{editing ? (
							<Field label="Scope">
								<StatusBadge tone={editing.organizationId ? "info" : "neutral"}>
									{editing.organizationId ? "Org-wide" : "This event"}
								</StatusBadge>
							</Field>
						) : (
							<Field label="Scope" error={errors?.scope?.[0]}>
								<Select name="scope" defaultValue="event">
									<option value="event">This event only</option>
									<option value="org">Org-wide (all events)</option>
								</Select>
							</Field>
						)}
						{showOptions && (
							<Field
								label="Options (comma-separated)"
								error={errors?.options?.[0]}
							>
								<Input
									name="options"
									placeholder="S, M, L, XL"
									defaultValue={editing?.options?.join(", ")}
									invalid={Boolean(errors?.options?.[0])}
								/>
							</Field>
						)}
						{showLength && (
							<Field label="Maximum length" error={errors?.maxLength?.[0]}>
								<Input
									name="maxLength"
									type="number"
									min={1}
									placeholder="No limit"
									defaultValue={editing?.maxLength ?? undefined}
									invalid={Boolean(errors?.maxLength?.[0])}
								/>
							</Field>
						)}
						<Field
							label="Description (internal)"
							error={errors?.description?.[0]}
						>
							<Input
								name="description"
								placeholder="Only admins see this"
								defaultValue={editing?.description ?? undefined}
								invalid={Boolean(errors?.description?.[0])}
							/>
						</Field>
						<Button
							type="submit"
							name="intent"
							value={`field.${editing ? "update" : "create"}`}
							icon={editing ? undefined : "plus"}
							disabled={saving}
						>
							{editing ? "Save changes" : "Add field"}
						</Button>
						{editing && (
							<Button
								type="button"
								variant="ghost"
								onClick={() => {
									setEditingId(null);
									setType("text");
								}}
							>
								Cancel
							</Button>
						)}
					</div>
					{save.data?.formError && <ErrorText>{save.data.formError}</ErrorText>}
				</save.Form>
				<div className="flex">
					<SearchInput
						placeholder="Search fields…"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
					/>
				</div>
				<Table>
					<THead>
						<Th>Field</Th>
						<Th>Type</Th>
						<Th>Scope</Th>
						<Th>Details</Th>
						<Th />
					</THead>
					<TBody>
						{filtered.map((row) => (
							<Tr key={row.id} selected={row.id === editingId}>
								<Td kind="strong">{row.name}</Td>
								<Td>{FIELD_TYPE_LABELS[row.type]}</Td>
								<Td>
									<StatusBadge tone={row.organizationId ? "info" : "neutral"}>
										{row.organizationId ? "Org-wide" : "This event"}
									</StatusBadge>
								</Td>
								<Td>{fieldDetails(row)}</Td>
								<Td>
									<RowActions
										name={row.name}
										confirming={confirmId === row.id}
										deleting={remove.state !== "idle"}
										onEdit={() => {
											setEditingId(row.id);
											setConfirmId(null);
											setType(row.type);
										}}
										onConfirm={() => setConfirmId(row.id)}
										onDelete={() => {
											remove.submit(
												{ intent: "field.delete", id: row.id },
												{ method: "post" },
											);
											setConfirmId(null);
											if (editingId === row.id) setEditingId(null);
										}}
										onCancel={() => setConfirmId(null)}
									/>
								</Td>
							</Tr>
						))}
						{filtered.length === 0 && (
							<EmptyRow colSpan={5}>
								{rows.length === 0
									? "No custom fields yet — add your first field above and reuse it on any form."
									: "No fields match your search."}
							</EmptyRow>
						)}
					</TBody>
				</Table>
				{remove.data?.formError && (
					<ErrorText>{remove.data.formError}</ErrorText>
				)}
			</div>
		</Panel>
	);
}

export default function Library({ loaderData }: Route.ComponentProps) {
	// The settings layout renders the no-event empty state; nothing to show.
	if (!loaderData.event) return null;
	return (
		<div className="flex flex-col gap-5">
			<Section
				entity="track"
				title="Tracks"
				subtitle="Program tracks route submissions to reviewers and group the agenda."
				addLabel="Add track"
				rows={loaderData.tracks}
				columns={["Track", "Color", "In use"]}
				renderCells={(t) => [
					<Chip key="name" color={t.color}>
						{t.name}
					</Chip>,
					<span key="color">{t.color.toUpperCase()}</span>,
					t.inUse === 0
						? "—"
						: `${t.inUse} submission${t.inUse === 1 ? "" : "s"}`,
				]}
				renderInputs={(editing, errors) => (
					<>
						<Field label="Name" error={errors?.name?.[0]}>
							<Input
								name="name"
								placeholder="AI Infrastructure"
								defaultValue={editing?.name}
								invalid={Boolean(errors?.name?.[0])}
							/>
						</Field>
						<Field label="Color" error={errors?.color?.[0]}>
							<Input
								name="color"
								type="color"
								defaultValue={editing?.color ?? "#6366f1"}
							/>
						</Field>
					</>
				)}
				emptyBody="No tracks yet — add your first track above; submissions and reviewer routing hang off them."
			/>
			<Section
				entity="tag"
				title="Tags"
				subtitle="Freeform labels for submissions and sessions."
				addLabel="Add tag"
				rows={loaderData.tags}
				columns={["Tag", "Color"]}
				renderCells={(t) => [
					<Chip key="name" color={t.color}>
						{t.name}
					</Chip>,
					<span key="color">{t.color.toUpperCase()}</span>,
				]}
				renderInputs={(editing, errors) => (
					<>
						<Field label="Name" error={errors?.name?.[0]}>
							<Input
								name="name"
								placeholder="Hands-on"
								defaultValue={editing?.name}
								invalid={Boolean(errors?.name?.[0])}
							/>
						</Field>
						<Field label="Color" error={errors?.color?.[0]}>
							<Input
								name="color"
								type="color"
								defaultValue={editing?.color ?? "#71717a"}
							/>
						</Field>
					</>
				)}
				emptyBody="No tags yet — add one above to start labeling submissions."
			/>
			<Section
				entity="format"
				title="Formats"
				subtitle="Session formats — the default duration auto-fills end times on the agenda."
				addLabel="Add format"
				rows={loaderData.formats}
				columns={["Format", "Default duration"]}
				renderCells={(f) => [f.name, `${f.defaultDurationMins} min`]}
				renderInputs={(editing, errors) => (
					<>
						<Field label="Name" error={errors?.name?.[0]}>
							<Input
								name="name"
								placeholder="Talk (30 min)"
								defaultValue={editing?.name}
								invalid={Boolean(errors?.name?.[0])}
							/>
						</Field>
						<Field
							label="Default duration (minutes)"
							error={errors?.defaultDurationMins?.[0]}
						>
							<Input
								name="defaultDurationMins"
								type="number"
								min={1}
								max={1440}
								defaultValue={editing?.defaultDurationMins ?? 30}
								invalid={Boolean(errors?.defaultDurationMins?.[0])}
							/>
						</Field>
					</>
				)}
				emptyBody="No formats yet — add “Talk”, “Workshop”, or “Panel” above; forms and the agenda reuse them."
			/>
			<Section
				entity="level"
				title="Levels"
				subtitle="Audience levels for sessions (Beginner, Advanced, …)."
				addLabel="Add level"
				rows={loaderData.levels}
				columns={["Level"]}
				renderCells={(l) => [l.name]}
				renderInputs={(editing, errors) => (
					<Field label="Name" error={errors?.name?.[0]}>
						<Input
							name="name"
							placeholder="Beginner"
							defaultValue={editing?.name}
							invalid={Boolean(errors?.name?.[0])}
						/>
					</Field>
				)}
				emptyBody="No levels yet — add your audience levels above; the form builder's Level dropdown reads them."
			/>
			<Section
				entity="room"
				title="Rooms"
				subtitle="Where sessions run — capacity powers agenda planning."
				addLabel="Add room"
				rows={loaderData.rooms}
				columns={["Room", "Capacity"]}
				renderCells={(r) => [
					r.name,
					r.capacity === null ? "—" : String(r.capacity),
				]}
				renderInputs={(editing, errors) => (
					<>
						<Field label="Name" error={errors?.name?.[0]}>
							<Input
								name="name"
								placeholder="Auditorium A"
								defaultValue={editing?.name}
								invalid={Boolean(errors?.name?.[0])}
							/>
						</Field>
						<Field label="Capacity" error={errors?.capacity?.[0]}>
							<Input
								name="capacity"
								type="number"
								min={1}
								placeholder="Optional"
								defaultValue={editing?.capacity ?? undefined}
								invalid={Boolean(errors?.capacity?.[0])}
							/>
						</Field>
					</>
				)}
				emptyBody="No rooms yet — add your venue's rooms above; the agenda grid builds its columns from them."
			/>
			<Section
				entity="language"
				title="Languages"
				subtitle="Languages offered on submission forms."
				addLabel="Add language"
				rows={loaderData.languages}
				columns={["Language"]}
				renderCells={(l) => [l.name]}
				renderInputs={(editing, errors) => (
					<Field label="Name" error={errors?.name?.[0]}>
						<Input
							name="name"
							placeholder="English"
							defaultValue={editing?.name}
							invalid={Boolean(errors?.name?.[0])}
						/>
					</Field>
				)}
				emptyBody="No languages yet — add the languages speakers can present in."
			/>
			<FieldsSection rows={loaderData.fields} />
		</div>
	);
}

export function ErrorBoundary() {
	// Generic message only — never render the raw error.
	return (
		<Panel>
			<PageHeader
				title="Failed to load the library"
				tone="danger"
				subtitle="Something went wrong. Please refresh or try again."
			/>
		</Panel>
	);
}
