import type { ReactNode } from "react";
import { SUBMISSION_STATUS } from "~/db/constants";
import { cn } from "./cn";

// Status colors follow web convention (green=positive, red=negative) and are
// deliberately NOT skin tokens: they survive a re-skin unchanged. Like all
// chrome they resolve via light-dark() — theme = color-scheme on <html>,
// cookie-persisted, tri-state — so components never write `dark:` variants:
// the media query desyncs the moment a visitor overrides the OS.
const TONES = {
	success:
		"bg-[light-dark(var(--color-emerald-100),var(--color-emerald-950))] text-[light-dark(var(--color-emerald-800),var(--color-emerald-300))]",
	warning:
		"bg-[light-dark(var(--color-amber-100),var(--color-amber-950))] text-[light-dark(var(--color-amber-800),var(--color-amber-300))]",
	info: "bg-[light-dark(var(--color-sky-100),var(--color-sky-950))] text-[light-dark(var(--color-sky-800),var(--color-sky-300))]",
	caution:
		"bg-[light-dark(var(--color-orange-100),var(--color-orange-950))] text-[light-dark(var(--color-orange-800),var(--color-orange-300))]",
	danger:
		"bg-[light-dark(var(--color-rose-100),var(--color-rose-950))] text-[light-dark(var(--color-rose-800),var(--color-rose-300))]",
	neutral:
		"bg-[light-dark(var(--color-zinc-200),var(--color-zinc-800))] text-[light-dark(var(--color-zinc-700),var(--color-zinc-300))]",
	faint:
		"bg-[light-dark(var(--color-zinc-100),var(--color-zinc-800))] text-[light-dark(var(--color-zinc-600),var(--color-zinc-400))]",
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
