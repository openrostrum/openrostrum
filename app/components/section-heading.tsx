import type { ReactNode } from "react";
import { Caps } from "~/ui";

export function SectionHeading({
	children,
	aside,
}: {
	children: ReactNode;
	aside?: ReactNode;
}) {
	return (
		<div className="flex items-baseline">
			<Caps as="h2">{children}</Caps>
			{aside != null && <span className="ml-auto text-[12.5px]">{aside}</span>}
		</div>
	);
}
