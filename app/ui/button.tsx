import { MOTION_FEEDBACK } from "./motion-classes";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { Link } from "react-router";
import { cn } from "./cn";
import { Icon, type IconName } from "./icon";

// Primitives never accept className/style: every visual decision stays in
// app/ui + tokens so a re-skin needs zero route diffs.
const BASE = cn(
	"inline-flex h-[34px] items-center gap-[7px] rounded-control px-[15px]",
	`text-[13px] font-medium transition-[background-color,transform] ${MOTION_FEEDBACK}`,
	"focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-petrol",
	"active:scale-[0.97] motion-reduce:active:scale-100",
	"disabled:bg-chip disabled:text-fg-faint disabled:shadow-none disabled:active:scale-100",
);

const VARIANTS = {
	primary: "bg-ink text-on-ink shadow-btn hover:bg-ink-hover",
	ghost: "bg-surface text-fg shadow-control hover:bg-chip",
} as const;

type Variant = keyof typeof VARIANTS;

type ButtonProps = Omit<
	ComponentPropsWithoutRef<"button">,
	"className" | "style"
> & { variant?: Variant; icon?: IconName };

export function Button({
	variant = "primary",
	icon,
	children,
	...props
}: ButtonProps) {
	return (
		<button {...props} className={cn(BASE, VARIANTS[variant])}>
			{icon && <Icon name={icon} size={14} />}
			{children}
		</button>
	);
}

export function ButtonLink({
	to,
	variant = "primary",
	icon,
	children,
}: {
	to: string;
	variant?: Variant;
	icon?: IconName;
	children: ReactNode;
}) {
	return (
		<Link to={to} className={cn(BASE, VARIANTS[variant])}>
			{icon && <Icon name={icon} size={14} />}
			{children}
		</Link>
	);
}
