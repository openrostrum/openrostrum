import type { ReactNode } from "react";
import { Panel } from "~/ui";

/** Overview stat: caps label over a mono count (counts are data literals —
 * the design system's mono territory), with an optional context line. */
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
				<span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-fg-muted">
					{label}
				</span>
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
			<span className="pl-1 font-mono text-[16px] font-medium tabular-nums text-fg">
				{count}
			</span>
		</div>
	);
}
