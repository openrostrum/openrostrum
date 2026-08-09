import type { ComponentPropsWithoutRef } from "react";
import { Icon } from "./icon";

type Props = Omit<
	ComponentPropsWithoutRef<"input">,
	"className" | "style" | "type"
>;

export function SearchInput(props: Props) {
	return (
		<label className="flex h-[34px] max-w-[320px] flex-1 items-center gap-2 rounded-control bg-surface px-[11px] text-fg-faint shadow-control focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-petrol">
			<Icon name="search" size={14} />
			<input
				{...props}
				type="search"
				className="w-full bg-transparent text-[13px] text-fg outline-none placeholder:text-fg-faint"
			/>
		</label>
	);
}
