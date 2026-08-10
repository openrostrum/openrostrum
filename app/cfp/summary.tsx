import {
	isFieldVisible,
	isInputField,
	ROLE_LABELS,
	type WizardField,
	type WizardParticipant,
	type WizardValues,
} from "./definition";
import { HtmlContent, MutedText, SectionHeading } from "./ui";

/**
 * Read-only rendering of a wizard's answers — the Review step and the
 * post-close read-only view share it, so what the speaker confirms is exactly
 * what an editing-closed submission shows.
 */

function DisplayValue({ field, value }: { field: WizardField; value: string }) {
	if (!value.trim()) {
		return <MutedText>—</MutedText>;
	}
	if (field.type === "wysiwyg") return <HtmlContent html={value} />;
	if (field.type === "dropdown") {
		const label = field.options?.find((o) => o.value === value)?.label ?? value;
		return <span className="text-[13.5px] text-fg">{label}</span>;
	}
	if (field.type === "checkbox") {
		return (
			<span className="text-[13.5px] text-fg">
				{value === "true" ? "Yes" : "No"}
			</span>
		);
	}
	return (
		<span className="whitespace-pre-wrap text-[13.5px] text-fg">{value}</span>
	);
}

export function AnswersSummary({
	fields,
	values,
}: {
	fields: WizardField[];
	values: WizardValues;
}) {
	return (
		<dl className="flex flex-col gap-3">
			{fields.map((field) => {
				if (!isInputField(field)) return null;
				if (!isFieldVisible(field, values, fields)) return null;
				return (
					<div key={field.key} className="flex flex-col gap-[3px]">
						<dt className="text-[11px] font-semibold uppercase tracking-[0.06em] text-fg-muted">
							{field.label}
						</dt>
						<dd>
							<DisplayValue field={field} value={values[field.key] ?? ""} />
						</dd>
					</div>
				);
			})}
		</dl>
	);
}

export function ParticipantsSummary({
	participants,
}: {
	participants: WizardParticipant[];
}) {
	if (participants.length === 0) {
		return <MutedText>No participants added yet.</MutedText>;
	}
	return (
		<ul className="flex flex-col gap-2">
			{participants.map((p) => (
				<li key={p.key} className="flex flex-col gap-[2px]">
					<span className="text-[13.5px] font-medium text-fg">
						{p.firstName} {p.lastName}
						{p.self ? " (you)" : ""}
					</span>
					<MutedText>
						{ROLE_LABELS[p.role]} · {p.email}
						{p.mobilePhone ? ` · ${p.mobilePhone}` : ""}
					</MutedText>
				</li>
			))}
		</ul>
	);
}

export function SummarySection({
	title,
	children,
}: {
	title: string;
	children: React.ReactNode;
}) {
	return (
		<div className="flex flex-col gap-3">
			<SectionHeading title={title} />
			{children}
		</div>
	);
}
