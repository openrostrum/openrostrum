import type { ComponentPropsWithoutRef } from "react";
import { cn } from "~/ui/cn";

// app/ui (integration-owned) ships no multiline control; this composes the
// SAME control tokens as its Input so a token re-skin covers it with zero
// diffs here. Owner request filed: adopt a Textarea primitive into app/ui.
type TextareaProps = Omit<
	ComponentPropsWithoutRef<"textarea">,
	"className" | "style"
> & { invalid?: boolean };

export function Textarea({ invalid, rows = 6, ...props }: TextareaProps) {
	return (
		<textarea
			{...props}
			rows={rows}
			aria-invalid={invalid || undefined}
			className={cn(
				"w-full rounded-control bg-surface px-[11px] py-2 text-[13px] text-fg shadow-control",
				"placeholder:text-fg-faint",
				"focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-petrol",
				invalid && "shadow-[inset_0_0_0_1px_var(--color-danger)]",
			)}
		/>
	);
}
