import { PRODUCTION, assertPreviewIsolation, previewNames } from "./names.mjs";

const STRIP_VARS = [
	"APP_ORIGIN",
	"RESEND_API_KEY",
	"UNSUBSCRIBE_SECRET",
	"AIRTABLE_API_KEY",
	"AIRTABLE_BASE_ID",
	"DEEPSEEK_API_KEY",
];

const ALLOWED_KEYS = new Set([
	"$schema",
	"name",
	"main",
	"compatibility_date",
	"compatibility_flags",
	"observability",
	"upload_source_maps",
	"workers_dev",
	"preview_urls",
	"routes",
	"d1_databases",
	"r2_buckets",
	"ai",
	"triggers",
	"vars",
]);

export function applyPreviewConfig(input, { pr, databaseId }) {
	if (!databaseId) {
		throw new Error("preview config needs a D1 database id");
	}
	const names = previewNames(pr);
	assertPreviewIsolation(names);

	const unknown = Object.keys(input).filter((key) => !ALLOWED_KEYS.has(key));
	if (unknown.length) {
		throw new Error(
			`preview refuses unknown wrangler keys that could bind production resources: ${unknown.join(", ")}`,
		);
	}

	const config = structuredClone(input);
	config.name = names.worker;
	config.workers_dev = true;
	config.preview_urls = true;
	delete config.routes;
	config.triggers = { crons: [] };

	const dbs = config.d1_databases ?? [];
	const buckets = config.r2_buckets ?? [];
	if (dbs.length !== 1 || buckets.length !== 1) {
		throw new Error(
			"preview expects exactly one D1 and one R2 binding; extra bindings would stay on production resources",
		);
	}
	const [db] = dbs;
	const [bucket] = buckets;
	db.database_name = names.database;
	db.database_id = databaseId;
	bucket.bucket_name = names.bucket;

	config.vars = { ...(config.vars ?? {}), APP_ENV: "preview" };
	for (const key of STRIP_VARS) delete config.vars[key];

	assertPreviewIsolation({
		worker: config.name,
		database: db.database_name,
		bucket: bucket.bucket_name,
	});
	return config;
}
