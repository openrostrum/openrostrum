import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { cn } from "./cn";

const CONTROL = cn(
	"h-[34px] rounded-control bg-surface px-[11px] text-[13px] text-fg shadow-control",
	"placeholder:text-fg-faint",
	"focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-petrol",
);

export function Field({
	label,
	hint,
	error,
	aside,
	children,
	composite = false,
}: {
	label: string;
	/** What the control does to the data — shown under it, always, not only on error. */
	hint?: ReactNode;
	error?: string;
	/** Trailing note on the error's row — a character count, a size limit. */
	aside?: ReactNode;
	children: ReactNode;
	/** Composite controls own their accessible names; wrapping toolbar buttons in a label activates the first button on editor clicks. */
	composite?: boolean;
}) {
	const content = (
		<>
			<span className="font-medium text-fg-muted">{label}</span>
			{children}
			{hint && <span className="text-fg-muted">{hint}</span>}
			{(error || aside) && (
				<div className="flex items-baseline">
					{error && <span className="text-[11.5px] text-danger">{error}</span>}
					{aside && <span className="ml-auto">{aside}</span>}
				</div>
			)}
		</>
	);
	const className = "flex flex-col gap-[5px] text-[12.5px]";
	return composite ? (
		<div className={className}>{content}</div>
	) : (
		<label className={className}>{content}</label>
	);
}

type InputProps = Omit<
	ComponentPropsWithoutRef<"input">,
	"className" | "style"
> & { invalid?: boolean };

export function Input({ invalid, ...props }: InputProps) {
	return (
		<input
			{...props}
			aria-invalid={invalid || undefined}
			className={cn(
				CONTROL,
				invalid && "shadow-[inset_0_0_0_1px_var(--color-danger)]",
			)}
		/>
	);
}

type SelectProps = Omit<
	ComponentPropsWithoutRef<"select">,
	"className" | "style"
>;

export function Select(props: SelectProps) {
	return <select {...props} className={CONTROL} />;
}
