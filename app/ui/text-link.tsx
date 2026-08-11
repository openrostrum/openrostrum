import { MOTION_FEEDBACK } from "./motion-classes";
import type { ReactNode } from "react";
import { Link } from "react-router";

// The only place petrol touches prose. Table titles and data stay ink —
// a full column of colored links pollutes status scanning.
const LINK = `rounded-[3px] font-medium text-petrol underline underline-offset-2 transition-colors ${MOTION_FEEDBACK} hover:text-petrol-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-petrol`;

type TextLinkProps =
	| {
			to: string;
			href?: never;
			target?: never;
			rel?: never;
			children: ReactNode;
	  }
	| {
			href: string;
			to?: never;
			target?: string;
			rel?: string;
			children: ReactNode;
	  };

export function TextLink(props: TextLinkProps) {
	if (props.href !== undefined) {
		return (
			<a
				href={props.href}
				target={props.target}
				rel={props.rel}
				className={LINK}
			>
				{props.children}
			</a>
		);
	}
	return (
		<Link to={props.to} className={LINK}>
			{props.children}
		</Link>
	);
}
