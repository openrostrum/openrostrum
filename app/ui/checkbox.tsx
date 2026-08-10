import type { ComponentPropsWithoutRef, ReactNode } from "react";

/**
 * Labeled checkbox — THE checkbox skin (a bare unlabeled box is almost never
 * right; pass a ReactNode label for rich text). Groups/layouts compose this
 * (see app/components/checkbox-group.tsx).
 */
export function Checkbox({
	label,
	...props
}: Omit<ComponentPropsWithoutRef<"input">, "type" | "className" | "style"> & {
	label: ReactNode;
}) {
	return (
		<label className="inline-flex items-center gap-2 text-[13px] text-fg">
			<input
				{...props}
				type="checkbox"
				className="h-[15px] w-[15px] accent-petrol"
			/>
			{label}
		</label>
	);
}
