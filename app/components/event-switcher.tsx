import { MOTION_FEEDBACK } from "~/ui/motion-classes";
import {
	type ComponentType,
	type FormEventHandler,
	useRef,
	useState,
} from "react";
import {
	Form,
	type FetcherFormProps,
	type Navigation,
	useLocation,
	useNavigation,
} from "react-router";
import { useBusy } from "~/lib/use-busy";
import { useDismiss } from "~/lib/use-dismiss";
import { cn } from "~/ui/cn";
import { EmptyLine, Icon, MenuItem, PopoverSurface } from "~/ui";

export type SwitcherEvent = {
	id: string;
	name: string;
	type: string;
	dates: string | null;
	isCurrent: boolean;
};

type EventSwitcherMenuProps = {
	Form: "form" | ComponentType<FetcherFormProps>;
	events: SwitcherEvent[];
	redirectTo: string;
	busy: boolean;
	onSubmit: FormEventHandler<HTMLFormElement>;
	onCreate: () => void;
};

/**
 * Sidebar current-event indicator + switcher. Selecting an event POSTs to the
 * membership-guarded /admin/events/switch action; the redirect's revalidation
 * refreshes every open loader, so the whole admin area flips to the new event.
 */
export function EventSwitcher({ events }: { events: SwitcherEvent[] }) {
	const [open, setOpen] = useState(false);
	const rootRef = useRef<HTMLDivElement>(null);
	const busy = useBusy();
	const location = useLocation();
	const navigation = useNavigation();
	const pendingId = pendingSwitchEventId(navigation);
	const current =
		events.find((event) => event.id === pendingId) ??
		events.find((event) => event.isCurrent) ??
		null;

	useDismiss(rootRef, open, setOpen);

	return (
		<div ref={rootRef} className="relative">
			<button
				type="button"
				aria-expanded={open}
				onClick={() => setOpen((o) => !o)}
				className={cn(
					"flex w-full items-center gap-[10px] rounded-control bg-surface px-[10px] py-[6px] text-left shadow-control",
					`transition-[background-color,transform] ${MOTION_FEEDBACK} hover:bg-chip`,
					"active:scale-[0.97] motion-reduce:active:scale-100",
					"focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-petrol",
				)}
			>
				<span className="flex min-w-0 flex-1 flex-col">
					<span className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-fg-faint">
						Event
					</span>
					<span className="truncate text-[13px] font-medium text-fg">
						{current?.name ?? "No event yet"}
					</span>
				</span>
				<span className="text-fg-faint">
					<Icon name="chevron-down" size={14} />
				</span>
			</button>
			{open && (
				<EventSwitcherMenu
					Form={Form}
					events={events}
					redirectTo={`${location.pathname}${location.search}`}
					busy={busy}
					onSubmit={() => setOpen(false)}
					onCreate={() => setOpen(false)}
				/>
			)}
		</div>
	);
}

export function EventSwitcherMenu({
	Form: SwitchForm,
	events,
	redirectTo,
	busy,
	onSubmit,
	onCreate,
}: EventSwitcherMenuProps) {
	return (
		<PopoverSurface
			as={SwitchForm}
			method="post"
			action="/admin/events/switch"
			onSubmit={onSubmit}
			side="bottom"
			align="stretch"
			width="trigger"
		>
			<input type="hidden" name="redirectTo" value={redirectTo} />
			<ul className="max-h-[300px] overflow-y-auto py-1">
				{events.map((event) => (
					<li key={event.id}>
						<MenuItem
							type="submit"
							name="eventId"
							value={event.id}
							disabled={busy}
							selected={event.isCurrent}
							description={event.dates ?? event.type}
						>
							{event.name}
						</MenuItem>
					</li>
				))}
				{events.length === 0 && (
					<li className="px-[12px] py-2">
						<EmptyLine>No events yet — create your first one below.</EmptyLine>
					</li>
				)}
			</ul>
			<div className="border-t border-hair py-1">
				<MenuItem to="/admin/events/new" icon="plus" onClick={onCreate}>
					Create event
				</MenuItem>
			</div>
		</PopoverSurface>
	);
}

function pendingSwitchEventId(navigation: Navigation): string {
	if (navigation.state === "idle") return "";
	const action = navigation.formAction ?? "";
	if (
		action !== "/admin/events/switch" &&
		!action.endsWith("/admin/events/switch")
	) {
		return "";
	}
	return String(navigation.formData?.get("eventId") ?? "");
}
