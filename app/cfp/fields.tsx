import { Field, Input, Select } from "~/ui";
import {
	isFieldVisible,
	isInputField,
	plainTextLength,
	type WizardField,
	type WizardValues,
} from "./definition";
import {
	CharCounter,
	Checkbox,
	FieldDivider,
	MutedText,
	RichText,
	SectionHeading,
	Textarea,
} from "./ui";

/**
 * Renders one wizard section from its field descriptors. Question rules are
 * re-evaluated on every value change, so dependent questions appear and
 * disappear instantly — no reload, both directions.
 */

function FieldControl({
	field,
	value,
	error,
	onChange,
}: {
	field: WizardField;
	value: string;
	error?: string;
	onChange: (key: string, value: string) => void;
}) {
	const showCounter =
		field.maxLength !== undefined &&
		(field.type === "text" ||
			field.type === "textarea" ||
			field.type === "wysiwyg");
	const label = field.required ? `${field.label} *` : field.label;

	if (field.type === "checkbox") {
		return (
			<div className="flex flex-col gap-1">
				<Checkbox
					label={label}
					checked={value === "true"}
					onChange={(e) => onChange(field.key, e.target.checked ? "true" : "")}
				/>
				{field.description && (
					<span className="text-[12px] text-fg-muted">{field.description}</span>
				)}
				{error && <span className="text-[11.5px] text-danger">{error}</span>}
			</div>
		);
	}

	const control = (() => {
		switch (field.type) {
			case "wysiwyg":
				return (
					<RichText
						value={value}
						onChange={(html) => onChange(field.key, html)}
						placeholder={field.description}
						invalid={Boolean(error)}
						ariaLabel={field.label}
					/>
				);
			case "textarea":
				return (
					<Textarea
						value={value}
						maxLength={field.maxLength}
						invalid={Boolean(error)}
						onChange={(e) => onChange(field.key, e.target.value)}
					/>
				);
			case "dropdown":
				return (
					<Select
						value={value}
						aria-invalid={error ? true : undefined}
						onChange={(e) => onChange(field.key, e.target.value)}
					>
						<option value="">Select…</option>
						{(field.options ?? []).map((o) => (
							<option key={o.value} value={o.value}>
								{o.label}
							</option>
						))}
					</Select>
				);
			default:
				return (
					<Input
						type={
							field.type === "email"
								? "email"
								: field.type === "number"
									? "number"
									: field.type === "phone"
										? "tel"
										: field.type === "date"
											? "date"
											: "text"
						}
						value={value}
						maxLength={field.maxLength}
						invalid={Boolean(error)}
						placeholder={field.type === "phone" ? "+1 415 555 0142" : undefined}
						onChange={(e) => onChange(field.key, e.target.value)}
					/>
				);
		}
	})();

	return (
		<div className="flex flex-col gap-1">
			<Field label={label} error={error}>
				{control}
			</Field>
			<div className="flex items-start justify-between gap-3">
				{field.description && field.type !== "wysiwyg" ? (
					<span className="text-[12px] text-fg-muted">{field.description}</span>
				) : (
					<span />
				)}
				{showCounter && field.maxLength !== undefined && (
					<CharCounter
						count={
							field.type === "wysiwyg" ? plainTextLength(value) : value.length
						}
						max={field.maxLength}
					/>
				)}
			</div>
		</div>
	);
}

export function SectionFields({
	fields,
	values,
	errors,
	onChange,
}: {
	fields: WizardField[];
	values: WizardValues;
	errors: Record<string, string>;
	onChange: (key: string, value: string) => void;
}) {
	return (
		<div className="flex flex-col gap-4">
			{fields.map((field) => {
				if (field.type === "section_header") {
					return (
						<SectionHeading
							key={field.key}
							title={field.label}
							description={field.description}
						/>
					);
				}
				if (field.type === "divider") {
					return <FieldDivider key={field.key} />;
				}
				if (field.type === "note") {
					return (
						<MutedText key={field.key}>
							{field.label}: {field.description}
						</MutedText>
					);
				}
				if (!isInputField(field)) return null;
				if (!isFieldVisible(field, values, fields)) return null;
				return (
					<FieldControl
						key={field.key}
						field={field}
						value={values[field.key] ?? ""}
						error={errors[field.key]}
						onChange={onChange}
					/>
				);
			})}
		</div>
	);
}
