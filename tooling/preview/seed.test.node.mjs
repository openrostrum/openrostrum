import assert from "node:assert/strict";
import { test } from "node:test";
import {
	assertRemoteSeedTarget,
	parseSeedBlobArgs,
} from "../../scripts/seed-demo-blobs.mjs";
import { parseD1List } from "../../scripts/preview/run.mjs";
import { missingPreviewSecrets } from "../../scripts/preview/run.mjs";

test("blob seed accepts --remote and an explicit wrangler config", () => {
	assert.deepEqual(parseSeedBlobArgs([]), {
		remote: false,
		configPath: undefined,
	});
	assert.deepEqual(parseSeedBlobArgs(["--remote"]), {
		remote: true,
		configPath: undefined,
	});
	assert.deepEqual(
		parseSeedBlobArgs(["--remote", "--config=.wrangler.preview.json"]),
		{
			remote: true,
			configPath: ".wrangler.preview.json",
		},
	);
	assert.throws(() => parseSeedBlobArgs(["--oops"]), /Usage/);
});

test("a preview job cannot seed the production R2 bucket", () => {
	assert.throws(
		() => assertRemoteSeedTarget("openrostrum-files", "12"),
		/production R2/,
	);
	assert.doesNotThrow(() =>
		assertRemoteSeedTarget("openrostrum-pr-12-files", "12"),
	);
	assert.doesNotThrow(() =>
		assertRemoteSeedTarget("openrostrum-files", undefined),
	);
});

test("d1 list parser accepts wrangler --json array and API-shaped objects", () => {
	assert.equal(
		parseD1List(
			[
				{
					name: "openrostrum-pr-3",
					uuid: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
				},
			],
			"openrostrum-pr-3",
		),
		"aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
	);
	assert.equal(
		parseD1List(
			{
				result: [
					{
						name: "openrostrum-pr-3",
						id: "bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee",
					},
				],
			},
			"openrostrum-pr-3",
		),
		"bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee",
	);
	assert.equal(parseD1List([], "openrostrum-pr-3"), null);
});

test("preview skips only when Cloudflare token or account is missing", () => {
	assert.deepEqual(
		missingPreviewSecrets({
			CLOUDFLARE_API_TOKEN: "",
			CLOUDFLARE_ACCOUNT_ID: "acct",
		}),
		["CLOUDFLARE_API_TOKEN"],
	);
	assert.deepEqual(
		missingPreviewSecrets({
			CLOUDFLARE_API_TOKEN: "tok",
			CLOUDFLARE_ACCOUNT_ID: "acct",
		}),
		[],
	);
});
