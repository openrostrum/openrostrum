import type { ReactNode } from "react";
import { cn } from "./cn";

const TITLE_TONES = {
	default: "text-fg",
	danger: "text-danger",
} as const;

export function PageHeader({
	title,
	count,
	subtitle,
	actions,
	tone = "default",
}: {
	title: string;
	count?: string;
	subtitle?: ReactNode;
	actions?: ReactNode;
	tone?: keyof typeof TITLE_TONES;
}) {
	return (
		<header>
			<div className="flex items-center gap-3">
				<h1
					className={cn(
						"font-display text-[23px] font-semibold tracking-[-0.01em]",
						TITLE_TONES[tone],
					)}
				>
					{title}
				</h1>
				{count && (
					<span className="rounded-full bg-chip px-[10px] py-[3px] font-mono text-[11.5px] font-medium text-fg-muted">
						{count}
					</span>
				)}
				{actions && (
					<div className="ml-auto flex items-center gap-2">{actions}</div>
				)}
			</div>
			{subtitle != null && (
				<p className="mt-1 text-[13px] text-fg-muted">{subtitle}</p>
			)}
		</header>
	);
}
