import type { ReactNode } from "react";
import { Panel } from "~/ui";
import { SectionHeading } from "./section-heading";

// Stat values render in the table-data mono voice — counts are data
// literals, and composing existing voices keeps this re-skinnable from
// app/ui + tokens alone.
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
				<span className="font-mono text-[12px] font-medium tabular-nums text-fg">
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
			<span className="pl-1 font-mono text-[12px] font-medium tabular-nums text-fg">
				{count}
			</span>
		</div>
	);
}
