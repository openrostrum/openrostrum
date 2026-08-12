import assert from "node:assert/strict";
import { test } from "node:test";
import {
	accountsUsed,
	JOURNEYS,
	missingNeeds,
	planWaves,
} from "./journeys.mjs";

const identity = {
	email: "journey-critic+run-organizer@journey-critic.invalid",
	password: "Northbound-run",
	name: "Priya Raman",
};
const reviewer = {
	...identity,
	email: "journey-critic+run-reviewer@journey-critic.invalid",
};

test("every journey states a goal and a reason to quit, and prescribes no click path", () => {
	for (const journey of JOURNEYS) {
		const brief = journey.brief({ identity, reviewer, handoff: {} });
		assert.match(brief, /\*\*Your goal:\*\*/, journey.id);
		assert.match(brief, /you might quit|worth noting/, journey.id);
		assert.doesNotMatch(brief, /\bclick the\b|\bstep 1\b/i, journey.id);
	}
});

test("a journey that needs an account is told which account, and no other", () => {
	const priya = JOURNEYS.find(
		(journey) => journey.id === "organizer-first-run",
	);
	const brief = priya.brief({ identity, reviewer, handoff: {} });
	assert.ok(brief.includes(identity.email));
	assert.ok(brief.includes(identity.password));
	assert.match(
		brief,
		/do not touch anything that belongs to another organization/,
	);
});

test("waves run a journey only after everything it depends on", () => {
	const waves = planWaves();
	const position = new Map();
	waves.forEach((wave, index) => {
		for (const journey of wave) position.set(journey.id, index);
	});
	for (const journey of JOURNEYS)
		for (const dep of journey.deps ?? [])
			assert.ok(
				position.get(dep) < position.get(journey.id),
				`${journey.id} ran at or before its dependency ${dep}`,
			);
});

test("journeys with no dependencies start together in the first wave", () => {
	const [first] = planWaves();
	assert.deepEqual(first.map((journey) => journey.id).sort(), [
		"attendee-program",
		"organizer-first-run",
	]);
});

test("running one journey alone is allowed; its unmet handoff reports itself", () => {
	const speaker = JOURNEYS.find(
		(journey) => journey.id === "speaker-submission",
	);
	assert.deepEqual(planWaves([speaker]), [[speaker]]);
	assert.deepEqual(missingNeeds(speaker, {}), ["cfpUrl"]);
	assert.deepEqual(missingNeeds(speaker, { cfpUrl: "https://x/submit/y" }), []);
});

test("a dependency cycle is fatal rather than silently reordered", () => {
	assert.throws(
		() =>
			planWaves([
				{ id: "a", deps: ["b"] },
				{ id: "b", deps: ["a"] },
			]),
		/unsatisfiable/,
	);
});

test("the browse-only journey is told not to write, and produces nothing", () => {
	const attendee = JOURNEYS.find(
		(journey) => journey.id === "attendee-program",
	);
	assert.equal(attendee.readOnly, true);
	assert.deepEqual(attendee.produces, []);
	assert.match(
		attendee.brief({ identity, reviewer, handoff: {} }),
		/do not sign up, do not sign in/i,
	);
});

test("only the accounts a selection can actually touch are named", () => {
	const byId = (id) => JOURNEYS.find((journey) => journey.id === id);
	assert.deepEqual(accountsUsed([byId("attendee-program")]), []);
	assert.deepEqual(accountsUsed([byId("speaker-submission")]), []);
	assert.deepEqual(accountsUsed([byId("organizer-first-run")]), ["organizer"]);
	// The week-two organizer invites Lena by email, so her address is in play even
	// though she never signs in during that journey.
	assert.deepEqual(accountsUsed([byId("organizer-week-two")]).sort(), [
		"organizer",
		"reviewer",
	]);
	assert.deepEqual(accountsUsed(JOURNEYS).sort(), ["organizer", "reviewer"]);
});

test("both viewports are exercised across the journey set", () => {
	const viewports = new Set(JOURNEYS.map((journey) => journey.viewport));
	assert.deepEqual([...viewports].sort(), ["desktop", "mobile"]);
});
