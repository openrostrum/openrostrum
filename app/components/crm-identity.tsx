import type { ReactNode } from "react";
import { Panel } from "~/ui";
import { SectionHeading } from "./section-heading";

/** Shared by the person profile and the pipeline card detail — one identity
 * rendering so the two surfaces can't drift apart. */
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
			<div className="flex flex-col gap-4">
				<SectionHeading aside={aside}>{heading}</SectionHeading>
				<p className="text-[13px] font-medium text-fg">{name}</p>
				<p className="font-mono text-[12px] tabular-nums text-fg-muted">
					{email}
				</p>
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
