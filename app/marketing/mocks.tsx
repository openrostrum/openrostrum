import { Caps, Icon, type IconName, Wordmark } from "~/ui";
import { cn } from "~/ui/cn";

// Faithful, static renderings of real product surfaces, built from the same
// @theme tokens the live app uses — so the marketing page shows the actual
// thing, not a stylized impression. Presentational only (aria-hidden).

// Status tones mirror StatusBadge's light half as static palette classes — the
// landing is pinned light, so StatusBadge's light-dark() pairs would always
// resolve to these values anyway.
const STATUS = {
	accepted: "bg-emerald-100 text-emerald-800",
	pending: "bg-amber-100 text-amber-800",
	declined: "bg-rose-100 text-rose-800",
} as const;

function Pill({ status }: { status: keyof typeof STATUS }) {
	return (
		<span
			className={cn(
				"inline-flex items-center gap-[6px] whitespace-nowrap rounded-full py-[3px] pl-2 pr-[10px]",
				"text-[11px] font-medium capitalize shadow-[inset_0_0_0_1px_rgba(0,0,0,0.05)]",
				STATUS[status],
			)}
		>
			<i className="h-[5px] w-[5px] rounded-full bg-current opacity-85" />
			{status}
		</span>
	);
}

function Initials({ value }: { value: string }) {
	return (
		<span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-chip text-[9.5px] font-semibold text-fg-muted">
			{value}
		</span>
	);
}

const NAV: { icon: IconName; label: string; count?: string; on?: boolean }[] = [
	{ icon: "grid", label: "Dashboard" },
	{ icon: "inbox", label: "Submissions", count: "128", on: true },
	{ icon: "filter", label: "Review", count: "71" },
	{ icon: "calendar", label: "Agenda" },
	{ icon: "mic", label: "Speakers" },
	{ icon: "star", label: "Tasks", count: "9" },
];

const TABS = [
	{ label: "All", count: "128", on: true },
	{ label: "Accepted", count: "34" },
	{ label: "Pending", count: "71" },
	{ label: "Declined", count: "23" },
];

const ROWS: {
	title: string;
	status: keyof typeof STATUS;
	selected?: boolean;
}[] = [
	{
		title: "Scaling retrieval beyond the context window",
		status: "accepted",
		selected: true,
	},
	{
		title: "Ship evals before you ship agents",
		status: "pending",
	},
	{
		title: "The unhappy path is the product",
		status: "accepted",
	},
	{
		title: "Local-first sync for conference apps",
		status: "pending",
	},
	{
		title: "What 400 CFP reviews taught us about bios",
		status: "declined",
	},
	{
		title: "Live-patching a schedule at 8:55 AM",
		status: "pending",
	},
];

function Checkbox({ checked }: { checked?: boolean }) {
	return (
		<span
			className={cn(
				"relative inline-block h-[15px] w-[15px] shrink-0 rounded-[4px]",
				checked
					? "bg-petrol after:absolute after:left-[4.5px] after:top-[2px] after:h-[8px] after:w-[4px] after:rotate-[43deg] after:border-white after:border-b-[1.8px] after:border-r-[1.8px]"
					: "bg-surface shadow-[inset_0_0_0_1.5px_var(--color-hair-strong)]",
			)}
		/>
	);
}

export function AdminShellMock() {
	return (
		<div
			aria-hidden="true"
			className="w-full select-none overflow-hidden rounded-card bg-canvas shadow-card"
		>
			{/* browser chrome */}
			<div className="flex items-center gap-1.5 border-b border-hair bg-surface px-4 py-2.5">
				<span className="h-2.5 w-2.5 rounded-full bg-hair-strong" />
				<span className="h-2.5 w-2.5 rounded-full bg-hair-strong" />
				<span className="h-2.5 w-2.5 rounded-full bg-hair-strong" />
				<span className="mx-auto rounded-[6px] bg-chip px-3 py-0.5 font-mono text-[11px] text-fg-muted">
					openrostrum.com/admin/submissions
				</span>
				<span className="w-12" />
			</div>
			<div className="flex">
				{/* sidebar */}
				<div className="hidden w-[210px] shrink-0 flex-col gap-0 border-r border-hair px-3 pb-3 pt-4 md:flex">
					<div className="px-2">
						<Wordmark size={15} />
					</div>
					<div className="mt-4 flex h-[32px] items-center gap-2 rounded-control bg-surface px-2.5 text-[12px] font-medium text-fg shadow-control">
						<span className="h-2 w-2 rounded-[3px] bg-petrol" />
						<span className="truncate">Northbound AI Summit</span>
						<span className="ml-auto text-fg-faint">
							<Icon name="chevron-down" size={12} />
						</span>
					</div>
					<div className="mb-1.5 mt-4 px-2 font-mono text-[10px] font-medium uppercase tracking-[0.09em] text-fg-faint">
						Program
					</div>
					<div className="flex flex-col gap-px">
						{NAV.map((item) => (
							<span
								key={item.label}
								className={cn(
									"flex h-[30px] items-center gap-2.5 rounded-control px-2 text-[12.5px] font-medium",
									item.on ? "bg-chip text-fg" : "text-fg-muted",
								)}
							>
								<span className={cn(item.on ? "text-petrol" : "opacity-70")}>
									<Icon name={item.icon} size={14} />
								</span>
								{item.label}
								{item.count && (
									<span className="ml-auto font-mono text-[10.5px] tabular-nums text-fg-faint">
										{item.count}
									</span>
								)}
							</span>
						))}
					</div>
					<div className="mt-auto flex items-center gap-2 border-t border-hair px-2 pt-3">
						<Initials value="AR" />
						<span className="flex flex-col">
							<span className="text-[11.5px] font-medium leading-tight text-fg">
								Ada Reyes
							</span>
							<span className="text-[10.5px] text-fg-faint">Organizer</span>
						</span>
					</div>
				</div>
				{/* stage */}
				<div className="min-w-0 flex-1 px-4 pb-4 pt-4 sm:px-5">
					<div className="flex items-center gap-2.5">
						<span className="font-display text-[17px] font-semibold tracking-[-0.01em] text-fg">
							Submissions
						</span>
						<span className="rounded-full bg-chip px-2 py-px font-mono text-[10.5px] tabular-nums text-fg-muted">
							128
						</span>
						<span className="ml-auto inline-flex h-[28px] items-center gap-1.5 rounded-control bg-ink px-2.5 text-[11.5px] font-medium text-on-ink shadow-btn">
							<Icon name="plus" size={11} />
							Add submission
						</span>
					</div>
					<div className="mt-3 flex gap-1 border-b border-hair">
						{TABS.map((tab) => (
							<span
								key={tab.label}
								className={cn(
									"-mb-px flex items-center gap-1.5 border-b-2 px-2 pb-2 pt-1 text-[12px] font-medium",
									tab.on
										? "border-petrol text-fg"
										: "border-transparent text-fg-muted",
								)}
							>
								{tab.label}
								<span
									className={cn(
										"hidden rounded-full px-1.5 font-mono text-[10px] tabular-nums sm:inline",
										tab.on ? "bg-petrol-wash text-petrol" : "text-fg-faint",
									)}
								>
									{tab.count}
								</span>
							</span>
						))}
					</div>
					<div className="mt-3 flex items-center gap-2">
						<span className="flex h-[28px] w-full max-w-[220px] items-center gap-2 rounded-control bg-surface px-2.5 shadow-control">
							<span className="text-fg-faint">
								<Icon name="search" size={12} />
							</span>
							<span className="text-[11.5px] text-fg-faint">
								Search submissions…
							</span>
						</span>
						<span className="hidden h-[28px] items-center gap-1.5 rounded-control bg-surface px-2.5 text-[11.5px] font-medium text-fg shadow-control sm:inline-flex">
							<Icon name="filter" size={12} />
							Filter
						</span>
						<span className="hidden h-[28px] items-center gap-1.5 rounded-control bg-surface px-2.5 text-[11.5px] font-medium text-fg shadow-control sm:inline-flex">
							<Icon name="export" size={12} />
							Export
						</span>
					</div>
					<div className="mt-3 overflow-hidden rounded-card bg-surface shadow-card">
						<div className="hidden gap-3 border-b border-hair bg-thead px-3.5 py-2 sm:flex">
							<span className="w-[15px]" />
							<span className="flex-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-fg-muted">
								Title
							</span>
							<span className="w-[86px] text-[10px] font-semibold uppercase tracking-[0.06em] text-fg-muted">
								Status
							</span>
						</div>
						<div className="divide-y divide-hair">
							{ROWS.map((row) => (
								<div
									key={row.title}
									className={cn(
										"flex items-center gap-3 px-3.5 py-2.5",
										row.selected &&
											"bg-row-selected shadow-[inset_2px_0_0_var(--color-petrol)]",
									)}
								>
									<Checkbox checked={row.selected} />
									<span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-fg">
										{row.title}
									</span>
									<span className="w-[86px]">
										<Pill status={row.status} />
									</span>
								</div>
							))}
						</div>
						<div className="flex items-center border-t border-hair px-3.5 py-2 font-mono text-[10.5px] tabular-nums text-fg-muted">
							1 — 6 of 128
							<span className="ml-auto flex items-center gap-1">
								<span className="rounded-[5px] bg-chip px-1.5 py-0.5 text-fg">
									1
								</span>
								<span className="px-1">2</span>
								<span className="px-1">3</span>
								<span className="px-1">…</span>
								<span className="px-1">22</span>
							</span>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}

const ROOMS = ["Room A", "Room B", "Room C"];
const HOURS = ["9:00", "10:00", "11:00", "12:00"] as const;

const GRID: Record<
	(typeof HOURS)[number],
	Partial<Record<(typeof ROOMS)[number], { title: string; conflict?: boolean }>>
> = {
	"9:00": {
		"Room A": { title: "Opening keynote" },
		"Room C": { title: "The unhappy path" },
	},
	"10:00": {
		"Room A": { title: "Scaling retrieval" },
		"Room B": { title: "Scaling retrieval", conflict: true },
	},
	"11:00": {
		"Room C": { title: "Opening keynote" },
	},
	"12:00": {
		"Room A": { title: "The unhappy path" },
	},
};

function Block({
	title,
	room,
	conflict,
}: {
	title: string;
	room: string;
	conflict?: boolean;
}) {
	return (
		<div
			className={cn(
				"flex h-full flex-col justify-center gap-0.5 rounded-[6px] border-l-2 bg-chip px-2 py-1.5",
				conflict ? "border-danger" : "border-hair-strong",
			)}
		>
			<span className="flex min-w-0 items-center gap-1 text-[11px] font-medium leading-tight text-fg">
				{conflict && <Icon name="calendar" size={11} />}
				<span className="min-w-0 truncate">{title}</span>
			</span>
			<span className="font-mono text-[10px] tabular-nums text-fg-muted">
				{room}
			</span>
			{conflict && (
				<span className="font-mono text-[10px] font-medium text-danger">
					speaker conflict
				</span>
			)}
		</div>
	);
}

export function AgendaMock() {
	return (
		<div
			aria-hidden="true"
			className="w-full select-none overflow-hidden rounded-card border border-hair bg-surface shadow-card"
		>
			<div className="flex items-center justify-between border-b border-hair px-3 py-2">
				<span className="font-display text-[13px] font-semibold tracking-[-0.01em] text-fg">
					Agenda
				</span>
				<span className="font-mono text-[10.5px] tabular-nums text-fg-muted">
					Oct 12 · 3 rooms
				</span>
			</div>
			<div className="grid grid-cols-[44px_repeat(3,minmax(0,1fr))] border-b border-hair">
				<span />
				{ROOMS.map((room) => (
					<span
						key={room}
						className="border-l border-hair px-2 py-2 text-center"
					>
						<Caps>{room}</Caps>
					</span>
				))}
			</div>
			<div className="grid grid-cols-[44px_repeat(3,minmax(0,1fr))]">
				{HOURS.map((hour) => (
					<div key={hour} className="contents">
						<span className="border-t border-hair px-2 py-3 text-right font-mono text-[10px] tabular-nums text-fg-faint">
							{hour}
						</span>
						{ROOMS.map((room) => {
							const slot = GRID[hour][room];
							return (
								<div
									key={room}
									className="min-h-[52px] border-l border-t border-hair p-1"
								>
									{slot && (
										<Block
											title={slot.title}
											room={room}
											conflict={slot.conflict}
										/>
									)}
								</div>
							);
						})}
					</div>
				))}
			</div>
		</div>
	);
}

export function InviteMock() {
	return (
		<div
			aria-hidden="true"
			className="w-full select-none overflow-hidden rounded-card border border-hair bg-surface shadow-card"
		>
			<div className="flex items-center gap-3 border-b border-hair px-4 py-3">
				<span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-petrol-wash text-[12px] font-semibold text-petrol">
					NB
				</span>
				<div className="min-w-0">
					<div className="truncate text-[13px] font-medium text-fg">
						Northbound AI Summit
					</div>
					<div className="truncate text-[11.5px] text-fg-faint">to you</div>
				</div>
			</div>
			<div className="px-4 py-3">
				<div className="font-display text-[14px] font-semibold text-fg">
					You&rsquo;re confirmed to speak
				</div>
				<p className="mt-1 text-[12.5px] leading-relaxed text-fg-muted">
					Your session is scheduled. The calendar invite is attached — add it in
					one tap.
				</p>
				<div className="mt-3 flex items-center gap-3 rounded-control border border-hair bg-canvas px-3 py-2">
					<span className="flex flex-col items-center rounded-[6px] bg-petrol px-2 py-1 text-white">
						<span className="font-mono text-[9px] font-semibold uppercase tracking-wide">
							Oct
						</span>
						<span className="font-mono text-[15px] font-semibold leading-none tabular-nums">
							12
						</span>
					</span>
					<div className="min-w-0 flex-1">
						<div className="truncate font-mono text-[12px] text-fg">
							invite.ics
						</div>
						<div className="text-[11px] text-fg-faint">Add to calendar</div>
					</div>
					<span className="text-petrol">
						<Icon name="calendar" size={16} />
					</span>
				</div>
			</div>
		</div>
	);
}
