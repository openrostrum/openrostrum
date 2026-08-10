import type { ReactNode } from "react";

/** Caps section label (same voice as table headers) with an optional
 * right-aligned aside — typically a "View all" TextLink. */
export function SectionHeading({
	children,
	aside,
}: {
	children: ReactNode;
	aside?: ReactNode;
}) {
	return (
		<div className="flex items-baseline">
			<h2 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-fg-muted">
				{children}
			</h2>
			{aside != null && <span className="ml-auto text-[12.5px]">{aside}</span>}
		</div>
	);
}
