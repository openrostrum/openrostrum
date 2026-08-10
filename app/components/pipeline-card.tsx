import type { ReactNode } from "react";
import { Link } from "react-router";
import { Panel } from "~/ui";

/** One kanban stage column: caps heading + mono count, honest truncation. */
export function PipelineColumn({
	label,
	count,
	truncated,
	children,
}: {
	label: string;
	count: number;
	/** Cards beyond the render cap — 0 renders nothing. */
	truncated: number;
	children: ReactNode;
}) {
	return (
		<section
			aria-label={`${label} column`}
			className="flex w-[230px] shrink-0 flex-col gap-2"
		>
			<h2 className="flex items-baseline gap-2 px-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-fg-muted">
				{label}
				<span className="font-mono text-[10.5px] tabular-nums">{count}</span>
			</h2>
			{children}
			{truncated > 0 && (
				<span className="px-1 text-[12px] text-fg-faint">
					+{truncated} more not shown
				</span>
			)}
			{count === 0 && (
				<span className="px-1 text-[12px] text-fg-faint">Empty</span>
			)}
		</section>
	);
}

/** A prospect card on the board; `control` hosts the route's move form. */
export function PipelineCardTile({
	to,
	name,
	subtitle,
	score,
	control,
}: {
	to: string;
	name: string;
	subtitle: string;
	score: number | null;
	control: ReactNode;
}) {
	return (
		<Panel>
			<div className="flex flex-col gap-2">
				<Link to={to} className="text-[13px] font-medium text-fg">
					{name}
				</Link>
				<span className="text-[12.5px] text-fg-muted">{subtitle}</span>
				{score != null && (
					<span className="font-mono text-[12px] tabular-nums text-fg-muted">
						Score {score}
					</span>
				)}
				{control}
			</div>
		</Panel>
	);
}
