// Inject deployer-specific values into a wrangler config from the environment,
// so the committed config holds only generic placeholders (open-source safe: a
// fork sets its own env and deploys — no account ids or domains in git). Used
// by scripts/deploy.sh (patches the built config) and by CI's deploy job
// (patches the root config so `d1 migrations apply` resolves the real database).
//
// Usage: node scripts/inject-wrangler-id.mjs <path-to-wrangler.json>
import { readFileSync, writeFileSync } from "node:fs";

const file = process.argv[2];
if (!file) {
	console.error("usage: inject-wrangler-id.mjs <wrangler.json>");
	process.exit(1);
}

const id = process.env.CF_D1_DATABASE_ID;
if (!id) {
	console.error(
		"CF_D1_DATABASE_ID is not set — run `wrangler d1 create openrostrum` and set it (in .deploy.env locally, or as a repo secret in CI).",
	);
	process.exit(1);
}

const config = JSON.parse(readFileSync(file, "utf8"));
config.d1_databases[0].database_id = id;
config.vars ||= {};
if (process.env.EMAIL_FROM) config.vars.EMAIL_FROM = process.env.EMAIL_FROM;
if (process.env.APP_ENV) config.vars.APP_ENV = process.env.APP_ENV;
writeFileSync(file, `${JSON.stringify(config, null, "\t")}\n`);
console.log(`Injected deploy config into ${file} (D1=${id}).`);
