import type { ReactNode } from "react";
import { Link } from "react-router";

// The only place petrol touches prose. Table titles and data stay ink —
// a full column of colored links pollutes status scanning.
const LINK =
	"rounded-[3px] font-medium text-petrol underline underline-offset-2 transition-colors [transition-duration:var(--motion-duration-feedback)] [transition-timing-function:var(--ease-gallery-responsive)] motion-reduce:transition-none hover:text-petrol-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-petrol";

export function TextLink({
	to,
	children,
}: {
	to: string;
	children: ReactNode;
}) {
	return (
		<Link to={to} className={LINK}>
			{children}
		</Link>
	);
}
