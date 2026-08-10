import type { ReactNode } from "react";
import { TextLink } from "~/ui";

/** An "also check" row: what needs attention, then the surface that fixes it. */
export function AlertLink({
	to,
	action,
	children,
}: {
	to: string;
	action: string;
	children: ReactNode;
}) {
	return (
		<li className="flex flex-wrap items-baseline gap-x-2 text-[13px] text-fg">
			<span>{children}</span>
			<TextLink to={to}>{action} →</TextLink>
		</li>
	);
}
