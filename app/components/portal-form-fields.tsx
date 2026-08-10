import { Field, Input, Select } from "~/ui";

export type PortalFormFieldDef = {
	name: string;
	type: string;
	required: boolean;
	options?: string[];
};

const TEXTAREA =
	"min-h-20 rounded-control bg-surface px-[11px] py-2 text-[13px] text-fg shadow-control placeholder:text-fg-faint focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-petrol";

/** Renders a portal form's schema-declared fields (hotel/flight forms etc.). */
export function PortalFormFields({
	schema,
	defaults = {},
	errors = {},
}: {
	schema: PortalFormFieldDef[];
	defaults?: Record<string, unknown>;
	errors?: Record<string, string>;
}) {
	return (
		<div className="flex flex-col gap-3">
			{schema.map((field) => {
				const label = field.required ? `${field.name} *` : field.name;
				const defaultValue = String(defaults[field.name] ?? "");
				const error = errors[field.name];
				if (field.type === "textarea") {
					return (
						<label
							key={field.name}
							className="flex flex-col gap-[5px] text-[12.5px]"
						>
							<span className="font-medium text-fg-muted">{label}</span>
							<textarea
								name={`answer:${field.name}`}
								defaultValue={defaultValue}
								className={TEXTAREA}
							/>
							{error && (
								<span className="text-[11.5px] text-danger">{error}</span>
							)}
						</label>
					);
				}
				if (field.type === "dropdown") {
					return (
						<Field key={field.name} label={label} error={error}>
							<Select name={`answer:${field.name}`} defaultValue={defaultValue}>
								<option value="">Select…</option>
								{(field.options ?? []).map((o) => (
									<option key={o} value={o}>
										{o}
									</option>
								))}
							</Select>
						</Field>
					);
				}
				if (field.type === "checkbox") {
					return (
						<label
							key={field.name}
							className="inline-flex items-center gap-2 text-[13px] text-fg"
						>
							<input
								type="checkbox"
								name={`answer:${field.name}`}
								value="Yes"
								defaultChecked={defaultValue === "Yes"}
								className="h-[15px] w-[15px]"
								style={{ accentColor: "var(--color-petrol)" }}
							/>
							{label}
							{error && (
								<span className="text-[11.5px] text-danger">{error}</span>
							)}
						</label>
					);
				}
				const inputType =
					field.type === "date"
						? "date"
						: field.type === "number"
							? "number"
							: "text";
				return (
					<Field key={field.name} label={label} error={error}>
						<Input
							name={`answer:${field.name}`}
							type={inputType}
							defaultValue={defaultValue}
							invalid={Boolean(error)}
						/>
					</Field>
				);
			})}
		</div>
	);
}
