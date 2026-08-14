import assert from "node:assert/strict";
import { test } from "node:test";
import { PRODUCTION, previewNames } from "../../scripts/preview/names.mjs";
import { previewCommands } from "../../scripts/preview/commands.mjs";

test("preview wrangler argv never names production worker, D1, or R2", () => {
	const cmds = Object.values(previewCommands(previewNames(8)));
	const tokens = cmds.flat();
	assert.equal(tokens.includes(PRODUCTION.worker), false);
	assert.equal(tokens.includes(PRODUCTION.database), false);
	assert.equal(tokens.includes(PRODUCTION.bucket), false);
	assert.ok(tokens.includes("openrostrum-pr-8"));
	assert.ok(tokens.includes("openrostrum-pr-8-files"));
});
