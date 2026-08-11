import type { ReactNode, Ref } from "react";
import { cn } from "./cn";

const ENTER = cn(
	"transition-[opacity,translate,scale]",
	"[transition-duration:var(--motion-duration-enter)]",
	"[transition-timing-function:var(--ease-gallery-settle)]",
	"motion-reduce:transition-none",
);

const STARTING_REVEAL = cn(
	"starting:translate-y-0.5 starting:opacity-0",
	"motion-reduce:starting:translate-y-0 motion-reduce:starting:opacity-100",
);

export function MotionReveal({
	children,
	kind = "panel",
}: {
	children: ReactNode;
	kind?: "panel" | "feedback";
}) {
	const className = cn(ENTER, STARTING_REVEAL);
	return kind === "feedback" ? (
		<span className={cn("inline-flex", className)}>{children}</span>
	) : (
		<div className={className}>{children}</div>
	);
}

const SIDE = {
	top: "bottom-full mb-[6px]",
	bottom: "top-full mt-[6px]",
} as const;

const ALIGN = {
	start: "left-0",
	end: "right-0",
	stretch: "inset-x-0",
} as const;

const ORIGIN = {
	top: {
		start: "origin-bottom-left",
		end: "origin-bottom-right",
		stretch: "origin-bottom",
	},
	bottom: {
		start: "origin-top-left",
		end: "origin-top-right",
		stretch: "origin-top",
	},
} as const;

const WIDTH = {
	sm: "w-[168px]",
	md: "w-64",
	trigger: "w-full",
} as const;

export function PopoverSurface({
	children,
	side,
	align = "start",
	width = "sm",
}: {
	children: ReactNode;
	side: keyof typeof SIDE;
	align?: keyof typeof ALIGN;
	width?: keyof typeof WIDTH;
}) {
	return (
		<div
			className={cn(
				"absolute z-30 flex flex-col overflow-hidden rounded-card bg-surface shadow-card",
				SIDE[side],
				ALIGN[align],
				ORIGIN[side][align],
				WIDTH[width],
				ENTER,
				"starting:translate-y-0.5 starting:scale-[0.98] starting:opacity-0",
				"motion-reduce:starting:translate-y-0 motion-reduce:starting:scale-100 motion-reduce:starting:opacity-100",
			)}
		>
			{children}
		</div>
	);
}

const DIALOG_SIZE = {
	sm: "max-w-md",
	md: "max-w-2xl",
	lg: "max-w-4xl",
} as const;

export function DialogSurface({
	children,
	role = "dialog",
	size = "lg",
	ariaLabel,
	labelledBy,
	describedBy,
	panelRef,
}: {
	children: ReactNode;
	role?: "dialog" | "alertdialog";
	size?: keyof typeof DIALOG_SIZE;
	ariaLabel?: string;
	labelledBy?: string;
	describedBy?: string;
	panelRef?: Ref<HTMLDivElement>;
}) {
	return (
		<div
			className={cn(
				"fixed inset-0 z-50 flex items-center justify-center bg-[rgba(0,0,0,0.42)] p-4",
				"transition-opacity [transition-duration:var(--motion-duration-enter)] [transition-timing-function:var(--ease-gallery-settle)]",
				"starting:opacity-0 motion-reduce:transition-none motion-reduce:starting:opacity-100",
			)}
			role="presentation"
		>
			<div
				ref={panelRef}
				role={role}
				aria-modal="true"
				aria-label={ariaLabel}
				aria-labelledby={labelledBy}
				aria-describedby={describedBy}
				className={cn(
					"flex max-h-[92vh] w-full flex-col overflow-y-auto rounded-card bg-surface p-5 shadow-card",
					DIALOG_SIZE[size],
					"transition-scale [transition-duration:var(--motion-duration-enter)] [transition-timing-function:var(--ease-gallery-settle)]",
					"starting:scale-[0.97] motion-reduce:transition-none motion-reduce:starting:scale-100",
				)}
			>
				{children}
			</div>
		</div>
	);
}
