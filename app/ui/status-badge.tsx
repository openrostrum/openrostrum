import type { ReactNode } from "react";
import { SUBMISSION_STATUS } from "~/db/constants";
import { cn } from "./cn";

// Status colors follow web convention (green=positive, red=negative) and are
// deliberately NOT skin tokens: they survive a re-skin unchanged. They live
// outside light-dark(), so this is the one primitive that writes dark:
// variants (there is no theme toggle — the media query can't desync).
const TONES = {
	success:
		"bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
	warning: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
	info: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
	caution:
		"bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300",
	danger: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300",
	neutral: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
	faint: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
} as const;

export type BadgeTone = keyof typeof TONES;

export const SUBMISSION_STATUS_TONE: Record<
	(typeof SUBMISSION_STATUS)[number],
	BadgeTone
> = {
	accepted: "success",
	pending: "warning",
	accept_queue: "info",
	decline_queue: "caution",
	declined: "danger",
	withdrawn: "neutral",
	draft: "faint",
};

export function StatusBadge({
	tone,
	children,
}: {
	tone: BadgeTone;
	children: ReactNode;
}) {
	return (
		<span
			className={cn(
				"inline-flex items-center gap-[6px] whitespace-nowrap rounded-full py-[3px] pl-2 pr-[10px]",
				"text-[11.5px] font-medium shadow-[inset_0_0_0_1px_rgba(0,0,0,0.05)]",
				TONES[tone],
			)}
		>
			<i className="h-[6px] w-[6px] rounded-full bg-current opacity-85" />
			{children}
		</span>
	);
}
