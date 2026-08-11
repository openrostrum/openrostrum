import type { ReactNode } from "react";
import { NavLink } from "react-router";
import { cn } from "./cn";

// Active state changes color and underline, never weight — a weight change
// shifts layout on every tab switch.
const TAB = cn(
	"-mb-px flex items-center gap-[7px] border-b-2 border-transparent px-[11px] pb-[10px] pt-2",
	"text-[13.5px] font-medium text-fg-muted transition-colors [transition-duration:var(--motion-duration-feedback)] [transition-timing-function:var(--ease-gallery-responsive)] motion-reduce:transition-none hover:text-fg",
	"focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-petrol",
);
const TAB_ON = "border-petrol text-fg";

export function Tabs({ children }: { children: ReactNode }) {
	return <div className="flex gap-1 border-b border-hair">{children}</div>;
}

export function Tab({
	to,
	count,
	active,
	children,
}: {
	to: string;
	count?: number;
	active?: boolean;
	children: ReactNode;
}) {
	return (
		<NavLink
			to={to}
			end
			className={({ isActive }) => cn(TAB, (active ?? isActive) && TAB_ON)}
		>
			{({ isActive }) => (
				<>
					{children}
					{count !== undefined && (
						<span
							className={cn(
								"rounded-full bg-chip px-[7px] py-px font-mono text-[10.5px] font-medium text-fg-muted",
								(active ?? isActive) && "bg-petrol-wash text-petrol",
							)}
						>
							{count}
						</span>
					)}
				</>
			)}
		</NavLink>
	);
}
