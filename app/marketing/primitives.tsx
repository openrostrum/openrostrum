import { MOTION_FEEDBACK } from "~/ui/motion-classes";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { Icon, type IconName } from "~/ui";
import { cn } from "~/ui/cn";

// The marketing surface is not the 8-hour admin tool the "Gallery" petrol-law
// governs (docs/rules/design-system.md): a landing page gets scale and expression the
// tool doesn't. It stays on the same @theme tokens so it reads as one product —
// petrol is still the only accent, and the headline stays ink.

export const FOCUS_RING =
	"focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-petrol";

/** The brand mark's petrol platform at page scale — call sites own the inset. */
export const PLATFORM_BAR = "h-[5px] rounded-[2px] bg-petrol";

export function Eyebrow({ children }: { children: ReactNode }) {
	return (
		<span className="inline-flex items-center gap-2.5 font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-fg-muted">
			<span className="h-[3px] w-6 rounded-full bg-petrol" aria-hidden="true" />
			{children}
		</span>
	);
}

const CTA_BASE = cn(
	"inline-flex items-center justify-center gap-2 rounded-control font-medium",
	`transition-[background-color,transform,box-shadow] ${MOTION_FEEDBACK}`,
	FOCUS_RING,
	"active:scale-[0.97] motion-reduce:active:scale-100",
);

const CTA_SIZE = {
	md: "h-11 px-5 text-[14px]",
	sm: "h-9 px-4 text-[13.5px]",
} as const;

const CTA_VARIANT = {
	primary: "bg-ink text-on-ink shadow-btn hover:bg-ink-hover",
	ghost: "bg-surface text-fg shadow-control hover:bg-chip",
} as const;

type CtaProps = {
	children: ReactNode;
	variant?: keyof typeof CTA_VARIANT;
	size?: keyof typeof CTA_SIZE;
	to?: string;
	href?: string;
	icon?: IconName;
	external?: boolean;
};

export function Cta({
	children,
	variant = "primary",
	size = "md",
	to,
	href,
	icon,
	external,
}: CtaProps) {
	const className = cn(CTA_BASE, CTA_SIZE[size], CTA_VARIANT[variant]);
	const inner = (
		<>
			<span>{children}</span>
			{icon && <Icon name={icon} size={15} />}
		</>
	);
	if (to) {
		return (
			<Link to={to} className={className}>
				{inner}
			</Link>
		);
	}
	return (
		<a
			href={href}
			className={className}
			{...(external ? { target: "_blank", rel: "noreferrer" } : {})}
		>
			{inner}
		</a>
	);
}
