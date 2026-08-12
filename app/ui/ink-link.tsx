import { MOTION_FEEDBACK } from "./motion-classes";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { cn } from "./cn";

/**
 * A link that reads as the text around it — no petrol, underline on hover; the
 * petrol law reserves that color for prose links (`TextLink`). It exists to own
 * the focus ring: six hand-rolled copies drifted and one shipped with no ring
 * at all, which is a keyboard user losing their place.
 */
const BASE = cn(
	`rounded-[3px] underline-offset-2 transition-colors ${MOTION_FEEDBACK} hover:underline`,
	"focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-petrol",
);

// Type SIZE is the surrounding block's decision — an ink link inherits it.
// These two say what the link itself is: a named thing, and whether it wraps a
// whole row of content rather than sitting in a line of text.
const STRONG = "w-fit font-medium text-fg";
const ROW = "flex items-center gap-2.5";

export function InkLink({
	to,
	strong,
	row,
	children,
}: {
	to: string;
	/** The link names a thing (a session, a speaker) rather than reading as running text. */
	strong?: boolean;
	/** The link wraps a whole row of content, making all of it the target. */
	row?: boolean;
	children: ReactNode;
}) {
	return (
		<Link to={to} className={cn(BASE, strong && STRONG, row && ROW)}>
			{children}
		</Link>
	);
}
