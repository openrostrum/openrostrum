import type { ReactNode } from "react";
import { InkLink, Panel } from "~/ui";
import { SectionHeading } from "./section-heading";

export function PipelineColumn({
	label,
	count,
	truncated,
	children,
}: {
	label: string;
	count: number;
	truncated: number;
	children: ReactNode;
}) {
	return (
		<section
			aria-label={`${label} column`}
			className="flex w-[230px] shrink-0 flex-col gap-2"
		>
			<div className="px-1">
				<SectionHeading
					aside={
						<span className="font-mono text-[12px] font-medium tabular-nums text-fg-muted">
							{count}
						</span>
					}
				>
					{label}
				</SectionHeading>
			</div>
			{children}
			{truncated > 0 && (
				<span className="px-1 text-[12.5px] text-fg-faint">
					+{truncated} more not shown
				</span>
			)}
			{count === 0 && (
				<span className="px-1 text-[12.5px] text-fg-faint">
					No prospects here yet — move a card over or enroll one above
				</span>
			)}
		</section>
	);
}

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
			<div className="flex flex-col gap-2 text-[13px]">
				<InkLink to={to} strong>
					{name}
				</InkLink>
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
