import { describe, expect, it } from "vitest";
import {
	isFieldVisible,
	validateParticipants,
	validateSection,
	type WizardField,
} from "../app/cfp/definition";
import { sanitizeHtml } from "../app/cfp/server";

// Conditional "question rules": triggers on library fields AND built-in
// dropdowns, both directions, and required-ness applies only while visible.

const formatField: WizardField = {
	key: "b_format",
	builtinRef: "format",
	label: "Format",
	type: "dropdown",
	required: true,
	locked: false,
	options: [
		{ value: "fmt1", label: "Featured Keynote" },
		{ value: "fmt2", label: "Workshop" },
	],
	rule: null,
};

const dependentOnBuiltin: WizardField = {
	key: "f_room_needs",
	fieldId: "room_needs",
	label: "Workshop room needs",
	type: "text",
	required: true,
	locked: false,
	rule: {
		trigger: { kind: "builtin", ref: "format" },
		operator: "equals",
		value: "Workshop",
	},
};

const attendeeCount: WizardField = {
	key: "f_count",
	fieldId: "count",
	label: "Expected attendees",
	type: "number",
	required: false,
	locked: false,
	rule: null,
};

const overflowPlan: WizardField = {
	key: "f_overflow",
	fieldId: "overflow",
	label: "Overflow plan",
	type: "text",
	required: true,
	locked: false,
	rule: {
		trigger: { kind: "field", fieldId: "count" },
		operator: "gt",
		value: "100",
	},
};

const fields = [formatField, dependentOnBuiltin, attendeeCount, overflowPlan];

describe("question rules", () => {
	it("fires on a built-in dropdown by value OR label, both directions", () => {
		// Rule value authored against the option LABEL, form stores the id.
		expect(
			isFieldVisible(dependentOnBuiltin, { b_format: "fmt2" }, fields),
		).toBe(true);
		expect(
			isFieldVisible(dependentOnBuiltin, { b_format: "fmt1" }, fields),
		).toBe(false);
		// Cleared again — the field hides back.
		expect(isFieldVisible(dependentOnBuiltin, { b_format: "" }, fields)).toBe(
			false,
		);
	});

	it("supports numeric gt/lt triggers", () => {
		expect(isFieldVisible(overflowPlan, { f_count: "150" }, fields)).toBe(true);
		expect(isFieldVisible(overflowPlan, { f_count: "50" }, fields)).toBe(false);
		expect(isFieldVisible(overflowPlan, { f_count: "" }, fields)).toBe(false);
	});

	it("requires a rule-hidden field only while visible", () => {
		const hidden = validateSection(fields, {
			b_format: "fmt1",
			f_count: "10",
		});
		expect(hidden.f_room_needs).toBeUndefined();
		expect(hidden.f_overflow).toBeUndefined();

		const shown = validateSection(fields, {
			b_format: "fmt2",
			f_count: "150",
		});
		expect(shown.f_room_needs).toBeTruthy();
		expect(shown.f_overflow).toBeTruthy();
	});
});

describe("section validation", () => {
	it("blocks a missing required dropdown and rejects a phantom option", () => {
		expect(validateSection([formatField], {}).b_format).toBeTruthy();
		expect(
			validateSection([formatField], { b_format: "not-an-option" }).b_format,
		).toBeTruthy();
		expect(
			validateSection([formatField], { b_format: "fmt1" }).b_format,
		).toBeUndefined();
	});

	it("enforces max length on text fields", () => {
		const title: WizardField = {
			key: "b_title",
			builtinRef: "title",
			label: "Title",
			type: "text",
			required: true,
			locked: true,
			maxLength: 255,
			rule: null,
		};
		expect(
			validateSection([title], { b_title: "x".repeat(256) }).b_title,
		).toBeTruthy();
		expect(
			validateSection([title], { b_title: "x".repeat(255) }).b_title,
		).toBeUndefined();
	});
});

describe("participant validation", () => {
	const base = {
		firstName: "Dana",
		lastName: "Okafor",
		mobilePhone: "",
		bio: "",
	};

	it("blocks below the role minimum and above the maximum", () => {
		const one = validateParticipants(
			[{ ...base, key: "a", role: "speaker", email: "a@x.co" }],
			{ speaker: { min: 2, max: 4 } },
		);
		expect(one.form.join(" ")).toContain("At least 2");

		const five = validateParticipants(
			["a", "b", "c", "d", "e"].map((k) => ({
				...base,
				key: k,
				role: "speaker" as const,
				email: `${k}@x.co`,
			})),
			{ speaker: { min: 2, max: 4 } },
		);
		expect(five.form.join(" ")).toContain("No more than 4");
	});

	it("secondary contacts never count against speaker limits", () => {
		const result = validateParticipants(
			[
				{ ...base, key: "a", role: "speaker", email: "a@x.co" },
				{ ...base, key: "b", role: "speaker", email: "b@x.co" },
				{ ...base, key: "s", role: "secondary", email: "s@x.co" },
			],
			{ speaker: { min: 2, max: 2 } },
		);
		expect(result.form).toHaveLength(0);
	});

	it("flags invalid and duplicate emails per row", () => {
		const result = validateParticipants(
			[
				{ ...base, key: "a", role: "speaker", email: "dana@" },
				{ ...base, key: "b", role: "speaker", email: "same@x.co" },
				{ ...base, key: "c", role: "speaker", email: "Same@x.co" },
			],
			{ speaker: { min: 1, max: null } },
		);
		expect(result.rows.a?.email).toBe("Enter a valid email address.");
		expect(result.rows.c?.email).toContain("already listed");
	});
});

describe("sanitizeHtml", () => {
	it("keeps formatting, drops scripts and event handlers", async () => {
		const dirty =
			'<p onclick="steal()">Hello <strong>bold</strong></p><script>alert(1)</script><a href="javascript:evil()">x</a><a href="https://ok.example">ok</a>';
		const clean = await sanitizeHtml(dirty);
		expect(clean).toContain("<strong>bold</strong>");
		expect(clean).not.toContain("script");
		expect(clean).not.toContain("onclick");
		expect(clean).not.toContain("javascript:");
		expect(clean).toContain('href="https://ok.example"');
	});
});
