import assert from "node:assert/strict";
import { test } from "node:test";
import { collate } from "./findings.mjs";
import {
	parseLedger,
	renderIssueBody,
	renderReport,
	renderRunComment,
} from "./report.mjs";

const finding = {
	journey: "organizer-first-run",
	kind: "momentum",
	severity: "blocker",
	title: "Onboarding demands six fields before anything happens",
	url: "/onboarding",
	evidence: ["shot-03"],
	expected: "a way to start naming my conference",
	actual: "six required fields, none of them decided yet",
	cost: "she leaves and renews the tool she already pays for",
	abandonment: 8,
};

const completeRun = [
	{
		journey: "organizer-first-run",
		title: "Organizer, first run",
		status: "complete",
		outcome: "abandoned",
		narrative: "I opened it, hit a wall of fields, and closed the tab.",
		toll: [
			{
				item: "a permanent web address for the event",
				kind: "committed",
				where: "/onboarding",
				consequence: "the url is wrong forever and she has to ask support",
			},
		],
		findings: [finding],
		turns: 12,
		shots: [{ id: "shot-03", file: "shot-03-onboarding.jpg" }],
	},
];

const brokenRun = [
	completeRun[0],
	{
		journey: "speaker-submission",
		title: "Speaker, cold submission",
		status: "incomplete",
		reason: "could not start: cfpUrl was never produced by an earlier journey",
		findings: [],
		toll: [],
	},
];

const args = {
	runId: "20260811-abc123",
	origin: "https://openrostrum.com",
	startedAt: "2026-08-11T10:00:00.000Z",
	identities: [{ email: "journey-critic+x@journey-critic.invalid" }],
	ownedSlugs: new Set(["northbound-2026"]),
	blocked: [],
	engine: {
		model: { id: "claude-sonnet-5" },
		endpoint: "https://api.anthropic.com",
		visionVouched: true,
	},
};

test("a complete run with no findings may say so; an incomplete one may not", () => {
	const clean = renderReport({
		...args,
		results: [{ ...completeRun[0], findings: [] }],
		findings: [],
	});
	assert.match(clean, /none of them cost the person anything/);
	assert.doesNotMatch(clean, /did not cover the product/);

	const partial = renderReport({ ...args, results: brokenRun, findings: [] });
	assert.match(partial, /did not cover the product/);
	assert.match(partial, /not evidence of absence/);
	assert.doesNotMatch(partial, /none of them cost the person anything/);
});

test("a journey the harness cut short is not allowed to read as a full walk", () => {
	const cutShort = [
		{ ...completeRun[0], truncated: "turn budget exhausted", findings: [] },
	];
	const report = renderReport({ ...args, results: cutShort, findings: [] });
	assert.match(report, /stopped by the harness, not by the person/);
	assert.match(report, /cut short.*turn budget exhausted/);
	assert.doesNotMatch(report, /none of them cost the person anything/);

	const comment = renderRunComment({
		...args,
		results: cutShort,
		reconciliation: {
			fresh: [],
			recurring: [],
			resolved: [],
			deferredResolution: true,
		},
	});
	assert.match(comment, /incomplete coverage/);
});

test("a run where nobody got anywhere says so instead of leaving a blank section", () => {
	const report = renderReport({
		...args,
		results: [brokenRun[1]],
		findings: [],
	});
	assert.match(report, /every journey stopped short/);
	assert.doesNotMatch(report, /in their words\n\n\n/);
});

test("the report names who judged it, and admits when its eyesight was unverified", () => {
	const vouched = renderReport({ ...args, results: completeRun, findings: [] });
	assert.match(vouched, /Judged by: `claude-sonnet-5`/);
	assert.doesNotMatch(vouched, /off-catalog/);

	const gateway = renderReport({
		...args,
		results: completeRun,
		findings: [],
		engine: {
			model: { id: "gpt-5.6-sol" },
			endpoint: "http://127.0.0.1:8317",
			visionVouched: false,
		},
	});
	assert.match(gateway, /`gpt-5\.6-sol` via http:\/\/127\.0\.0\.1:8317/);
	assert.match(gateway, /nothing here verified it can actually see/);
});

test("a finding renders with its evidence, its cost and where it happened", () => {
	const report = renderReport({
		...args,
		results: completeRun,
		findings: collate([finding]),
	});
	assert.match(report, /shots\/organizer-first-run\/shot-03-onboarding\.jpg/);
	assert.match(report, /https:\/\/openrostrum\.com\/onboarding/);
	assert.match(report, /renews the tool she already pays for/);
	assert.match(report, /abandonment risk 8\/10/);
});

test("the toll survives into the report even when it became no finding", () => {
	const report = renderReport({
		...args,
		results: completeRun,
		findings: collate([finding]),
	});
	assert.match(report, /committed.*permanent web address/);
});

test("the issue body round-trips through the ledger it writes", () => {
	const findings = collate([finding]);
	const body = renderIssueBody({
		...args,
		results: completeRun,
		findings,
		ledger: [],
	});
	const ledger = parseLedger(body);
	assert.equal(ledger.length, 1);
	assert.equal(ledger[0].fingerprint, findings[0].fingerprint);
	assert.equal(ledger[0].severity, "blocker");
	assert.equal(ledger[0].journey, "organizer-first-run");
	assert.match(ledger[0].title, /Onboarding demands six fields/);
});

test("a finding carried over from a previous run shows how long it has been open", () => {
	const findings = collate([finding]);
	const body = renderIssueBody({
		...args,
		results: completeRun,
		findings,
		ledger: [
			{
				fingerprint: findings[0].fingerprint,
				severity: "blocker",
				journey: "organizer-first-run",
				firstSeen: "2026-07-04",
				title: "old",
			},
		],
	});
	assert.match(body, /open since 2026-07-04/);
});

test("the run comment refuses to call anything fixed after partial coverage", () => {
	const comment = renderRunComment({
		...args,
		results: brokenRun,
		reconciliation: {
			fresh: [finding],
			recurring: [],
			resolved: [],
			deferredResolution: true,
		},
	});
	assert.match(comment, /incomplete coverage/);
	assert.match(comment, /Resolution deferred/);
});
