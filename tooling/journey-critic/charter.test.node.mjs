import assert from "node:assert/strict";
import { test } from "node:test";
import { Value } from "typebox/value";
import { CHARTER, loadCharter, terminalSchema } from "./charter.mjs";

const finding = {
	title: "Onboarding demands six fields before anything happens",
	kind: "momentum",
	severity: "blocker",
	url: "/onboarding",
	evidence: ["shot-03"],
	expected:
		"somewhere to start naming the conference and come back to the rest",
	actual: "six required fields, three of which are decisions she has not made",
	cost: "she closes the tab and renews the tool she already pays for",
	abandonment: 8,
};

const report = {
	status: "complete",
	outcome: "abandoned",
	narrative:
		"I signed up, landed on a form demanding dates I have not agreed with my venue, and stopped there because none of it could wait.",
	toll: [
		{
			item: "a permanent web address for the event",
			kind: "committed",
			where: "/onboarding",
			consequence: "the URL is wrong forever and she has to ask support",
		},
	],
	findings: [finding],
	handoff: { cfpUrl: null, eventSlug: null },
};

const check = (value, produces = ["cfpUrl", "eventSlug"]) =>
	Value.Check(terminalSchema(produces), value);

test("a complete, evidenced report is accepted", () => {
	assert.ok(check(report));
});

test("a finding with no screenshot behind it is rejected", () => {
	assert.ok(!check({ ...report, findings: [{ ...finding, evidence: [] }] }));
});

test("a finding that does not say what it costs the person is rejected", () => {
	assert.ok(!check({ ...report, findings: [{ ...finding, cost: "bad" }] }));
	assert.ok(
		!check({ ...report, findings: [{ ...finding, expected: "nope" }] }),
	);
	assert.ok(!check({ ...report, findings: [{ ...finding, actual: "nope" }] }));
});

test("a finding must place itself on the abandonment scale, in range", () => {
	assert.ok(!check({ ...report, findings: [{ ...finding, abandonment: 11 }] }));
	assert.ok(
		!check({ ...report, findings: [{ ...finding, abandonment: "high" }] }),
	);
});

test("invented severities and kinds are rejected", () => {
	assert.ok(
		!check({ ...report, findings: [{ ...finding, severity: "critical" }] }),
	);
	assert.ok(
		!check({ ...report, findings: [{ ...finding, kind: "performance" }] }),
	);
});

test("an abandoned journey still has to answer the handoff, with null", () => {
	const { handoff: _dropped, ...withoutHandoff } = report;
	assert.ok(!check(withoutHandoff));
	assert.ok(!check({ ...report, handoff: { cfpUrl: null } }));
	assert.ok(
		check({
			...report,
			handoff: { cfpUrl: "https://x/submit/y", eventSlug: "y" },
		}),
	);
});

test("the toll is required, and each entry says what being wrong would cost", () => {
	const { toll: _dropped, ...withoutToll } = report;
	assert.ok(!check(withoutToll));
	assert.ok(check({ ...report, toll: [] }));
	assert.ok(
		!check({ ...report, toll: [{ ...report.toll[0], consequence: "bad" }] }),
	);
	assert.ok(
		!check({ ...report, toll: [{ ...report.toll[0], kind: "assumed" }] }),
	);
});

test("a one-line narrative does not pass for having walked a journey", () => {
	assert.ok(!check({ ...report, narrative: "It went fine." }));
});

test("an incomplete or invented status cannot masquerade as a finished journey", () => {
	assert.ok(!check({ ...report, status: "incomplete" }));
	assert.ok(!check({ ...report, outcome: "mostly-fine" }));
	assert.ok(!check({ ...report, verdict: "pass" }));
});

test("the charter states the bar and refuses to become a checklist", () => {
	assert.match(CHARTER, /There is no checklist and there will never be one/);
	assert.match(CHARTER, /invent, guess, or commit to/);
	assert.match(CHARTER, /Missing features/);
});

// The first live run reported 22 findings and every one came off a screen where
// the persona stalled. Two known defects sat in an unread screenshot of a signup
// it crossed in one turn, so the charter has to send it back to look.
test("the charter sends the critic back to the screens it crossed without stopping", () => {
	assert.match(CHARTER, /screens you (walked past|passed straight through)/i);
	assert.match(CHARTER, /belong to the person who was standing there/);
	assert.match(CHARTER, /read as something it is not/);
});

test("the house design and harness rules are loaded as grounding", async () => {
	const loaded = await loadCharter();
	assert.match(loaded, /docs\/rules\/design-system\.md/);
	assert.match(loaded, /docs\/rules\/harness\.md/);
	assert.ok(loaded.length > CHARTER.length + 2000);
});
