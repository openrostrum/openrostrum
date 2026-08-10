import type { ReactNode } from "react";

// Deliberately the same caps voice as the table header (Th) — one label
// voice across the tool, so a re-skin edits it in two known places.
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
