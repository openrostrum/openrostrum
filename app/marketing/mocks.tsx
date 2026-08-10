import { Icon } from "~/ui";
import { cn } from "~/ui/cn";

// Faithful, static renderings of real product surfaces, built from the same
// @theme tokens the live app uses — so the marketing page shows the actual
// thing, not a stylized impression. Presentational only (aria-hidden).

const STATUS = {
	accepted: "bg-petrol-wash text-petrol",
	pending: "bg-chip text-fg-muted",
	declined: "bg-chip text-fg-faint",
} as const;

function Pill({ status }: { status: keyof typeof STATUS }) {
	return (
		<span
			className={cn(
				"inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium capitalize",
				STATUS[status],
			)}
		>
			{status}
		</span>
	);
}

function Initials({ value }: { value: string }) {
	return (
		<span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-chip text-[10px] font-semibold text-fg-muted">
			{value}
		</span>
	);
}

const SUB_TABS = [
	{ label: "All", count: 12, active: true },
	{ label: "Accepted", count: 4, active: false },
	{ label: "Pending", count: 5, active: false },
	{ label: "Declined", count: 3, active: false },
];

const SUB_ROWS: {
	title: string;
	who: string;
	initials: string;
	status: keyof typeof STATUS;
}[] = [
	{
		title: "Scaling agents in production",
		who: "Dana Ruiz",
		initials: "DR",
		status: "accepted",
	},
	{
		title: "The case for local-first data",
		who: "Priya Nair",
		initials: "PN",
		status: "pending",
	},
	{
		title: "Eval kits that actually catch bugs",
		who: "Marco Silva",
		initials: "MS",
		status: "accepted",
	},
	{
		title: "Designing for the unhappy path",
		who: "Lena Fischer",
		initials: "LF",
		status: "declined",
	},
];

export function SubmissionsMock() {
	return (
		<div
			aria-hidden="true"
			className="w-full select-none overflow-hidden rounded-card border border-hair bg-surface shadow-card"
		>
			<div className="flex items-center justify-between gap-3 border-b border-hair px-4 py-3">
				<div className="flex items-center gap-2">
					<span className="font-display text-[15px] font-semibold text-fg">
						Submissions
					</span>
					<span className="rounded-full bg-chip px-1.5 font-mono text-[11px] tabular-nums text-fg-muted">
						12
					</span>
				</div>
				<span className="inline-flex items-center gap-1.5 rounded-full bg-petrol-wash px-2 py-0.5 font-mono text-[11px] tabular-nums text-petrol">
					<span className="h-1.5 w-1.5 rounded-full bg-petrol" />
					41&nbsp;ms
				</span>
			</div>
			<div className="flex items-center gap-4 border-b border-hair px-4">
				{SUB_TABS.map((tab) => (
					<span
						key={tab.label}
						className={cn(
							"flex items-center gap-1.5 border-b-2 py-2.5 text-[12.5px]",
							tab.active
								? "border-petrol text-fg"
								: "border-transparent text-fg-muted",
						)}
					>
						{tab.label}
						<span
							className={cn(
								"font-mono text-[11px] tabular-nums",
								tab.active ? "text-petrol" : "text-fg-faint",
							)}
						>
							{tab.count}
						</span>
					</span>
				))}
			</div>
			<div className="divide-y divide-hair">
				{SUB_ROWS.map((row) => (
					<div key={row.title} className="flex items-center gap-3 px-4 py-2.5">
						<span className="h-3.5 w-3.5 shrink-0 rounded-[4px] border border-hair-strong" />
						<span className="min-w-0 flex-1 truncate text-[13px] text-fg">
							{row.title}
						</span>
						<span className="hidden items-center gap-2 sm:flex">
							<Initials value={row.initials} />
							<span className="text-[12px] text-fg-muted">{row.who}</span>
						</span>
						<Pill status={row.status} />
					</div>
				))}
			</div>
		</div>
	);
}

const ROOMS = ["Room A", "Room B", "Room C"];
const HOURS = ["9:00", "10:00", "11:00"];

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
				"flex h-full flex-col justify-center gap-0.5 rounded-[6px] border-l-2 border-petrol bg-petrol-wash px-2 py-1.5",
				conflict && "border-danger",
			)}
		>
			<span className="flex items-center gap-1 text-[11px] font-medium leading-tight text-fg">
				{conflict && <Icon name="calendar" size={11} />}
				<span className="truncate">{title}</span>
			</span>
			<span className="font-mono text-[10px] text-fg-muted">{room}</span>
			{conflict && (
				<span className="font-mono text-[10px] font-medium text-danger">
					room conflict
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
			<div className="grid grid-cols-[44px_1fr_1fr_1fr] border-b border-hair">
				<span />
				{ROOMS.map((room) => (
					<span
						key={room}
						className="border-l border-hair px-2 py-2 text-center text-[11px] font-semibold uppercase tracking-[0.04em] text-fg-muted"
					>
						{room}
					</span>
				))}
			</div>
			<div className="grid grid-cols-[44px_1fr_1fr_1fr]">
				{HOURS.map((hour, hourIndex) => (
					<div key={hour} className="contents">
						<span className="border-t border-hair px-2 py-3 text-right font-mono text-[10px] tabular-nums text-fg-faint">
							{hour}
						</span>
						{ROOMS.map((room) => (
							<div
								key={room}
								className="min-h-[52px] border-l border-t border-hair p-1"
							>
								{hourIndex === 0 && room === "Room A" && (
									<Block title="Opening keynote" room="Room A" />
								)}
								{hourIndex === 1 && room === "Room B" && (
									<Block title="Agents workshop" room="Room B" conflict />
								)}
								{hourIndex === 2 && room === "Room C" && (
									<Block title="Local-first panel" room="Room C" />
								)}
							</div>
						))}
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
			className="w-full max-w-[400px] select-none overflow-hidden rounded-card border border-hair bg-surface shadow-card"
		>
			<div className="flex items-center gap-3 border-b border-hair px-4 py-3">
				<span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-petrol-wash text-[12px] font-semibold text-petrol">
					AI
				</span>
				<div className="min-w-0">
					<div className="truncate text-[13px] font-medium text-fg">
						AI Engineer Summit
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
					<span className="flex flex-col items-center rounded-[6px] bg-petrol px-2 py-1 text-on-ink">
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
