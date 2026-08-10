import type { formFields } from "~/db/schema";
import type { BadgeTone } from "~/ui";

/**
 * Form-domain contracts shared across lanes: the admin builder WRITES form
 * definitions, the public CFP renderer READS them — both must agree on when a
 * form accepts submissions, how event-timezone close instants are computed,
 * and what the built-in questions are. Pure data/functions only (this module
 * is client-bundled); the D1 reads and the sanitizer live in
 * `./forms.server`.
 */

export type FormStatus = "draft" | "open" | "closed";

/** A form can be off (draft/closed) or auto-closed by its close date — one
 * effective state answers "why is my link dead?" everywhere it's shown. */
export function effectiveFormStatus(
	status: FormStatus,
	closeAt: Date | null,
	now: number,
): FormStatus {
	if (status !== "open") return status;
	if (closeAt && closeAt.getTime() <= now) return "closed";
	return "open";
}

export const FORM_STATUS_TONE: Record<FormStatus, BadgeTone> = {
	open: "success",
	closed: "neutral",
	draft: "faint",
};

/* ------------------------------------------------------------- built-ins --- */

export type BuiltinRef = NonNullable<
	(typeof formFields.$inferSelect)["builtinRef"]
>;
export type FormSectionId = (typeof formFields.$inferSelect)["section"];

export type BuiltinMeta = {
	label: string;
	caption: string;
	section: FormSectionId;
	/** Placed automatically on every new form. */
	defaultOn: boolean;
	/** Cannot be removed from a form. */
	locked: boolean;
	/** Required state is fixed ON (identity fields + Title). */
	requiredLocked: boolean;
	defaultRequired: boolean;
	/** Eligible as a question-rule trigger (dropdown-backed built-ins). */
	trigger: boolean;
};

// Keys are type-checked against the schema's BUILTIN_FIELD enum so the two
// can never drift.
export const BUILTIN_META = {
	title: {
		label: "Title",
		caption: "Text · max 255",
		section: "session",
		defaultOn: true,
		locked: true,
		requiredLocked: true,
		defaultRequired: true,
		trigger: false,
	},
	description: {
		label: "Description",
		caption: "Rich text · max 5,000",
		section: "session",
		defaultOn: true,
		locked: true,
		requiredLocked: false,
		defaultRequired: true,
		trigger: false,
	},
	format: {
		label: "Format",
		caption: "Dropdown",
		section: "session",
		defaultOn: true,
		locked: false,
		requiredLocked: false,
		defaultRequired: false,
		trigger: true,
	},
	tags: {
		label: "Tags",
		caption: "Dropdown",
		section: "session",
		defaultOn: true,
		locked: false,
		requiredLocked: false,
		defaultRequired: false,
		trigger: true,
	},
	track: {
		label: "Track",
		caption: "Dropdown",
		section: "session",
		defaultOn: true,
		locked: false,
		requiredLocked: false,
		defaultRequired: false,
		trigger: true,
	},
	level: {
		label: "Level",
		caption: "Dropdown",
		section: "session",
		defaultOn: true,
		locked: false,
		requiredLocked: false,
		defaultRequired: false,
		trigger: true,
	},
	language: {
		label: "Language",
		caption: "Dropdown",
		section: "session",
		defaultOn: true,
		locked: false,
		requiredLocked: false,
		defaultRequired: false,
		trigger: true,
	},
	first_name: {
		label: "First name",
		caption: "Text · max 255",
		section: "participant",
		defaultOn: true,
		locked: true,
		requiredLocked: true,
		defaultRequired: true,
		trigger: false,
	},
	last_name: {
		label: "Last name",
		caption: "Text · max 255",
		section: "participant",
		defaultOn: true,
		locked: true,
		requiredLocked: true,
		defaultRequired: true,
		trigger: false,
	},
	email: {
		label: "Email",
		caption: "Email",
		section: "participant",
		defaultOn: true,
		locked: true,
		requiredLocked: true,
		defaultRequired: true,
		trigger: false,
	},
	mobile_phone: {
		label: "Mobile phone",
		caption: "Phone",
		section: "participant",
		defaultOn: true,
		locked: false,
		requiredLocked: false,
		defaultRequired: false,
		trigger: false,
	},
	home_phone: {
		label: "Home phone",
		caption: "Phone",
		section: "participant",
		defaultOn: false,
		locked: false,
		requiredLocked: false,
		defaultRequired: false,
		trigger: false,
	},
	biography: {
		label: "Biography",
		caption: "Rich text · max 5,000",
		section: "participant",
		defaultOn: true,
		locked: false,
		requiredLocked: false,
		defaultRequired: false,
		trigger: false,
	},
	company_name: {
		label: "Company name",
		caption: "Text · max 255",
		section: "participant",
		defaultOn: false,
		locked: false,
		requiredLocked: false,
		defaultRequired: false,
		trigger: false,
	},
	job_title: {
		label: "Job title",
		caption: "Text · max 255",
		section: "participant",
		defaultOn: false,
		locked: false,
		requiredLocked: false,
		defaultRequired: false,
		trigger: false,
	},
	headshot: {
		label: "Headshot",
		caption: "File upload",
		section: "participant",
		defaultOn: false,
		locked: false,
		requiredLocked: false,
		defaultRequired: false,
		trigger: false,
	},
	zip: {
		label: "Zip / postal code",
		caption: "Text",
		section: "participant",
		defaultOn: false,
		locked: false,
		requiredLocked: false,
		defaultRequired: false,
		trigger: false,
	},
} as const satisfies Record<BuiltinRef, BuiltinMeta>;

export const BUILTIN_ORDER = Object.keys(BUILTIN_META) as BuiltinRef[];

/** Library field types eligible to TRIGGER a question rule. */
export const RULE_TRIGGER_FIELD_TYPES = [
	"dropdown",
	"checkbox",
	"number",
] as const;

/** The placements every new form starts with, in Sessionboard's default order. */
export function defaultBuiltinPlacements(
	formId: string,
): Array<typeof formFields.$inferInsert> {
	const nextPos: Record<FormSectionId, number> = { session: 0, participant: 0 };
	return BUILTIN_ORDER.filter((ref) => BUILTIN_META[ref].defaultOn).map(
		(ref) => {
			const meta = BUILTIN_META[ref];
			return {
				formId,
				builtinRef: ref,
				section: meta.section,
				position: nextPos[meta.section]++,
				required: meta.defaultRequired,
				locked: meta.locked,
			};
		},
	);
}

/* ------------------------------------------------------------- timezones --- */

function tzOffsetMs(ts: number, timeZone: string): number {
	const dtf = new Intl.DateTimeFormat("en-US", {
		timeZone,
		hourCycle: "h23",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	});
	const p = Object.fromEntries(
		dtf.formatToParts(new Date(ts)).map((x) => [x.type, x.value]),
	);
	return (
		Date.UTC(
			Number(p.year),
			Number(p.month) - 1,
			Number(p.day),
			Number(p.hour) % 24,
			Number(p.minute),
			Number(p.second),
		) - ts
	);
}

/** Interpret a wall-clock entry ("2027-04-30" + "23:59") in the EVENT's
 * timezone — close dates must not shift with the viewer's browser TZ. */
export function zonedTimeToUtc(
	date: string,
	time: string,
	timeZone: string,
): Date {
	const [y, m, d] = date.split("-").map(Number);
	const [hh, mm] = time.split(":").map(Number);
	const guess = Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1, hh ?? 0, mm ?? 0);
	// Two-pass: the offset at the guess can differ across a DST boundary.
	const offset = tzOffsetMs(guess - tzOffsetMs(guess, timeZone), timeZone);
	return new Date(guess - offset);
}

/** The inverse — render a stored instant as date/time input values in the
 * event's timezone. */
export function utcToZonedInputs(
	at: Date,
	timeZone: string,
): { date: string; time: string } {
	const dtf = new Intl.DateTimeFormat("en-CA", {
		timeZone,
		hourCycle: "h23",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
	});
	const p = Object.fromEntries(
		dtf.formatToParts(at).map((x) => [x.type, x.value]),
	);
	const hour = String(Number(p.hour) % 24).padStart(2, "0");
	return {
		date: `${p.year}-${p.month}-${p.day}`,
		time: `${hour}:${p.minute}`,
	};
}
