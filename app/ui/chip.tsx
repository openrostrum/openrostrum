import type { ReactNode } from "react";

// User-picked colors (e.g. a track's configured color) render as a DOT next
// to muted text, never as a filled pill — arbitrary backgrounds can't
// guarantee label contrast. The inline style is sanctioned: the color is
// data, not a design decision.
export function Chip({
	color,
	children,
}: {
	color: string;
	children: ReactNode;
}) {
	return (
		<span className="inline-flex items-center gap-[7px] whitespace-nowrap text-[12.5px] font-medium text-fg-muted">
			<i
				className="h-[7px] w-[7px] shrink-0 rounded-[2.5px]"
				style={{ backgroundColor: color }}
			/>
			{children}
		</span>
	);
}
