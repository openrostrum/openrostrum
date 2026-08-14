import { PRODUCTION, assertPreviewIsolation, previewNames } from "./names.mjs";

const STRIP_VARS = [
	"APP_ORIGIN",
	"RESEND_API_KEY",
	"UNSUBSCRIBE_SECRET",
	"AIRTABLE_API_KEY",
	"AIRTABLE_BASE_ID",
	"DEEPSEEK_API_KEY",
];

const FORBIDDEN_KEYS = [
	"kv_namespaces",
	"queues",
	"services",
	"durable_objects",
	"workflows",
	"hyperdrive",
	"dispatch_namespaces",
	"mtls_certificates",
	"pipelines",
	"secrets_store_secrets",
	"analytics_engine_datasets",
	"vectorize",
	"send_email",
	"vpc_services",
	"vpc_networks",
	"ratelimits",
];

function hasBoundResource(value) {
	if (value == null) return false;
	if (Array.isArray(value)) return value.some(hasBoundResource);
	if (typeof value !== "object") return Boolean(value);
	const named = [
		"queue",
		"name",
		"class_name",
		"service",
		"namespace_id",
		"id",
	];
	if (named.some((key) => Boolean(value[key]))) return true;
	return Object.values(value).some(hasBoundResource);
}

export function applyPreviewConfig(input, { pr, databaseId }) {
	if (!databaseId) {
		throw new Error("preview config needs a D1 database id");
	}
	const names = previewNames(pr);
	assertPreviewIsolation(names);

	const forbidden = FORBIDDEN_KEYS.filter((key) =>
		hasBoundResource(input[key]),
	);
	if (forbidden.length) {
		throw new Error(
			`preview refuses wrangler keys that could bind production resources: ${forbidden.join(", ")}`,
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
