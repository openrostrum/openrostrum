import type { ReactNode } from "react";
import { Panel } from "~/ui";
import { SectionHeading } from "./section-heading";

/**
 * The who-is-this panel shared by the directory profile and the pipeline card
 * detail: name, mono email, muted detail lines, body paragraphs, and slots
 * for a status badge (aside) and route-provided links/content (children).
 */
export function IdentityPanel({
	heading,
	aside,
	name,
	email,
	lines = [],
	paragraphs = [],
	children,
}: {
	heading: string;
	aside?: ReactNode;
	name: string;
	email: string;
	lines?: string[];
	paragraphs?: string[];
	children?: ReactNode;
}) {
	return (
		<Panel>
			<div className="flex flex-col gap-3">
				<SectionHeading aside={aside}>{heading}</SectionHeading>
				<p className="text-[15px] font-medium text-fg">{name}</p>
				<p className="font-mono text-[12px] text-fg-muted">{email}</p>
				{lines.map((line) => (
					<p key={line} className="text-[13px] text-fg-muted">
						{line}
					</p>
				))}
				{paragraphs.map((text) => (
					<p key={text} className="whitespace-pre-wrap text-[13px] text-fg">
						{text}
					</p>
				))}
				{children}
			</div>
		</Panel>
	);
}
