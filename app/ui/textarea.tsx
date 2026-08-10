import type { ComponentPropsWithoutRef } from "react";
import { cn } from "./cn";

/**
 * Multi-line counterpart of Input, mirroring its control recipe
 * token-for-token so a token re-skin restyles both identically.
 */
type TextareaProps = Omit<
	ComponentPropsWithoutRef<"textarea">,
	"className" | "style"
> & { invalid?: boolean };

export function Textarea({ invalid, rows = 5, ...props }: TextareaProps) {
	return (
		<textarea
			{...props}
			rows={rows}
			aria-invalid={invalid || undefined}
			className={cn(
				"w-full rounded-control bg-surface px-[11px] py-[8px] text-[13px] text-fg shadow-control",
				"placeholder:text-fg-faint",
				"focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-petrol",
				invalid && "shadow-[inset_0_0_0_1px_var(--color-danger)]",
			)}
		/>
	);
}
