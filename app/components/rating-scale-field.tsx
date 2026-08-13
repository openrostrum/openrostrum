import {
	RATING_DIRECTION,
	ratingLegend,
	type RatingAnchor,
} from "~/lib/evaluation";
import { Field, Select } from "~/ui";

export function RatingScaleField({
	name,
	label,
	required,
	anchors,
	defaultValue,
	disabled,
	weightNote,
	error,
}: {
	name: string;
	label: string;
	required: boolean;
	anchors: readonly RatingAnchor[];
	defaultValue: number | null;
	disabled: boolean;
	weightNote: string | null;
	error?: string;
}) {
	const legend = ratingLegend(anchors);
	return (
		<Field
			label={`${label}${required ? " *" : ""}`}
			error={error}
			hint={
				<>
					{RATING_DIRECTION}.{legend ? ` ${legend}.` : ""}
					{weightNote ? ` ${weightNote}` : ""}
				</>
			}
		>
			<Select
				name={name}
				defaultValue={defaultValue == null ? "" : String(defaultValue)}
				disabled={disabled}
			>
				<option value="">—</option>
				{anchors.map((anchor) => (
					<option key={anchor.value} value={anchor.value}>
						{`${anchor.value} — ${anchor.label}`}
					</option>
				))}
			</Select>
		</Field>
	);
}
