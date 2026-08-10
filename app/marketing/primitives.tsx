import type { ReactNode } from "react";
import { Link } from "react-router";
import { Icon, type IconName } from "~/ui";
import { cn } from "~/ui/cn";

// The marketing surface is not the 8-hour admin tool the "Gallery" petrol-law
// governs (docs/rules/design-system.md): a landing page gets scale and expression the
// tool doesn't. It stays on the same @theme tokens so it reads as one product —
// petrol is still the only accent, drawn here as the mark's rostrum bar.

export function Eyebrow({ children }: { children: ReactNode }) {
	return (
		<span className="inline-flex items-center gap-2.5 font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-fg-muted">
			<span className="h-[3px] w-6 rounded-full bg-petrol" aria-hidden="true" />
			{children}
		</span>
	);
}

const CTA_BASE = cn(
	"inline-flex h-11 items-center justify-center gap-2 rounded-control px-5 text-[14px] font-medium",
	"transition-[background-color,transform,box-shadow] duration-150 ease-out",
	"focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-petrol",
	"active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100",
);

const CTA_VARIANT = {
	primary: "bg-ink text-on-ink shadow-btn hover:bg-ink-hover",
	ghost: "bg-surface text-fg shadow-control hover:bg-chip",
} as const;

type CtaProps = {
	children: ReactNode;
	variant?: keyof typeof CTA_VARIANT;
	to?: string;
	href?: string;
	icon?: IconName;
	external?: boolean;
};

export function Cta({
	children,
	variant = "primary",
	to,
	href,
	icon,
	external,
}: CtaProps) {
	const className = cn(CTA_BASE, CTA_VARIANT[variant]);
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
