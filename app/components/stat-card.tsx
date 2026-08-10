import type { ReactNode } from "react";
import { Panel } from "~/ui";
import { SectionHeading } from "./section-heading";

// Stat numerals are mono (counts are data literals) at the existing 23px
// scale point. A dedicated stat type role is an app/ui candidate for the
// integration consolidation sweep.
export function StatCard({
	label,
	value,
	hint,
}: {
	label: string;
	value: number | string;
	hint?: ReactNode;
}) {
	return (
		<Panel>
			<div className="flex flex-col gap-[6px]">
				<SectionHeading>{label}</SectionHeading>
				<span className="font-mono text-[23px] font-medium tabular-nums text-fg">
					{value}
				</span>
				{hint != null && (
					<span className="text-[12.5px] text-fg-muted">{hint}</span>
				)}
			</div>
		</Panel>
	);
}

/** One cell of a status-breakdown row: the label (typically a StatusBadge)
 * over its mono count. */
export function StatCell({
	label,
	count,
}: {
	label: ReactNode;
	count: number;
}) {
	return (
		<div className="flex flex-col items-start gap-[6px]">
			{label}
			<span className="pl-1 font-mono text-[13px] font-medium tabular-nums text-fg">
				{count}
			</span>
		</div>
	);
}
