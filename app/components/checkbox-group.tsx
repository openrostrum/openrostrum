import type { ComponentPropsWithoutRef, ReactNode } from "react";

/**
 * Labeled checkbox (pending-promotion primitive — no Checkbox exists in
 * app/ui yet; single definition here so the skin lives in ONE place).
 */
export function CheckboxOption({
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
				className="h-[15px] w-[15px]"
				style={{ accentColor: "var(--color-petrol)" }}
			/>
			{label}
		</label>
	);
}

export function CheckboxGroup({
	name,
	options,
	defaultChecked = [],
}: {
	name: string;
	options: Array<{ value: string; label: string }>;
	defaultChecked?: string[];
}) {
	return (
		<div className="flex flex-wrap gap-x-4 gap-y-2">
			{options.map((o) => (
				<CheckboxOption
					key={o.value}
					name={name}
					value={o.value}
					defaultChecked={defaultChecked.includes(o.value)}
					label={o.label}
				/>
			))}
		</div>
	);
}
