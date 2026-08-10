#!/usr/bin/env bash
# Deploy the worker with DEPLOYER-SPECIFIC values injected at deploy time, so the
# committed wrangler.json holds only generic placeholders (open-source safe: a
# fork sets its own .deploy.env and deploys — no account ids or domains in git).
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -f .deploy.env ]; then
	set -a
	# shellcheck disable=SC1091
	source .deploy.env
	set +a
fi

: "${CF_D1_DATABASE_ID:?set CF_D1_DATABASE_ID in .deploy.env — run: wrangler d1 create openrostrum}"

pnpm build

# The RR7 build emits build/server/wrangler.json (gitignored) from the root
# config; patch the placeholder id (+ optional var overrides) into it there.
node -e '
const fs = require("fs");
const f = "build/server/wrangler.json";
const j = JSON.parse(fs.readFileSync(f, "utf8"));
j.d1_databases[0].database_id = process.env.CF_D1_DATABASE_ID;
j.vars = j.vars || {};
if (process.env.EMAIL_FROM) j.vars.EMAIL_FROM = process.env.EMAIL_FROM;
if (process.env.APP_ENV) j.vars.APP_ENV = process.env.APP_ENV;
fs.writeFileSync(f, JSON.stringify(j));
console.log("Injected deploy config: D1=" + process.env.CF_D1_DATABASE_ID);
'

pnpm exec wrangler deploy
