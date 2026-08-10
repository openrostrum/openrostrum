import { Checkbox, Field, Input, Select, Textarea } from "~/ui";

export type PortalFormFieldDef = {
	name: string;
	type: string;
	required: boolean;
	options?: string[];
};

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
						<Field key={field.name} label={label} error={error}>
							<Textarea
								name={`answer:${field.name}`}
								defaultValue={defaultValue}
								rows={4}
							/>
						</Field>
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
						<div key={field.name} className="flex flex-col gap-1">
							<Checkbox
								name={`answer:${field.name}`}
								value="Yes"
								defaultChecked={defaultValue === "Yes"}
								label={label}
							/>
							{error && (
								<span className="text-[11.5px] text-danger">{error}</span>
							)}
						</div>
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
