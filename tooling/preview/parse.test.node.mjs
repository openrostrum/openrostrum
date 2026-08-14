import assert from "node:assert/strict";
import { test } from "node:test";
import {
	classifyWranglerError,
	parseCreatedDatabaseId,
	parseWorkersDevUrl,
	shouldSkipFork,
} from "../../scripts/preview/parse.mjs";

test("workers.dev URL is taken from wrangler deploy output, not a version prefix of openrostrum", () => {
	const stdout = [
		"Uploaded openrostrum-pr-4 (1.23 sec)",
		"Deployed openrostrum-pr-4 triggers (0.10 sec)",
		"  https://openrostrum-pr-4.acct.workers.dev",
		"Current Version ID: 00000000-0000-4000-8000-000000000000",
	].join("\n");
	assert.equal(
		parseWorkersDevUrl(stdout),
		"https://openrostrum-pr-4.acct.workers.dev",
	);
	assert.equal(
		parseWorkersDevUrl(
			"Version Preview URL: https://abcd-openrostrum.acct.workers.dev",
		),
		null,
	);
	assert.equal(parseWorkersDevUrl("no url here"), null);
});

test("d1 create output yields the new database uuid", () => {
	const stdout = [
		"✅ Successfully created DB 'openrostrum-pr-4' in region ENAM",
		"Created your new D1 database.",
		"",
		"[[d1_databases]]",
		'binding = "DB"',
		'database_name = "openrostrum-pr-4"',
		'database_id = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"',
	].join("\n");
	assert.equal(
		parseCreatedDatabaseId(stdout),
		"aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
	);
	assert.equal(parseCreatedDatabaseId("nothing"), null);
});

test("fork PRs are skipped; same-repo PRs are not", () => {
	assert.equal(
		shouldSkipFork({
			head: "someone/openrostrum",
			base: "swyxio/openrostrum",
		}),
		true,
	);
	assert.equal(
		shouldSkipFork({
			head: "swyxio/openrostrum",
			base: "swyxio/openrostrum",
		}),
		false,
	);
	assert.equal(shouldSkipFork({ head: "", base: "swyxio/openrostrum" }), false);
});

test("missing-permission wrangler errors stay classified as token blockers", () => {
	assert.equal(
		classifyWranglerError("Authentication error [code: 10000]"),
		"token",
	);
	assert.equal(
		classifyWranglerError(
			"Authentication error [code: 10000] — make sure the API Token is correct",
		),
		"token",
	);
	assert.equal(classifyWranglerError("ENOENT: no such file"), "other");
});
