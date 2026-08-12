import { describe, expect, it } from "vitest";
import { normalizeRemoteDate, type TableMap } from "../app/lib/airtable-map";
import { diffFields, planTableSync } from "../app/sync/engine";
import { MERGE_FIELD } from "../app/ports/airtable";

// Contracts from docs/airtable-sync-design.md Decisions 2 + 3: per field and
// against the last-synced snapshot — only-local-changed pushes, only-remote-
// changed pulls, both-changed follows the field class (Airtable wins on
// team-editable, the app wins on app-owned). A synthetic map keeps these
// pinned to the ENGINE, not to any real table's field list.

const MAP: TableMap = {
	table: "submissions",
	airtableTable: "T",
	fields: {
		Owned: { class: "app-owned" },
		Desc: { class: "descriptive" },
		Flow: { class: "workflow" },
		// The shipped normalizer, not a copy — the engine's contract is that it
		// applies whatever a field declares, and a copy here could drift from it.
		When: { class: "descriptive", normalizeRemote: normalizeRemoteDate },
	},
};

const BASE = { Owned: "o1", Desc: "d1", Flow: "f1", When: null };

function linked(
	local: Partial<typeof BASE>,
	remote: Partial<typeof BASE>,
	snapshot: Record<string, unknown> | null = BASE,
) {
	return planTableSync(
		MAP,
		[{ recordId: "r1", fields: { ...BASE, ...local } }],
		[{ recordId: "r1", airtableId: "at1", snapshot: snapshot as never }],
		[
			{
				airtableId: "at1",
				fields: { [MERGE_FIELD]: "r1", ...BASE, ...remote },
			},
		],
	);
}

describe("airtable sync engine — three-way reconciliation", () => {
	it("produces no ops when local, remote, and snapshot agree", () => {
		const plan = linked({}, {});
		expect(plan.pushes).toEqual([]);
		expect(plan.pulls).toEqual([]);
		expect(plan.creates).toEqual([]);
		expect(plan.archives).toEqual([]);
		expect(plan.snapshotRefreshes).toEqual([]);
	});

	it("flags a record for push only when the app changed it since the snapshot", () => {
		const plan = linked({ Desc: "edited locally" }, {});
		expect(plan.pushes).toEqual([{ recordId: "r1", airtableId: "at1" }]);
		expect(plan.pulls).toEqual([]);
	});

	it("pulls a remote-only edit of a descriptive field without flagging a conflict", () => {
		const plan = linked({}, { Desc: "edited in airtable" });
		expect(plan.pulls).toEqual([
			{
				recordId: "r1",
				airtableId: "at1",
				changes: [
					{
						field: "Desc",
						fieldClass: "descriptive",
						value: "edited in airtable",
						conflict: false,
					},
				],
			},
		]);
		expect(plan.pushes).toEqual([]);
	});

	it("lets Airtable win when both sides edited a team-editable field", () => {
		const plan = linked({ Desc: "local edit" }, { Desc: "airtable edit" });
		expect(plan.pulls[0]?.changes).toEqual([
			{
				field: "Desc",
				fieldClass: "descriptive",
				value: "airtable edit",
				conflict: true,
			},
		]);
		expect(plan.pushes).toEqual([]);
	});

	it("corrects an inbound edit of an app-owned field back to the app's value", () => {
		const plan = linked({}, { Owned: "team tampered" });
		expect(plan.pushes).toEqual([{ recordId: "r1", airtableId: "at1" }]);
		expect(plan.pulls).toEqual([]);
		// The pushed content is computed exactly once, by diffFields.
		expect(diffFields(MAP, BASE, { ...BASE, Owned: "team tampered" })).toEqual({
			Owned: "o1",
		});
	});

	it("routes a remote workflow change as a pull tagged workflow", () => {
		const plan = linked({}, { Flow: "f2" });
		expect(plan.pulls[0]?.changes).toEqual([
			{ field: "Flow", fieldClass: "workflow", value: "f2", conflict: false },
		]);
	});

	it("does not read equivalent datetime serializations as an edit", () => {
		const plan = planTableSync(
			MAP,
			[
				{
					recordId: "r1",
					fields: { ...BASE, When: "2026-10-13T17:00:00.000Z" },
				},
			],
			[
				{
					recordId: "r1",
					airtableId: "at1",
					snapshot: { ...BASE, When: "2026-10-13T17:00:00.000Z" },
				},
			],
			[
				{
					airtableId: "at1",
					fields: {
						[MERGE_FIELD]: "r1",
						...BASE,
						When: "2026-10-13T17:00:00Z",
					},
				},
			],
		);
		expect(plan.pushes).toEqual([]);
		expect(plan.pulls).toEqual([]);
	});

	it("classifies lifecycle mismatches: remote-gone → archive, local-gone → remote delete, both-gone → unlink", () => {
		const plan = planTableSync(
			MAP,
			[{ recordId: "present", fields: BASE }],
			[
				{ recordId: "present", airtableId: "at1", snapshot: BASE },
				{ recordId: "localGone", airtableId: "at2", snapshot: BASE },
				{ recordId: "bothGone", airtableId: "at3", snapshot: BASE },
			],
			[
				{
					airtableId: "at2",
					fields: { [MERGE_FIELD]: "localGone", ...BASE },
				},
			],
		);
		expect(plan.archives).toEqual([{ recordId: "present", airtableId: "at1" }]);
		expect(plan.remoteDeletes).toEqual([
			{ recordId: "localGone", airtableId: "at2" },
		]);
		expect(plan.unlinks).toEqual(["bothGone"]);
		expect(plan.linkedPresent).toBe(1);
	});

	it("creates unlinked local rows, re-links rows the base already holds, and never touches the team's own rows", () => {
		const plan = planTableSync(
			MAP,
			[
				{ recordId: "new", fields: BASE },
				{ recordId: "lostLink", fields: BASE },
			],
			[],
			[
				{
					airtableId: "atX",
					fields: { [MERGE_FIELD]: "lostLink", ...BASE },
				},
				{ airtableId: "atTeam", fields: { Desc: "the team's own row" } },
			],
		);
		expect(plan.creates.map((c) => c.recordId)).toEqual(["new"]);
		expect(plan.adoptions).toEqual([
			{ recordId: "lostLink", airtableId: "atX" },
		]);
		expect(plan.orphanCount).toBe(1);
		expect(plan.remoteDeletes).toEqual([]);
	});

	it("re-links against an empty snapshot so Airtable wins where both sides hold values", () => {
		const plan = planTableSync(
			MAP,
			[{ recordId: "r1", fields: { ...BASE, Desc: "local" } }],
			[],
			[
				{
					airtableId: "atX",
					fields: {
						[MERGE_FIELD]: "r1",
						...BASE,
						Desc: "remote",
						Owned: "drifted",
					},
				},
			],
		);
		expect(plan.pulls[0]?.changes).toContainEqual({
			field: "Desc",
			fieldClass: "descriptive",
			value: "remote",
			conflict: true,
		});
		// App-owned drift still flags the record so the correction pushes back.
		expect(plan.pushes).toContainEqual({ recordId: "r1", airtableId: "atX" });
	});

	it("flags a stale-but-agreeing snapshot for refresh so a later local edit is not misread as a conflict", () => {
		const plan = linked(
			{ Desc: "settled" },
			{ Desc: "settled" },
			{ ...BASE, Desc: "stale base value" },
		);
		expect(plan.pushes).toEqual([]);
		expect(plan.pulls).toEqual([]);
		expect(plan.snapshotRefreshes).toEqual(["r1"]);
	});
});

describe("diffFields", () => {
	it("returns only mapped fields that differ, normalizing remote datetimes", () => {
		expect(
			diffFields(
				MAP,
				{ ...BASE, Desc: "changed", When: "2026-10-13T17:00:00.000Z" },
				{ ...BASE, When: "2026-10-13T17:00:00Z", Unmapped: "ignored" },
			),
		).toEqual({ Desc: "changed" });
	});
});
