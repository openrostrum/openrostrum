import assert from "node:assert/strict";
import { test } from "node:test";
import { collate, fingerprint, normalizeUrl, reconcile } from "./findings.mjs";

const base = {
	journey: "organizer-first-run",
	kind: "momentum",
	severity: "major",
	url: "/onboarding",
	evidence: ["shot-03"],
	expected: "somewhere to start",
	actual: "a six field form",
	cost: "she stops",
	abandonment: 6,
};

test("run-specific ids do not change a finding's identity", () => {
	const first = fingerprint(
		{ ...base, url: "/admin/events/northbound-2026-a1b2/edit" },
		["northbound-2026-a1b2"],
	);
	const second = fingerprint(
		{ ...base, url: "/admin/events/northbound-2026-z9y8/edit" },
		["northbound-2026-z9y8"],
	);
	assert.equal(first, second);
});

test("normalizing collapses uuids, numeric ids and run tokens", () => {
	assert.equal(
		normalizeUrl("https://openrostrum.com/admin/submissions/41?tab=x"),
		"/admin/submissions/:id",
	);
	assert.equal(
		normalizeUrl(
			"/submit/northbound-2026/9f1c2b34-1111-2222-3333-444455556666",
			["northbound-2026"],
		),
		"/submit/:id/:id",
	);
});

test("the same wall hit by two personas becomes one finding at the worse severity", () => {
	const merged = collate([
		{ ...base, title: "Onboarding demands six fields before anything happens" },
		{
			...base,
			journey: "organizer-first-run",
			severity: "blocker",
			abandonment: 9,
			title:
				"Six required fields demanded by onboarding before anything happens",
		},
	]);
	assert.equal(merged.length, 1);
	assert.equal(merged[0].severity, "blocker");
	assert.equal(merged[0].abandonment, 9);
});

test("different concepts on the same page stay separate", () => {
	const merged = collate([
		{ ...base, title: "Onboarding demands six fields before anything happens" },
		{
			...base,
			kind: "clarity",
			title: "Timezone field never explains which timezone",
		},
	]);
	assert.equal(merged.length, 2);
});

test("findings sort by severity then by how close they came to abandonment", () => {
	const merged = collate([
		{
			...base,
			severity: "minor",
			abandonment: 1,
			title: "Footer mentions the licence",
		},
		{
			...base,
			kind: "visual",
			severity: "blocker",
			abandonment: 8,
			title: "Bar under the button reads as progress",
		},
		{
			...base,
			kind: "trust",
			severity: "major",
			abandonment: 4,
			title: "Admin lands with nothing to do",
		},
	]);
	assert.deepEqual(
		merged.map((finding) => finding.severity),
		["blocker", "major", "minor"],
	);
});

test("an incomplete run may not declare anything fixed", () => {
	const previous = [
		{ fingerprint: "aaaaaaaaaaaaaaaa", title: "old", severity: "major" },
	];
	const current = collate([
		{ ...base, title: "A brand new wall appeared today" },
	]);

	const clean = reconcile({ current, previous, complete: true });
	assert.equal(clean.fresh.length, 1);
	assert.equal(clean.resolved.length, 1);
	assert.equal(clean.deferredResolution, false);

	const partial = reconcile({ current, previous, complete: false });
	assert.equal(partial.resolved.length, 0);
	assert.equal(partial.deferredResolution, true);
});

test("a finding that persists across runs is recurring, not new", () => {
	const current = collate([
		{ ...base, title: "Onboarding demands six fields up front" },
	]);
	const previous = [
		{ fingerprint: current[0].fingerprint, title: "x", severity: "major" },
	];
	const result = reconcile({ current, previous, complete: true });
	assert.equal(result.fresh.length, 0);
	assert.equal(result.recurring.length, 1);
});
