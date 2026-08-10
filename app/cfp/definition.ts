/**
 * Public CFP wizard — form definition + validation, shared by the client
 * (instant show/hide + inline errors) and the server (the authoritative check
 * on submit). Only TYPES come from ~/db/schema (erased at build), so this
 * client-bundled module never pulls the drizzle runtime.
 */
import type { BUILTIN_FIELD, FIELD_TYPE, QuestionRule } from "~/db/schema";

export type BuiltinRef = (typeof BUILTIN_FIELD)[number];

export type WizardFieldType =
	| (typeof FIELD_TYPE)[number]
	/** Multi-value taxonomy (tags): value = comma-joined ids. */
	| "multi_dropdown"
	/** Non-input explainer for a built-in this surface collects elsewhere. */
	| "note";

export type WizardRule = QuestionRule;

export type WizardOption = { value: string; label: string };

export type WizardField = {
	/** Value key in WizardValues: `b_<builtinRef>` or `f_<fieldId>`. */
	key: string;
	builtinRef?: BuiltinRef;
	fieldId?: string;
	label: string;
	type: WizardFieldType;
	required: boolean;
	locked: boolean;
	maxLength?: number;
	description?: string;
	options?: WizardOption[];
	rule: WizardRule;
};

export type WizardValues = Record<string, string>;

export type ParticipantRole =
	| "speaker"
	| "chairperson"
	| "moderator"
	| "secondary";

export type WizardParticipant = {
	/** Client row key (stable across re-renders, not persisted). */
	key: string;
	role: ParticipantRole;
	firstName: string;
	lastName: string;
	email: string;
	mobilePhone: string;
	bio: string;
	/** The submitter's own row: prefilled from their account, email fixed. */
	self?: boolean;
};

/** The submitter's own profile snapshot used to prefill their person row. */
export type SelfContact = {
	firstName: string;
	lastName: string;
	email: string;
	mobilePhone: string;
	bio: string;
};

export type RoleLimits = { min: number; max: number | null };
export type RoleConfig = Partial<Record<ParticipantRole, RoleLimits>>;

export type WizardState = {
	/** Client-minted UUID, used as the submission row id → double-submit safe. */
	wizardId: string;
	/** Existing submission being edited (draft resume or edit-until-close). */
	sid?: string;
	/** Status of the loaded row — "draft" resumes, anything else is an edit. */
	loadedStatus?: string;
	values: WizardValues;
	participants: WizardParticipant[];
};

/** True when the loaded row was already submitted (edit-until-close mode). */
export function isEditingSubmitted(state: WizardState): boolean {
	return state.loadedStatus !== undefined && state.loadedStatus !== "draft";
}

export function builtinKey(ref: string): string {
	return `b_${ref}`;
}
export function fieldKey(fieldId: string): string {
	return `f_${fieldId}`;
}

/**
 * Built-in question metadata. Options for the dropdown built-ins are injected
 * per event (taxonomies) when the server resolves the form definition.
 */
export const BUILTIN_META: Record<
	BuiltinRef,
	{ label: string; type: WizardFieldType; maxLength?: number; note?: string }
> = {
	title: { label: "Title", type: "text", maxLength: 255 },
	description: { label: "Description", type: "wysiwyg", maxLength: 5000 },
	format: { label: "Format", type: "dropdown" },
	tags: { label: "Tags", type: "multi_dropdown" },
	track: { label: "Track", type: "dropdown" },
	level: { label: "Level", type: "dropdown" },
	language: { label: "Language", type: "dropdown" },
	first_name: { label: "First Name", type: "text", maxLength: 255 },
	last_name: { label: "Last Name", type: "text", maxLength: 255 },
	email: { label: "Email", type: "email" },
	mobile_phone: { label: "Mobile Phone", type: "phone" },
	home_phone: { label: "Home Phone", type: "phone" },
	biography: { label: "Biography", type: "wysiwyg", maxLength: 5000 },
	company_name: { label: "Company Name", type: "text", maxLength: 255 },
	job_title: { label: "Job Title", type: "text", maxLength: 255 },
	headshot: {
		label: "Headshot",
		type: "note",
		note: "Headshots are uploaded from your speaker portal profile after you submit.",
	},
	zip: { label: "Zip", type: "text", maxLength: 20 },
};

/** Participant built-ins rendered per person row (identity + phone + bio). */
export const CORE_PARTICIPANT_REFS: ReadonlySet<string> = new Set([
	"first_name",
	"last_name",
	"email",
	"mobile_phone",
	"biography",
]);

/** Participant-section placements that render once, outside the person rows. */
export function participantExtraFields(fields: WizardField[]): WizardField[] {
	return fields.filter(
		(f) =>
			f.builtinRef === undefined || !CORE_PARTICIPANT_REFS.has(f.builtinRef),
	);
}

export function participantRequirements(
	fields: WizardField[],
): ParticipantRequirements {
	return {
		mobilePhone:
			fields.find((f) => f.builtinRef === "mobile_phone")?.required ?? false,
		bio: fields.find((f) => f.builtinRef === "biography")?.required ?? false,
	};
}

/**
 * The default session-section question set for a form with no per-form
 * built-in placements yet (a freshly seeded/created form): the walkthrough's
 * Title/Description locked + the five taxonomy dropdowns, Format/Tags/Track
 * required, Level/Language optional.
 */
export const DEFAULT_SESSION_BUILTINS: ReadonlyArray<{
	ref: BuiltinRef;
	required: boolean;
	locked: boolean;
}> = [
	{ ref: "title", required: true, locked: true },
	{ ref: "description", required: true, locked: true },
	{ ref: "format", required: true, locked: false },
	{ ref: "tags", required: true, locked: false },
	{ ref: "track", required: true, locked: false },
	{ ref: "level", required: false, locked: false },
	{ ref: "language", required: false, locked: false },
];

export const DEFAULT_PARTICIPANT_BUILTINS: ReadonlyArray<{
	ref: BuiltinRef;
	required: boolean;
	locked: boolean;
}> = [
	{ ref: "first_name", required: true, locked: true },
	{ ref: "last_name", required: true, locked: true },
	{ ref: "email", required: true, locked: true },
	{ ref: "mobile_phone", required: false, locked: false },
	{ ref: "biography", required: false, locked: false },
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(value: string): boolean {
	return EMAIL_RE.test(value.trim());
}

/** Comma-joined multi-value codec for multi_dropdown values (tags). */
export function splitMultiValue(value: string): string[] {
	return value
		.split(",")
		.map((v) => v.trim())
		.filter(Boolean);
}
export function joinMultiValue(values: string[]): string {
	return values.join(",");
}

/** Visible-text length of a rich-text value (counters, caps, empty checks). */
export function plainTextLength(html: string): number {
	return html.replace(/<[^>]*>/g, "").trim().length;
}

function ruleTriggerKey(rule: NonNullable<WizardRule>): string {
	return rule.trigger.kind === "field"
		? fieldKey(rule.trigger.fieldId)
		: builtinKey(rule.trigger.ref);
}

/**
 * Evaluate a question rule against the current values. Dropdown triggers match
 * on the stored value OR its visible label, so rules authored against either
 * representation fire (built-in dropdowns store taxonomy ids, library
 * dropdowns store the option string).
 */
export function ruleMatches(
	rule: NonNullable<WizardRule>,
	values: WizardValues,
	fields: WizardField[],
): boolean {
	const key = ruleTriggerKey(rule);
	const raw = (values[key] ?? "").trim();
	const expected = rule.value.trim();

	if (rule.operator === "gt" || rule.operator === "lt") {
		const a = Number(raw);
		const b = Number(expected);
		if (Number.isNaN(a) || Number.isNaN(b)) return false;
		return rule.operator === "gt" ? a > b : a < b;
	}

	let matches = raw === expected;
	if (!matches) {
		const trigger = fields.find((f) => f.key === key);
		const label = trigger?.options?.find((o) => o.value === raw)?.label;
		if (label !== undefined) matches = label.trim() === expected;
	}
	return rule.operator === "equals" ? matches : !matches;
}

/** A field with no rule is always visible; a rule shows it only on match. */
export function isFieldVisible(
	field: WizardField,
	values: WizardValues,
	fields: WizardField[],
): boolean {
	if (!field.rule) return true;
	return ruleMatches(field.rule, values, fields);
}

const LAYOUT_TYPES: ReadonlyArray<WizardFieldType> = [
	"section_header",
	"divider",
	"note",
];

export function isInputField(field: WizardField): boolean {
	return !LAYOUT_TYPES.includes(field.type);
}

/**
 * Validate one wizard section. Required/format checks apply to VISIBLE input
 * fields only — a rule-hidden field never blocks.
 */
export function validateSection(
	fields: WizardField[],
	values: WizardValues,
): Record<string, string> {
	const errors: Record<string, string> = {};
	for (const field of fields) {
		if (!isInputField(field)) continue;
		if (!isFieldVisible(field, values, fields)) continue;
		const raw = (values[field.key] ?? "").trim();
		const isEmpty =
			field.type === "wysiwyg" ? plainTextLength(raw) === 0 : raw.length === 0;
		if (field.required && isEmpty) {
			errors[field.key] = `${field.label} is required`;
			continue;
		}
		if (isEmpty) continue;
		if (field.maxLength !== undefined) {
			const length =
				field.type === "wysiwyg" ? plainTextLength(raw) : raw.length;
			if (length > field.maxLength) {
				errors[field.key] =
					`${field.label} must be ${field.maxLength} characters or fewer`;
				continue;
			}
		}
		if (field.type === "email" && !isValidEmail(raw)) {
			errors[field.key] = "Enter a valid email address.";
			continue;
		}
		if (field.type === "number" && Number.isNaN(Number(raw))) {
			errors[field.key] = `${field.label} must be a number`;
			continue;
		}
		if (
			field.type === "dropdown" &&
			field.options !== undefined &&
			!field.options.some((o) => o.value === raw)
		) {
			errors[field.key] = `Choose a valid ${field.label}`;
			continue;
		}
		if (field.type === "multi_dropdown" && field.options !== undefined) {
			const chosen = splitMultiValue(raw);
			const valid = new Set(field.options.map((o) => o.value));
			if (chosen.some((v) => !valid.has(v))) {
				errors[field.key] = `Choose valid ${field.label}`;
			}
		}
	}
	return errors;
}

export const ROLE_LABELS: Record<ParticipantRole, string> = {
	speaker: "Speaker",
	chairperson: "Chairperson",
	moderator: "Moderator",
	secondary: "Secondary Contact",
};

export function roleCountLabel(
	limits: RoleLimits,
	count: number,
	roleLabel = "Speakers",
): string {
	const added = `${count} added`;
	if (limits.max === null) {
		return `At least ${limits.min} ${roleLabel} · ${added}`;
	}
	const range =
		limits.max === limits.min ? `${limits.min}` : `${limits.min}–${limits.max}`;
	return `${range} ${roleLabel} allowed · ${added}`;
}

export type ParticipantErrors = {
	/** Per-row field errors keyed by participant key → field name → message. */
	rows: Record<
		string,
		Partial<
			Record<"firstName" | "lastName" | "email" | "mobilePhone" | "bio", string>
		>
	>;
	/** Role-level errors (min/max violations, duplicate emails). */
	form: string[];
};

export type ParticipantRequirements = {
	/** Form-level required flags for the optional per-person built-ins. */
	mobilePhone?: boolean;
	bio?: boolean;
};

export function validateParticipants(
	participants: WizardParticipant[],
	roles: RoleConfig,
	requirements: ParticipantRequirements = {},
): ParticipantErrors {
	const rows: ParticipantErrors["rows"] = {};
	const form: string[] = [];

	const seen = new Map<string, string>();
	for (const p of participants) {
		const rowErrors: ParticipantErrors["rows"][string] = {};
		if (!p.firstName.trim()) rowErrors.firstName = "First name is required";
		if (!p.lastName.trim()) rowErrors.lastName = "Last name is required";
		if (!p.email.trim()) rowErrors.email = "Email is required";
		else if (!isValidEmail(p.email))
			rowErrors.email = "Enter a valid email address.";
		else {
			const normalized = p.email.trim().toLowerCase();
			if (seen.has(normalized))
				rowErrors.email = "This email is already listed on the submission";
			seen.set(normalized, p.key);
		}
		if (p.role !== "secondary") {
			if (requirements.mobilePhone && !p.mobilePhone.trim())
				rowErrors.mobilePhone = "Mobile phone is required";
			if (requirements.bio && plainTextLength(p.bio) === 0)
				rowErrors.bio = "Biography is required";
		}
		if (Object.keys(rowErrors).length > 0) rows[p.key] = rowErrors;
	}

	for (const [role, limits] of Object.entries(roles) as Array<
		[ParticipantRole, RoleLimits]
	>) {
		const count = participants.filter((p) => p.role === role).length;
		if (count < limits.min) {
			form.push(
				`At least ${limits.min} ${ROLE_LABELS[role].toLowerCase()}${limits.min === 1 ? " is" : "s are"} required.`,
			);
		}
	}
	form.push(...roleMaxErrors(participants, roles));

	return { rows, form };
}

/** Role maximums alone — draft saves skip minimums but still respect caps. */
export function roleMaxErrors(
	participants: Array<{ role: ParticipantRole }>,
	roles: RoleConfig,
): string[] {
	const errors: string[] = [];
	for (const [role, limits] of Object.entries(roles) as Array<
		[ParticipantRole, RoleLimits]
	>) {
		const count = participants.filter((p) => p.role === role).length;
		if (limits.max !== null && count > limits.max) {
			errors.push(
				`No more than ${limits.max} ${ROLE_LABELS[role].toLowerCase()}s are allowed.`,
			);
		}
	}
	return errors;
}
