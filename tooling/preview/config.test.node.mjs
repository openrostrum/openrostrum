import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { applyPreviewConfig } from "../../scripts/preview/config.mjs";

const repoRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
	"..",
);

const committed = {
	name: "openrostrum",
	main: "./workers/app.ts",
	compatibility_date: "2025-10-08",
	compatibility_flags: ["nodejs_compat"],
	observability: { enabled: true },
	upload_source_maps: true,
	workers_dev: true,
	routes: [{ pattern: "openrostrum.com", custom_domain: true }],
	d1_databases: [
		{
			binding: "DB",
			database_name: "openrostrum",
			database_id: "REPLACE_WITH_YOUR_D1_ID_OR_INJECT_AT_DEPLOY",
			migrations_dir: "drizzle/migrations",
		},
	],
	r2_buckets: [{ binding: "BLOBS", bucket_name: "openrostrum-files" }],
	ai: { binding: "AI", remote: true },
	triggers: { crons: ["0 9 * * *", "0 * * * *"] },
	vars: {
		APP_ENV: "production",
		EMAIL_FROM: "OpenRostrum <onboarding@resend.dev>",
	},
};

function apply(overrides = {}) {
	return applyPreviewConfig(structuredClone(committed), {
		pr: 12,
		databaseId: "11111111-1111-4111-8111-111111111111",
		...overrides,
	});
}

test("preview config is a separate worker bound to that PR's D1 and R2", () => {
	const config = apply();
	assert.equal(config.name, "openrostrum-pr-12");
	assert.equal(config.d1_databases[0].database_name, "openrostrum-pr-12");
	assert.equal(
		config.d1_databases[0].database_id,
		"11111111-1111-4111-8111-111111111111",
	);
	assert.equal(config.r2_buckets[0].bucket_name, "openrostrum-pr-12-files");
	assert.equal(config.d1_databases[0].binding, "DB");
	assert.equal(config.r2_buckets[0].binding, "BLOBS");
	assert.equal(
		config.d1_databases[0].migrations_dir,
		path.join(repoRoot, "drizzle", "migrations"),
	);
});

test("preview config drops the production domain and cron triggers", () => {
	const config = apply();
	assert.equal(config.routes, undefined);
	assert.deepEqual(config.triggers, { crons: [] });
	assert.equal(config.workers_dev, true);
	assert.equal(config.preview_urls, true);
});

test("preview vars stay off production email and origin", () => {
	const config = apply();
	assert.equal(config.vars.APP_ENV, "preview");
	assert.equal(config.vars.EMAIL_FROM, committed.vars.EMAIL_FROM);
	assert.equal(config.vars.APP_ORIGIN, undefined);
	assert.ok(!("RESEND_API_KEY" in config.vars));
});

test("preview config never leaves production resource names in place", () => {
	const config = apply();
	assert.notEqual(config.name, committed.name);
	assert.notEqual(config.d1_databases[0].database_name, "openrostrum");
	assert.notEqual(config.r2_buckets[0].bucket_name, "openrostrum-files");
	assert.notEqual(
		config.d1_databases[0].database_id,
		committed.d1_databases[0].database_id,
	);
});

test("preview config does not mutate the input object", () => {
	const input = structuredClone(committed);
	applyPreviewConfig(input, {
		pr: 3,
		databaseId: "22222222-2222-4222-8222-222222222222",
	});
	assert.deepEqual(input, committed);
});

test("preview config refuses extra D1 or R2 bindings", () => {
	const extraDb = structuredClone(committed);
	extraDb.d1_databases.push({
		binding: "OTHER",
		database_name: "openrostrum",
		database_id: "33333333-3333-4333-8333-333333333333",
	});
	assert.throws(
		() =>
			applyPreviewConfig(extraDb, {
				pr: 12,
				databaseId: "11111111-1111-4111-8111-111111111111",
			}),
		/exactly one/,
	);
	const extraBucket = structuredClone(committed);
	extraBucket.r2_buckets.push({
		binding: "OTHER",
		bucket_name: "openrostrum-files",
	});
	assert.throws(
		() =>
			applyPreviewConfig(extraBucket, {
				pr: 12,
				databaseId: "11111111-1111-4111-8111-111111111111",
			}),
		/exactly one/,
	);
});

test("preview config refuses unknown wrangler keys that could bind production", () => {
	const queued = structuredClone(committed);
	queued.queues = { producers: [{ binding: "Q", queue: "openrostrum" }] };
	assert.throws(
		() =>
			applyPreviewConfig(queued, {
				pr: 12,
				databaseId: "11111111-1111-4111-8111-111111111111",
			}),
		/could bind production resources/,
	);
});

test("preview config ignores empty generated wrangler metadata keys", () => {
	const built = structuredClone(committed);
	built.configPath = "/tmp/wrangler.json";
	built.kv_namespaces = [];
	built.queues = { producers: [], consumers: [] };
	built.durable_objects = { bindings: [] };
	const config = applyPreviewConfig(built, {
		pr: 12,
		databaseId: "11111111-1111-4111-8111-111111111111",
	});
	assert.equal(config.name, "openrostrum-pr-12");
});
