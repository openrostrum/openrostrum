import {
	type CollisionDetection,
	DndContext,
	type DragEndEvent,
	DragOverlay,
	type DragStartEvent,
	KeyboardSensor,
	PointerSensor,
	pointerWithin,
	rectIntersection,
	useDraggable,
	useDroppable,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import {
	Button,
	Chip,
	DialogSurface,
	EmptyState,
	ErrorText,
	Select,
	StatusBadge,
	SUBMISSION_STATUS_TONE,
} from "~/ui";
import { cn } from "~/ui/cn";
import {
	type AgendaRoom,
	type AgendaSession,
	type Conflict,
	classifyAgendaSessions,
	conflictSentence,
	formatDayLabel,
	formatMinutes,
	formatRangeMs,
	hasCompletePlacement,
	type LogicalConflict,
	layoutLanes,
	matchesSessionFilters,
	pickFreeRoom,
	type SessionFilters,
	SLOT_MINS,
	sessionDurationMins,
	utcToWall,
	wallToUtc,
} from "./lib";

// Grid scale: one 15-min slot = 16px, so an hour is 64px and a 10-hour day
// window is 640px — dense enough to survey a full day, tall enough to grab a
// 30-min block.
const SLOT_PX = 16;
const PX_PER_MIN = SLOT_PX / SLOT_MINS;

export type BoardView = "day" | "week" | "track";

export type BoardFilters = SessionFilters;

type BoardProps = {
	view: BoardView;
	days: string[];
	activeDay: string;
	timezone: string;
	dayStartMin: number;
	dayEndMin: number;
	rooms: AgendaRoom[];
	tracks: { id: string; name: string; color: string }[];
	sessions: AgendaSession[];
	conflicts: Map<string, Conflict[]>;
	filters: BoardFilters;
	onSchedule: (
		sessionId: string,
		day: string,
		minutes: number,
		roomId: string,
	) => void;
	onUnschedule: (sessionId: string) => void;
};

function isDraft(s: AgendaSession): boolean {
	return s.status === "draft";
}

/**
 * A drop lands where the POINTER is — rect-overlap collision let a wide block
 * "touch" the tray while the mouse sat on a 16px grid cell. Keyboard drags
 * have no pointer, so rect intersection remains their fallback.
 */
const pointerFirstCollision: CollisionDetection = (args) => {
	const withPointer = pointerWithin(args);
	return withPointer.length > 0 ? withPointer : rectIntersection(args);
};

/* ------------------------------------------------------------------ bits --- */

export function ConflictClock({ label }: { label: string }) {
	return (
		<svg
			viewBox="0 0 24 24"
			className="h-[14px] w-[14px] shrink-0 text-danger"
			fill="none"
			stroke="currentColor"
			strokeWidth={2.4}
			strokeLinecap="round"
			role="img"
			aria-label={label}
		>
			<circle cx="12" cy="12" r="8.5" />
			<path d="M12 7.5V12l3 2" />
		</svg>
	);
}

/** Informational strip (e.g. “N accepted sessions still need a time slot”). */
export function InfoBar({ children }: { children: ReactNode }) {
	return (
		<div className="rounded-card bg-chip px-4 py-[9px] text-[12.5px] text-fg-muted">
			{children}
		</div>
	);
}

export function InfoBarActionRow({ children }: { children: ReactNode }) {
	return (
		<div className="flex flex-wrap items-center justify-between gap-2">
			{children}
		</div>
	);
}

export function Strong({ children }: { children: ReactNode }) {
	return <span className="font-semibold text-fg">{children}</span>;
}

const PUBLISH_CONFLICT_PREVIEW_LIMIT = 8;

export function PublishAgendaDialog({
	conflicts,
	total,
	timezone,
	submitting,
	error,
	onCancel,
	onPublish,
}: {
	conflicts: readonly LogicalConflict[];
	total: number;
	timezone: string;
	submitting: boolean;
	error: string | null;
	onCancel: () => void;
	onPublish: () => void;
}) {
	const dialogRef = useRef<HTMLDivElement>(null);
	const submittingRef = useRef(submitting);
	useEffect(() => {
		submittingRef.current = submitting;
	}, [submitting]);

	useEffect(() => {
		const previous =
			document.activeElement instanceof HTMLElement
				? document.activeElement
				: null;
		const focusable = () =>
			Array.from(
				dialogRef.current?.querySelectorAll<HTMLElement>(
					'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
				) ?? [],
			);
		focusable()[0]?.focus();
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape" && !submittingRef.current) {
				event.preventDefault();
				onCancel();
				return;
			}
			if (event.key !== "Tab") return;
			const candidates = focusable();
			if (candidates.length === 0) {
				event.preventDefault();
				return;
			}
			const first = candidates[0];
			const last = candidates[candidates.length - 1];
			const active = document.activeElement;
			if (!dialogRef.current?.contains(active)) {
				event.preventDefault();
				first?.focus();
			} else if (event.shiftKey && active === first) {
				event.preventDefault();
				last?.focus();
			} else if (!event.shiftKey && active === last) {
				event.preventDefault();
				first?.focus();
			}
		};
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("keydown", onKey);
			previous?.focus();
		};
	}, [onCancel]);

	const preview = conflicts.slice(0, PUBLISH_CONFLICT_PREVIEW_LIMIT);
	const remaining = total - preview.length;
	const hasConflicts = total > 0;
	return (
		<DialogSurface
			role="alertdialog"
			size="md"
			labelledBy="publish-agenda-title"
			describedBy="publish-agenda-description"
			panelRef={dialogRef}
		>
			<div className="flex flex-col gap-4">
				<div className="flex flex-col gap-2">
					<Strong>
						<span id="publish-agenda-title">
							{hasConflicts
								? `Publish with ${total} unresolved ${total === 1 ? "conflict" : "conflicts"}?`
								: "Publish agenda?"}
						</span>
					</Strong>
					<p id="publish-agenda-description">
						{hasConflicts
							? "Attendees will see these overlapping sessions. Publishing does not resolve them, but you can publish anyway and fix the schedule afterward."
							: "The approved agenda becomes available on the public schedule immediately."}
					</p>
				</div>
				{preview.length > 0 && (
					<div
						role="list"
						className="flex max-h-72 flex-col gap-3 overflow-y-auto"
					>
						{preview.map((conflict) => (
							<div
								key={`${conflict.aId}|${conflict.bId}`}
								role="listitem"
								className="flex flex-col gap-1"
							>
								<span>
									<Strong>{conflict.aTitle}</Strong> ↔{" "}
									<Strong>{conflict.bTitle}</Strong>
								</span>
								<span>
									{conflict.reasons
										.map((reason) =>
											conflictSentence(
												{ ...conflict, ...reason },
												conflict.aId,
												timezone,
											),
										)
										.join(" ")}
								</span>
							</div>
						))}
						{remaining > 0 && <p>And {remaining} more in the Conflicts tab.</p>}
					</div>
				)}
				{error && <ErrorText>{error}</ErrorText>}
				<div className="flex justify-end gap-2">
					<Button
						type="button"
						variant="ghost"
						disabled={submitting}
						onClick={onCancel}
					>
						Cancel
					</Button>
					<Button type="button" disabled={submitting} onClick={onPublish}>
						{submitting
							? "Publishing…"
							: hasConflicts
								? "Publish anyway"
								: "Publish agenda"}
					</Button>
				</div>
			</div>
		</DialogSurface>
	);
}

/** Group heading for form sections that must NOT be a wrapping <label>
 * (a label would forward clicks to its first button). */
export function SectionLabel({
	children,
	hint,
}: {
	children: ReactNode;
	hint?: string;
}) {
	return (
		<div className="flex flex-col gap-[2px]">
			<span className="text-[12.5px] font-medium text-fg-muted">
				{children}
			</span>
			{hint && <span className="text-[11.5px] text-fg-faint">{hint}</span>}
		</div>
	);
}

const CHIP_BTN = cn(
	"inline-flex h-[28px] items-center gap-[6px] rounded-full px-[12px] text-[12.5px] font-medium",
	"transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-petrol",
);

/** Chip-shaped toggle button — petrol marks “chosen”, per the design law. */
export function FilterChip({
	active,
	onClick,
	stopPointerDown,
	children,
}: {
	active: boolean;
	onClick: () => void;
	/** Keep a press from starting a drag when the chip sits on a draggable. */
	stopPointerDown?: boolean;
	children: ReactNode;
}) {
	return (
		<button
			type="button"
			aria-pressed={active}
			onPointerDown={stopPointerDown ? (e) => e.stopPropagation() : undefined}
			onClick={onClick}
			className={cn(
				CHIP_BTN,
				active
					? "bg-petrol-wash text-petrol"
					: "bg-chip text-fg-muted hover:text-fg",
			)}
		>
			{children}
		</button>
	);
}

/** Multi-select rendered as toggle chips; selected values ride hidden inputs. */
export function ToggleChips({
	name,
	options,
	initial,
}: {
	name: string;
	options: { value: string; label: string }[];
	initial: string[];
}) {
	const [selected, setSelected] = useState(() => new Set(initial));
	return (
		<div className="flex flex-wrap items-center gap-2">
			{options.map((opt) => (
				<FilterChip
					key={opt.value}
					active={selected.has(opt.value)}
					onClick={() =>
						setSelected((prev) => {
							const next = new Set(prev);
							if (next.has(opt.value)) next.delete(opt.value);
							else next.add(opt.value);
							return next;
						})
					}
				>
					{opt.label}
				</FilterChip>
			))}
			{/* presence marker: lets the action tell "none selected" apart from
			    "field not submitted at all" */}
			<input type="hidden" name={`${name}_present`} value="1" />
			{[...selected].map((value) => (
				<input key={value} type="hidden" name={name} value={value} />
			))}
		</div>
	);
}

/* ---------------------------------------------------------------- blocks --- */

function conflictTitle(
	conflicts: Conflict[] | undefined,
	id: string,
	timezone: string,
): string | null {
	if (!conflicts || conflicts.length === 0) return null;
	return conflicts.map((c) => conflictSentence(c, id, timezone)).join("\n");
}

function GridBlock({
	session,
	conflicts,
	timezone,
	top,
	height,
	lane,
	laneCount,
	dimmed,
	subtitle,
	draggable,
	onUnschedule,
}: {
	session: AgendaSession;
	conflicts: Conflict[] | undefined;
	timezone: string;
	top: number;
	height: number;
	lane: number;
	laneCount: number;
	dimmed: boolean;
	subtitle?: string;
	draggable: boolean;
	onUnschedule?: (id: string) => void;
}) {
	const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
		id: `session|${session.id}`,
		data: { session },
		disabled: !draggable,
	});
	const conflictLabel = conflictTitle(conflicts, session.id, timezone);
	const track = session.tracks[0];
	const width = 100 / laneCount;
	const timeLabel =
		session.startsAt != null && session.endsAt != null
			? formatRangeMs(session.startsAt, session.endsAt, timezone)
			: "";
	return (
		<div
			ref={setNodeRef}
			{...listeners}
			{...attributes}
			title={
				conflictLabel
					? `${session.title}\n${timeLabel}\n${conflictLabel}`
					: `${session.title}\n${timeLabel}`
			}
			className={cn(
				"group absolute overflow-hidden rounded-control bg-surface p-[6px] text-left shadow-card",
				"outline-1 -outline-offset-1 outline-hair",
				draggable && "cursor-grab touch-none",
				isDragging && "opacity-40",
				dimmed && "pointer-events-none opacity-30",
				isDraft(session) && "opacity-60",
				conflictLabel && "outline-2 -outline-offset-2 outline-danger",
			)}
			style={{
				top,
				height: Math.max(height, SLOT_PX),
				left: `calc(${lane * width}% + 2px)`,
				width: `calc(${width}% - 4px)`,
				borderLeft: `3px solid ${track?.color ?? "var(--color-hair-strong)"}`,
			}}
		>
			<div className="flex items-start gap-1">
				{conflictLabel && <ConflictClock label="Scheduling conflict" />}
				<span className="min-w-0 flex-1 truncate text-[12px] font-medium leading-[15px] text-fg">
					{session.title}
				</span>
			</div>
			{height >= SLOT_PX * 2 && (
				<div className="truncate font-mono text-[10.5px] leading-[14px] text-fg-muted">
					{timeLabel}
					{subtitle ? ` · ${subtitle}` : ""}
				</div>
			)}
			{onUnschedule && (
				<span className="absolute right-1 top-1 hidden gap-1 group-hover:flex">
					<Link
						to={`/admin/submissions/${session.id}`}
						onPointerDown={(e) => e.stopPropagation()}
						title="Open session editor"
						className="rounded-[4px] bg-chip px-[6px] text-[10.5px] font-medium leading-[18px] text-fg-muted hover:text-fg"
					>
						Edit
					</Link>
					<button
						type="button"
						onPointerDown={(e) => e.stopPropagation()}
						onClick={() => onUnschedule(session.id)}
						title="Unschedule (back to the tray)"
						className="rounded-[4px] bg-chip px-[6px] text-[10.5px] font-medium leading-[18px] text-fg-muted hover:text-danger"
					>
						✕
					</button>
				</span>
			)}
		</div>
	);
}

/**
 * Click-to-assign fallback beside drag-and-drop: an inline day/time/room
 * picker on unscheduled cards, for keyboard users and automation that can't
 * synthesize a pointer drag.
 */
function PlaceInline({
	session,
	days,
	rooms,
	dayStartMin,
	dayEndMin,
	onSchedule,
}: {
	session: AgendaSession;
	days: string[];
	rooms: AgendaRoom[];
	dayStartMin: number;
	dayEndMin: number;
	onSchedule: (
		sessionId: string,
		day: string,
		minutes: number,
		roomId: string,
	) => void;
}) {
	const [open, setOpen] = useState(false);
	const [day, setDay] = useState(days[0] ?? "");
	const [minutes, setMinutes] = useState(dayStartMin);
	const [roomId, setRoomId] = useState(rooms[0]?.id ?? "");
	const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
	if (rooms.length === 0 || days.length === 0) return null;
	if (!open) {
		return (
			<div className="mt-[6px]">
				<FilterChip
					active={false}
					stopPointerDown
					onClick={() => setOpen(true)}
				>
					Place…
				</FilterChip>
			</div>
		);
	}
	const times: number[] = [];
	for (let m = dayStartMin; m < dayEndMin; m += SLOT_MINS) times.push(m);
	return (
		<div
			role="group"
			aria-label={`Place ${session.title}`}
			className="mt-[6px] flex flex-col gap-[5px]"
		>
			<Select
				aria-label="Day"
				onPointerDown={stop}
				onKeyDown={stop}
				value={day}
				onChange={(e) => setDay(e.currentTarget.value)}
			>
				{days.map((d) => (
					<option key={d} value={d}>
						{formatDayLabel(d)}
					</option>
				))}
			</Select>
			<Select
				aria-label="Start time"
				onPointerDown={stop}
				onKeyDown={stop}
				value={minutes}
				onChange={(e) => setMinutes(Number(e.currentTarget.value))}
			>
				{times.map((m) => (
					<option key={m} value={m}>
						{formatMinutes(m)}
					</option>
				))}
			</Select>
			<Select
				aria-label="Room"
				onPointerDown={stop}
				onKeyDown={stop}
				value={roomId}
				onChange={(e) => setRoomId(e.currentTarget.value)}
			>
				{rooms.map((r) => (
					<option key={r.id} value={r.id}>
						{r.name}
					</option>
				))}
			</Select>
			<div className="flex gap-[5px]">
				<Button
					type="button"
					onPointerDown={stop}
					onClick={() => {
						onSchedule(session.id, day, minutes, roomId);
						setOpen(false);
					}}
				>
					Place
				</Button>
				<Button
					type="button"
					variant="ghost"
					onPointerDown={stop}
					onClick={() => setOpen(false)}
				>
					Cancel
				</Button>
			</div>
		</div>
	);
}

function TrayCard({
	session,
	conflicts,
	timezone,
	dimmed,
	place,
}: {
	session: AgendaSession;
	conflicts?: Conflict[] | undefined;
	timezone: string;
	dimmed?: boolean;
	place?: {
		days: string[];
		rooms: AgendaRoom[];
		dayStartMin: number;
		dayEndMin: number;
		onSchedule: (
			sessionId: string,
			day: string,
			minutes: number,
			roomId: string,
		) => void;
	};
}) {
	const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
		id: `session|${session.id}`,
		data: { session },
		disabled: !session.schedulable,
	});
	const conflictLabel = conflictTitle(conflicts, session.id, timezone);
	return (
		<div
			ref={setNodeRef}
			{...listeners}
			{...attributes}
			className={cn(
				"rounded-control bg-surface p-[9px] shadow-control",
				session.schedulable ? "cursor-grab touch-none" : "opacity-70",
				isDragging && "opacity-40",
				dimmed && "opacity-40",
				isDraft(session) && "opacity-60",
			)}
		>
			<div className="flex items-start gap-[6px]">
				{conflictLabel && <ConflictClock label="Scheduling conflict" />}
				<span className="min-w-0 flex-1 text-[12.5px] font-medium leading-[16px] text-fg">
					{session.title}
				</span>
			</div>
			<div className="mt-[3px] flex flex-wrap items-center gap-x-2 gap-y-[2px] font-mono text-[10.5px] text-fg-muted">
				<span>
					{session.formatName ?? "No format"} · {session.durationMins}m
				</span>
				{session.startsAt != null && session.endsAt != null && (
					<span>
						{formatRangeMs(session.startsAt, session.endsAt, timezone)}
					</span>
				)}
			</div>
			{(session.tracks.length > 0 || session.speakers.length > 0) && (
				<div className="mt-[5px] flex flex-wrap items-center gap-x-3 gap-y-1">
					{session.tracks.map((t) => (
						<Chip key={t.id} color={t.color}>
							{t.name}
						</Chip>
					))}
					{session.speakers.length > 0 && (
						<span className="text-[11px] text-fg-faint">
							{session.speakers.map((s) => s.name).join(", ")}
						</span>
					)}
				</div>
			)}
			{session.status !== "accepted" && (
				<div className="mt-[5px]">
					<StatusBadge
						tone={
							SUBMISSION_STATUS_TONE[
								session.status as keyof typeof SUBMISSION_STATUS_TONE
							] ?? "neutral"
						}
					>
						{session.status.replace("_", " ")}
					</StatusBadge>
				</div>
			)}
			{place && session.schedulable && !hasCompletePlacement(session) && (
				<PlaceInline
					session={session}
					days={place.days}
					rooms={place.rooms}
					dayStartMin={place.dayStartMin}
					dayEndMin={place.dayEndMin}
					onSchedule={place.onSchedule}
				/>
			)}
		</div>
	);
}

/* ----------------------------------------------------------------- cells --- */

function SlotCell({
	id,
	minutes,
	isHour,
}: {
	id: string;
	minutes: number;
	isHour: boolean;
}) {
	const { setNodeRef, isOver } = useDroppable({ id });
	return (
		<div
			ref={setNodeRef}
			data-slot={id}
			style={{ height: SLOT_PX }}
			className={cn(
				isHour && "border-t border-hair",
				isOver && "rounded-[4px] bg-petrol-wash",
			)}
		>
			{isOver && (
				<span className="pl-1 font-mono text-[9.5px] leading-[16px] text-petrol">
					{formatMinutes(minutes)}
				</span>
			)}
		</div>
	);
}

function TimeGutter({
	dayStartMin,
	dayEndMin,
}: {
	dayStartMin: number;
	dayEndMin: number;
}) {
	const hours: number[] = [];
	for (let m = dayStartMin; m < dayEndMin; m += 60) hours.push(m);
	return (
		<div className="relative w-[52px] shrink-0">
			{/* spacer matching the column header row, so hour labels align with their grid lines */}
			<div className="h-[34px] border-b border-hair" />
			{hours.map((m) => (
				<div
					key={m}
					style={{ height: Math.min(60, dayEndMin - m) * PX_PER_MIN }}
					className="pr-2 text-right font-mono text-[10px] leading-[14px] text-fg-faint"
				>
					{formatMinutes(m)}
				</div>
			))}
		</div>
	);
}

/* ---------------------------------------------------------------- columns --- */

type ColumnBlock = {
	session: AgendaSession;
	startMin: number;
	endMin: number;
	subtitle?: string;
};

function GridColumn({
	header,
	blocks,
	dayStartMin,
	dayEndMin,
	timezone,
	conflicts,
	filters,
	droppableFor,
	onUnschedule,
	draggable,
}: {
	header: ReactNode;
	blocks: ColumnBlock[];
	dayStartMin: number;
	dayEndMin: number;
	timezone: string;
	conflicts: Map<string, Conflict[]>;
	filters: BoardFilters;
	/** cell-id builder; null disables drops for this column (Track view). */
	droppableFor: ((minutes: number) => string) | null;
	onUnschedule?: (id: string) => void;
	draggable: boolean;
}) {
	const lanes = useMemo(
		() =>
			layoutLanes(
				blocks.map((b) => ({
					id: b.session.id,
					start: b.startMin,
					end: b.endMin,
				})),
			),
		[blocks],
	);
	const peakLaneCount = Math.max(
		1,
		...[...lanes.values()].map((lane) => lane.laneCount),
	);
	const slots: number[] = [];
	for (let m = dayStartMin; m < dayEndMin; m += SLOT_MINS) slots.push(m);
	return (
		<div
			className="min-w-[148px] flex-1 border-l border-hair"
			style={{ minWidth: Math.max(148, peakLaneCount * 140) }}
		>
			<div className="sticky top-0 z-10 h-[34px] truncate border-b border-hair bg-thead px-2 text-[11px] font-semibold uppercase leading-[34px] tracking-[0.06em] text-fg-muted">
				{header}
			</div>
			<div className="relative">
				{slots.map((m) =>
					droppableFor ? (
						<SlotCell
							key={m}
							id={droppableFor(m)}
							minutes={m}
							isHour={m % 60 === 0}
						/>
					) : (
						<div
							key={m}
							style={{ height: SLOT_PX }}
							className={cn(m % 60 === 0 && "border-t border-hair")}
						/>
					),
				)}
				{blocks.map((b) => {
					const clippedStart = Math.max(b.startMin, dayStartMin);
					const clippedEnd = Math.min(b.endMin, dayEndMin);
					if (clippedEnd <= clippedStart) return null;
					const lane = lanes.get(b.session.id) ?? { lane: 0, laneCount: 1 };
					return (
						<GridBlock
							key={b.session.id}
							session={b.session}
							conflicts={conflicts.get(b.session.id)}
							timezone={timezone}
							top={(clippedStart - dayStartMin) * PX_PER_MIN}
							height={(clippedEnd - clippedStart) * PX_PER_MIN - 2}
							lane={lane.lane}
							laneCount={lane.laneCount}
							dimmed={!matchesSessionFilters(b.session, filters)}
							subtitle={b.subtitle}
							draggable={draggable && b.session.schedulable}
							onUnschedule={b.session.schedulable ? onUnschedule : undefined}
						/>
					);
				})}
			</div>
		</div>
	);
}

/* ------------------------------------------------------------------ tray --- */

function Tray({
	unscheduled,
	scheduled,
	timezone,
	conflicts,
	place,
}: {
	unscheduled: AgendaSession[];
	scheduled: AgendaSession[];
	timezone: string;
	conflicts: Map<string, Conflict[]>;
	place: NonNullable<Parameters<typeof TrayCard>[0]["place"]>;
}) {
	const { setNodeRef, isOver } = useDroppable({ id: "tray" });
	return (
		<div
			ref={setNodeRef}
			className={cn(
				"flex w-[272px] shrink-0 flex-col gap-2 self-stretch rounded-card bg-canvas p-2",
				"outline-1 -outline-offset-1 outline-hair",
				isOver && "bg-petrol-wash outline-2 -outline-offset-2 outline-petrol",
			)}
		>
			<div className="px-1 pt-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-fg-muted">
				Unscheduled{" "}
				<span className="font-mono text-fg-faint">({unscheduled.length})</span>
			</div>
			{unscheduled.length === 0 && (
				<p className="px-1 text-[12px] text-fg-faint">
					Every schedulable session has a slot. Drop a block here to unschedule
					it.
				</p>
			)}
			<div className="flex max-h-[46vh] flex-col gap-[6px] overflow-y-auto">
				{unscheduled.map((s) => (
					<TrayCard
						key={s.id}
						session={s}
						conflicts={conflicts.get(s.id)}
						timezone={timezone}
						place={place}
					/>
				))}
			</div>
			<div className="px-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-fg-muted">
				Scheduled{" "}
				<span className="font-mono text-fg-faint">({scheduled.length})</span>
			</div>
			<div className="flex min-h-0 flex-1 flex-col gap-[6px] overflow-y-auto">
				{scheduled.map((s) => (
					<TrayCard
						key={s.id}
						session={s}
						conflicts={conflicts.get(s.id)}
						timezone={timezone}
					/>
				))}
			</div>
		</div>
	);
}

/* ----------------------------------------------------------------- board --- */

export function AgendaBoard({
	view,
	days,
	activeDay,
	timezone,
	dayStartMin,
	dayEndMin,
	rooms,
	tracks,
	sessions,
	conflicts,
	filters,
	onSchedule,
	onUnschedule,
}: BoardProps) {
	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
		useSensor(KeyboardSensor),
	);
	const [active, setActive] = useState<AgendaSession | null>(null);

	const classification = useMemo(
		() => classifyAgendaSessions(sessions, filters.showDrafts),
		[sessions, filters.showDrafts],
	);
	const placed = useMemo(
		() =>
			classification.scheduled.map((s) => ({
				session: s,
				wall: utcToWall(s.startsAt, timezone),
				endWall: utcToWall(s.endsAt, timezone),
			})),
		[classification.scheduled, timezone],
	);
	const trayUnscheduled = useMemo(
		() =>
			classification.unscheduled
				.filter((s) => matchesSessionFilters(s, filters))
				.sort((a, b) => a.title.localeCompare(b.title)),
		[classification.unscheduled, filters],
	);
	const trayScheduled = useMemo(
		() =>
			placed
				.filter((p) => matchesSessionFilters(p.session, filters))
				.sort(
					(a, b) =>
						(a.session.startsAt ?? 0) - (b.session.startsAt ?? 0) ||
						a.session.title.localeCompare(b.session.title),
				)
				.map((p) => p.session),
		[placed, filters],
	);

	const roomsShown = filters.roomId
		? rooms.filter((r) => r.id === filters.roomId)
		: rooms;
	const roomName = useMemo(
		() => new Map(rooms.map((r) => [r.id, r.name])),
		[rooms],
	);

	// End minute for column math: a block running past the day boundary in the
	// event TZ still belongs to its start day's column, clipped at the window.
	const columnBlocks = (
		predicate: (p: (typeof placed)[number]) => boolean,
		subtitle?: (p: (typeof placed)[number]) => string | undefined,
	): ColumnBlock[] =>
		placed.filter(predicate).map((p) => ({
			session: p.session,
			startMin: p.wall.minutes,
			endMin: p.endWall.day === p.wall.day ? p.endWall.minutes : 24 * 60, // spills past midnight — clip to the day's end
			subtitle: subtitle?.(p),
		}));

	const pickRoomFor = (
		session: AgendaSession,
		day: string,
		minutes: number,
	) => {
		if (session.roomId) return session.roomId;
		const startMs = wallToUtc(day, minutes, timezone);
		return pickFreeRoom(
			rooms,
			classification.schedulablePlaced.map((s) => ({
				roomId: s.roomId,
				startsAt: s.startsAt,
				endsAt: s.endsAt,
			})),
			startMs,
			startMs + sessionDurationMins(session) * 60_000,
		);
	};

	const handleDragEnd = (event: DragEndEvent) => {
		setActive(null);
		const session = event.active.data.current?.session as
			| AgendaSession
			| undefined;
		if (!session || !event.over) return;
		const overId = String(event.over.id);
		if (overId === "tray") {
			if (session.startsAt != null) onUnschedule(session.id);
			return;
		}
		const [kind, day, roomId, minutes] = overId.split("|");
		if (!day || minutes === undefined) return;
		if (kind === "cell" && roomId) {
			onSchedule(session.id, day, Number(minutes), roomId);
		} else if (kind === "week") {
			const room = pickRoomFor(session, day, Number(minutes));
			if (room) onSchedule(session.id, day, Number(minutes), room);
		}
	};

	const handleDragStart = (event: DragStartEvent) => {
		const session = event.active.data.current?.session as
			| AgendaSession
			| undefined;
		setActive(session ?? null);
	};

	const gridBody = (() => {
		if (rooms.length === 0 && (view === "day" || view === "week")) {
			return (
				<EmptyState
					icon="calendar"
					title="No rooms yet"
					body="Add rooms in Settings → Library, then drag sessions onto the day grid to build your program."
				/>
			);
		}
		if (view === "day") {
			return (
				<div className="flex">
					<TimeGutter dayStartMin={dayStartMin} dayEndMin={dayEndMin} />
					{roomsShown.map((room) => (
						<GridColumn
							key={room.id}
							header={
								<>
									{room.name}
									{room.capacity != null && (
										<span className="ml-1 font-mono text-fg-faint">
											{room.capacity}
										</span>
									)}
								</>
							}
							blocks={columnBlocks(
								(p) => p.wall.day === activeDay && p.session.roomId === room.id,
							)}
							dayStartMin={dayStartMin}
							dayEndMin={dayEndMin}
							timezone={timezone}
							conflicts={conflicts}
							filters={filters}
							droppableFor={(m) => `cell|${activeDay}|${room.id}|${m}`}
							onUnschedule={onUnschedule}
							draggable
						/>
					))}
				</div>
			);
		}
		if (view === "week") {
			return (
				<div className="flex">
					<TimeGutter dayStartMin={dayStartMin} dayEndMin={dayEndMin} />
					{days.map((day) => (
						<GridColumn
							key={day}
							header={formatDayLabel(day)}
							blocks={columnBlocks(
								(p) => p.wall.day === day,
								(p) =>
									p.session.roomId ? roomName.get(p.session.roomId) : undefined,
							)}
							dayStartMin={dayStartMin}
							dayEndMin={dayEndMin}
							timezone={timezone}
							conflicts={conflicts}
							filters={filters}
							droppableFor={(m) => `week|${day}||${m}`}
							onUnschedule={onUnschedule}
							draggable
						/>
					))}
				</div>
			);
		}
		// Track view: review the program's balance per track — read-only lanes
		// (a drop can't change a session's track; scheduling lives in Day/Week).
		const trackColumns = [
			...tracks.map((t) => ({ key: t.id, label: t.name })),
			{ key: "", label: "No track" },
		];
		return (
			<div className="flex">
				<TimeGutter dayStartMin={dayStartMin} dayEndMin={dayEndMin} />
				{trackColumns.map((col) => (
					<GridColumn
						key={col.key || "none"}
						header={col.label}
						blocks={columnBlocks(
							(p) =>
								p.wall.day === activeDay &&
								(col.key === ""
									? p.session.tracks.length === 0
									: p.session.tracks.some((t) => t.id === col.key)),
							(p) =>
								p.session.roomId ? roomName.get(p.session.roomId) : undefined,
						)}
						dayStartMin={dayStartMin}
						dayEndMin={dayEndMin}
						timezone={timezone}
						conflicts={conflicts}
						filters={filters}
						droppableFor={null}
						draggable={false}
					/>
				))}
			</div>
		);
	})();

	return (
		<DndContext
			id="agenda-dnd"
			sensors={sensors}
			collisionDetection={pointerFirstCollision}
			onDragStart={handleDragStart}
			onDragEnd={handleDragEnd}
			onDragCancel={() => setActive(null)}
		>
			<div className="flex items-start gap-4">
				<div className="min-w-0 flex-1 overflow-auto rounded-card bg-surface shadow-card">
					{gridBody}
				</div>
				<Tray
					unscheduled={trayUnscheduled}
					scheduled={trayScheduled}
					timezone={timezone}
					conflicts={conflicts}
					place={{ days, rooms, dayStartMin, dayEndMin, onSchedule }}
				/>
			</div>
			<DragOverlay dropAnimation={null}>
				{active && (
					<div className="w-[220px] cursor-grabbing rounded-control bg-surface p-[9px] shadow-card outline-2 -outline-offset-2 outline-petrol">
						<div className="text-[12.5px] font-medium leading-[16px] text-fg">
							{active.title}
						</div>
						<div className="mt-[2px] font-mono text-[10.5px] text-fg-muted">
							{active.formatName ?? "No format"} · {sessionDurationMins(active)}
							m
						</div>
					</div>
				)}
			</DragOverlay>
		</DndContext>
	);
}
