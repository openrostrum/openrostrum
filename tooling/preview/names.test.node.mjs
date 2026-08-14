import assert from "node:assert/strict";
import { test } from "node:test";
import {
	PRODUCTION,
	assertPreviewIsolation,
	previewNames,
} from "../../scripts/preview/names.mjs";

test("preview names are stable per PR and never collide with production", () => {
	assert.deepEqual(previewNames(42), {
		pr: 42,
		worker: "openrostrum-pr-42",
		database: "openrostrum-pr-42",
		bucket: "openrostrum-pr-42-files",
	});
	assert.deepEqual(previewNames("42"), previewNames(42));
	assert.notEqual(previewNames(42).worker, PRODUCTION.worker);
	assert.notEqual(previewNames(42).database, PRODUCTION.database);
	assert.notEqual(previewNames(42).bucket, PRODUCTION.bucket);
});

test("preview names reject anything that is not a positive integer PR", () => {
	for (const value of [0, -1, 1.5, "0", "01", "pr-1", "", null, undefined]) {
		assert.throws(() => previewNames(value), /PR number/);
	}
});

test("isolation guard refuses production worker, D1, or R2 names", () => {
	assert.throws(
		() =>
			assertPreviewIsolation({ ...previewNames(1), worker: PRODUCTION.worker }),
		/production/,
	);
	assert.throws(
		() =>
			assertPreviewIsolation({
				...previewNames(1),
				database: PRODUCTION.database,
			}),
		/production/,
	);
	assert.throws(
		() =>
			assertPreviewIsolation({ ...previewNames(1), bucket: PRODUCTION.bucket }),
		/production/,
	);
	assert.doesNotThrow(() => assertPreviewIsolation(previewNames(7)));
});
