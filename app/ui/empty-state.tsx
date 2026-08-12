import type { ReactNode } from "react";
import { Icon, type IconName } from "./icon";

// An empty state says WHY it's empty and what to do next — "No X found"
// with no action ends the user's journey.
export function EmptyState({
	icon,
	title,
	body,
	action,
}: {
	icon: IconName;
	title: string;
	body: string;
	action?: ReactNode;
}) {
	return (
		<div className="flex flex-col items-center px-6 py-11 text-center">
			<div className="mb-4 flex h-12 w-12 items-center justify-center rounded-[13px] bg-petrol-wash text-petrol">
				<Icon name={icon} size={22} />
			</div>
			<h2 className="mb-1 font-display text-[15px] font-semibold text-fg">
				{title}
			</h2>
			<p className="mb-[18px] max-w-[36ch] text-[13px] text-fg-muted">{body}</p>
			{action}
		</div>
	);
}

/**
 * The same rule one scale down: a list inside a card, a kanban column or a
 * menu, where the container already carries the heading and the action and a
 * centered icon block would dwarf what it explains. Still says why and what
 * to do next — it just says it in one line.
 *
 * Voice only. Padding differs at every call site, so it stays out there.
 */
export function EmptyLine({ children }: { children: ReactNode }) {
	return <p className="text-[12.5px] text-fg-muted">{children}</p>;
}
