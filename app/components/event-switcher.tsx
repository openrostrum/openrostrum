import { MOTION_FEEDBACK } from "~/ui/motion-classes";
import { useRef, useState } from "react";
import { Form, Link } from "react-router";
import { useBusy } from "~/lib/use-busy";
import { useDismiss } from "~/lib/use-dismiss";
import { cn } from "~/ui/cn";
import { Icon, PopoverSurface } from "~/ui";

export type SwitcherEvent = {
	id: string;
	name: string;
	type: string;
	dates: string | null;
	isCurrent: boolean;
};

/**
 * Sidebar current-event indicator + switcher. Selecting an event POSTs to the
 * membership-guarded /admin/events/switch action; the redirect's revalidation
 * refreshes every open loader, so the whole admin area flips to the new event.
 * Skin invariant: the trigger IS the ghost-Button recipe, the popover IS
 * Panel's card, row selection IS Tr's selected treatment, and the type sizes
 * ARE the Sidebar's voices — keep them in lockstep with those primitives.
 */
export function EventSwitcher({ events }: { events: SwitcherEvent[] }) {
	const [open, setOpen] = useState(false);
	const rootRef = useRef<HTMLDivElement>(null);
	const busy = useBusy();
	// The current event is always an element of the list (getActiveEvent and
	// listMyEvents share one membership predicate), so no separate field.
	const current = events.find((event) => event.isCurrent) ?? null;

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
				<PopoverSurface side="bottom" align="stretch" width="trigger">
					<ul className="max-h-[300px] overflow-y-auto py-1">
						{events.map((event) => (
							<li key={event.id}>
								<Form method="post" action="/admin/events/switch">
									<input type="hidden" name="eventId" value={event.id} />
									<input type="hidden" name="redirectTo" value="/admin" />
									<button
										type="submit"
										disabled={busy}
										aria-current={event.isCurrent || undefined}
										onClick={() => setOpen(false)}
										className={cn(
											"group flex w-full flex-col items-start px-[12px] py-[6px] text-left",
											`transition-colors ${MOTION_FEEDBACK} hover:bg-row-hover disabled:bg-chip`,
											"focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-petrol",
											event.isCurrent &&
												"bg-row-selected shadow-[inset_2px_0_0_var(--color-petrol)]",
										)}
									>
										<span className="w-full truncate text-[13px] font-medium text-fg group-disabled:text-fg-faint">
											{event.name}
										</span>
										<span className="w-full truncate text-[11.5px] text-fg-faint">
											{event.dates ?? event.type}
										</span>
									</button>
								</Form>
							</li>
						))}
						{events.length === 0 && (
							<li className="px-[12px] py-2 text-[12.5px] text-fg-muted">
								No events yet — create your first one below.
							</li>
						)}
					</ul>
					<div className="border-t border-hair p-1">
						<Link
							to="/admin/events/new"
							onClick={() => setOpen(false)}
							className={cn(
								"flex h-[34px] items-center gap-[10px] rounded-control px-[10px] text-[13.5px] font-medium text-fg-muted",
								`transition-colors ${MOTION_FEEDBACK} hover:bg-row-hover hover:text-fg`,
								"focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-petrol",
							)}
						>
							<Icon name="plus" size={14} />
							Create event
						</Link>
					</div>
				</PopoverSurface>
			)}
		</div>
	);
}
