import { describe, expect, it } from "vitest";
import { SUBMISSION_STATUS } from "../app/db/constants";
import { TASK_STATUS } from "../app/db/schema";
import {
	applyDescriptivePull,
	normalizeRemoteDate,
	parseSubmissionStatus,
	parseTaskStatus,
	statusLabel,
} from "../app/lib/airtable-map";
import type { AirtableFieldValue } from "../app/ports/airtable";
import { recordKey } from "../app/ports/airtable";

// Pins the inbound half of docs/airtable-sync-design.md Decision 2: what an
// Airtable cell must be for the D1 column behind it to take it. A cell holds
// text, a number, a checkbox, or nothing, and the team can retype a column at
// any time — so every shape below is reachable in production.

const CELLS: readonly AirtableFieldValue[] = [
	null,
	"",
	"  ",
	"text",
	0,
	42,
	true,
	false,
];

/** Which cells a column accepts, as a set of the ones that came back ok. */
function accepted(table: "submissions" | "contacts", field: string) {
	return CELLS.filter((cell) => applyDescriptivePull(table, field, cell).ok);
}

describe("applyDescriptivePull", () => {
	it("writes text to a required column verbatim, untrimmed", () => {
		expect(applyDescriptivePull("submissions", "Title", "  Keynote  ")).toEqual(
			{
				ok: true,
				set: { title: "  Keynote  " },
			},
		);
	});

	it("refuses a required column anything but non-blank text", () => {
		expect(accepted("submissions", "Title")).toEqual(["text"]);
		expect(applyDescriptivePull("submissions", "Title", 42)).toEqual({
			ok: false,
			reason: "Title must be non-empty text",
		});
	});

	it("takes any text for an optional column, blank included", () => {
		expect(accepted("contacts", "Bio")).toEqual([null, "", "  ", "text"]);
		expect(applyDescriptivePull("contacts", "Bio", true)).toEqual({
			ok: false,
			reason: "Bio must be text",
		});
	});

	it("substitutes nullAs for a cleared optional column, null without one", () => {
		expect(applyDescriptivePull("submissions", "Description", null)).toEqual({
			ok: true,
			set: { description: "" },
		});
		expect(applyDescriptivePull("contacts", "Bio", null)).toEqual({
			ok: true,
			set: { bio: null },
		});
	});

	it("parses a date column to a Date and clears it to null", () => {
		expect(
			applyDescriptivePull(
				"task_assignments",
				"Due At",
				"2026-10-13T17:00:00Z",
			),
		).toEqual({ ok: true, set: { dueAt: new Date("2026-10-13T17:00:00Z") } });
		expect(applyDescriptivePull("task_assignments", "Due At", null)).toEqual({
			ok: true,
			set: { dueAt: null },
		});
	});

	it("refuses a date column an unreadable string or a bare number", () => {
		// A retyped column sending 1760000000 must not land as 1970 — only text
		// Date can read counts as a date here.
		for (const cell of ["not a date", 1760000000, true] as const) {
			expect(applyDescriptivePull("task_assignments", "Due At", cell)).toEqual({
				ok: false,
				reason: "Due At must be a date",
			});
		}
	});

	it("refuses a field with no inbound mapping", () => {
		// Status is workflow-class: it moves through the domain path, not a patch.
		expect(applyDescriptivePull("submissions", "Status", "Accepted")).toEqual({
			ok: false,
			reason: "No inbound mapping for submissions.Status",
		});
	});
});

describe("status labels", () => {
	it("round-trips every enum value through the label pushed to the base", () => {
		for (const status of SUBMISSION_STATUS) {
			expect(parseSubmissionStatus(statusLabel(status))).toBe(status);
		}
		for (const status of TASK_STATUS) {
			expect(parseTaskStatus(statusLabel(status))).toBe(status);
		}
	});

	it("reads what a team member would type, and nothing else", () => {
		expect(parseSubmissionStatus("  ACCEPT queue ")).toBe("accept_queue");
		expect(parseSubmissionStatus("Shortlisted")).toBeNull();
		expect(parseSubmissionStatus(42)).toBeNull();
		expect(parseTaskStatus("Pending Feedback")).toBe("pending_feedback");
		expect(parseTaskStatus(null)).toBeNull();
	});
});

describe("normalizeRemoteDate", () => {
	it("canonicalizes equivalent serializations to one string", () => {
		expect(normalizeRemoteDate("2026-10-13T17:00:00Z")).toBe(
			normalizeRemoteDate("2026-10-13T17:00:00.000Z"),
		);
	});

	it("keeps text it can't read, so a diff still reports the mismatch", () => {
		expect(normalizeRemoteDate("next tuesday")).toBe("next tuesday");
	});

	it("reads a cell holding no date as no date", () => {
		expect(normalizeRemoteDate(null)).toBeNull();
		expect(normalizeRemoteDate("")).toBeNull();
		expect(normalizeRemoteDate(42)).toBeNull();
	});
});

describe("recordKey", () => {
	it("is null unless the merge cell holds text", () => {
		expect(recordKey({ fields: { "Record ID": "sub_1" } })).toBe("sub_1");
		expect(recordKey({ fields: { "Record ID": "" } })).toBeNull();
		expect(recordKey({ fields: { "Record ID": 7 } })).toBeNull();
		expect(recordKey({ fields: {} })).toBeNull();
	});
});
