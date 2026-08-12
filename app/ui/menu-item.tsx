import { MOTION_FEEDBACK } from "./motion-classes";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { Link } from "react-router";
import { cn } from "./cn";
import { Icon, type IconName } from "./icon";

// THE row inside a PopoverSurface menu. Owns the whole menu-row skin — 34px
// grid, flush full-bleed edges (the surface clips them), the selected
// treatment, and the inset focus ring the surface's own radius would otherwise
// clip. Every popover menu is built from these; a hand-rolled row is a drift.
const BASE = cn(
	"group flex w-full min-h-[34px] items-center gap-[10px] px-[12px] py-[6px] text-left",
	`text-[13px] font-medium text-fg-muted transition-colors ${MOTION_FEEDBACK}`,
	"hover:bg-row-hover hover:text-fg",
	"disabled:bg-chip disabled:text-fg-faint disabled:hover:bg-chip",
	// -outline-offset: the ring lives INSIDE the row, or the surface's rounded
	// overflow-hidden clips it away on the first and last item.
	"focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-petrol",
);

// Design system: selected = wash + ONE 2px petrol rule on the leading edge.
const SELECTED =
	"bg-row-selected text-fg shadow-[inset_2px_0_0_var(--color-petrol)]";

type MenuItemOwnProps = {
	icon?: IconName;
	/** Second line — the row's supporting detail (dates, type, hint). */
	description?: ReactNode;
	/** Marks this row as the current choice; also sets `aria-current`. */
	selected?: boolean;
	children: ReactNode;
};

type MenuItemProps =
	| (MenuItemOwnProps & {
			to: string;
	  } & Omit<
				ComponentPropsWithoutRef<typeof Link>,
				"to" | "className" | "style" | "children"
			>)
	| (MenuItemOwnProps & {
			to?: undefined;
	  } & Omit<
				ComponentPropsWithoutRef<"button">,
				"className" | "style" | "children"
			>);

export function MenuItem({
	icon,
	description,
	selected,
	children,
	...props
}: MenuItemProps) {
	const body = (
		<>
			{icon && (
				<span
					className={cn(
						"shrink-0 opacity-70",
						selected && "text-petrol opacity-100",
					)}
				>
					<Icon name={icon} size={15} />
				</span>
			)}
			<span className="flex min-w-0 flex-1 flex-col">
				<span className="w-full truncate">{children}</span>
				{description && (
					<span className="w-full truncate text-[11.5px] font-normal text-fg-faint">
						{description}
					</span>
				)}
			</span>
		</>
	);
	const className = cn(BASE, selected && SELECTED);

	if (props.to !== undefined) {
		const { to, ...rest } = props;
		return (
			<Link
				{...rest}
				to={to}
				aria-current={selected || undefined}
				className={className}
			>
				{body}
			</Link>
		);
	}
	const { to: _to, type = "button", ...rest } = props;
	return (
		<button
			{...rest}
			type={type}
			aria-current={selected || undefined}
			className={className}
		>
			{body}
		</button>
	);
}
