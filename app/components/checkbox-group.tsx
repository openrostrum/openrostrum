import { Checkbox } from "~/ui";

/**
 * Checkbox list bound to one form field name — composes the ~/ui Checkbox
 * (app/components composes primitives, it never defines skins).
 */
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
				<Checkbox
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
