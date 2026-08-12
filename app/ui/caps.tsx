import type { ReactNode } from "react";
import { cn } from "./cn";

/**
 * The label voice: 11px semibold caps at +0.06em. It names a thing that is not
 * itself content — a column, a section, a field, a lane — and the design system
 * gives the whole tool exactly one of it.
 *
 * It owns the voice and nothing else. Padding, height, stickiness and
 * truncation belong to whatever box the caller is putting this label in, so
 * Caps sets no line-height and no layout: wrap it, don't configure it.
 */
const BASE = "text-[11px] font-semibold uppercase tracking-[0.06em]";

const TONE = {
	muted: "text-fg-muted",
	faint: "text-fg-faint",
} as const;

const ELEMENT = {
	span: "span",
	div: "div",
	h2: "h2",
	h3: "h3",
	dt: "dt",
} as const;

export function Caps({
	as = "span",
	tone = "muted",
	children,
}: {
	/** The element this label *is* — a heading, a definition term, or plain text. */
	as?: keyof typeof ELEMENT;
	/** `faint` steps back where the label sits beside its own value. */
	tone?: keyof typeof TONE;
	children: ReactNode;
}) {
	const Tag = ELEMENT[as];
	return <Tag className={cn(BASE, TONE[tone])}>{children}</Tag>;
}
