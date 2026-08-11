import { Checkbox, ErrorText, Field, Input, Select, Textarea } from "~/ui";

export const PORTAL_FIELD_TYPES = [
	"text",
	"textarea",
	"dropdown",
	"checkbox",
	"number",
	"date",
] as const;

export type PortalFieldType = (typeof PORTAL_FIELD_TYPES)[number];

/** Builder-facing labels — keyed off the PORTAL type union, not the CFP
 * fields schema, so a portal-only field type never needs a CFP change. */
export const PORTAL_FIELD_TYPE_LABELS: Record<PortalFieldType, string> = {
	text: "Text",
	textarea: "Text area",
	dropdown: "Dropdown",
	checkbox: "Checkbox",
	number: "Number",
	date: "Date",
};

export type PortalFormFieldDef = {
	name: string;
	type: string;
	required: boolean;
	options?: string[];
};

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
		<div className="flex flex-col gap-[13px]">
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
						<div key={field.name} className="flex flex-col gap-2">
							<Checkbox
								name={`answer:${field.name}`}
								value="Yes"
								defaultChecked={defaultValue === "Yes"}
								label={label}
							/>
							{error && <ErrorText>{error}</ErrorText>}
						</div>
					);
				}
				if (!PORTAL_FIELD_TYPES.includes(field.type as PortalFieldType)) {
					throw new Error(`Unsupported portal field type: ${field.type}`);
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
