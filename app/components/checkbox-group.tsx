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
				<label
					key={o.value}
					className="inline-flex items-center gap-2 text-[13px] text-fg"
				>
					<input
						type="checkbox"
						name={name}
						value={o.value}
						defaultChecked={defaultChecked.includes(o.value)}
						className="h-[15px] w-[15px]"
						style={{ accentColor: "var(--color-petrol)" }}
					/>
					{o.label}
				</label>
			))}
		</div>
	);
}
