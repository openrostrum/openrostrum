#!/usr/bin/env bash
# ENFORCED shared-file protocol. These files are authored on the integration
# branch ONLY (see docs/rules/tech-stack.md). If every worktree edited them, 50 agents
# would collide: schema.ts + drizzle/migrations mint duplicate 0000_*.sql that
# corrupt _journal.json on merge; seed.sql is the verification baseline every
# reviewer resets to; package.json/pnpm-lock.yaml produce lockfile merge hell;
# wrangler.json bindings break the worker on a bad merge. This hook blocks such
# commits from feature worktrees; the integration owner overrides.
set -euo pipefail
[ "${ALLOW_SCHEMA_CHANGE:-0}" = "1" ] && exit 0

staged="$(git diff --cached --name-only)"
if printf '%s\n' "$staged" | grep -Eq \
	'^(app/db/schema\.ts|drizzle/seed\.sql|package\.json|pnpm-lock\.yaml|wrangler\.json)$|^drizzle/migrations/|^app/ui/|^app/app\.css$'; then
	echo "✋ You are editing an integration-owned shared file."
	echo "   schema.ts · drizzle/migrations · seed.sql · package.json · pnpm-lock.yaml · wrangler.json · app/ui · app.css"
	echo "   Feature worktrees must not touch these (avoids merge + migration + lockfile collisions,"
	echo "   and keeps UI primitives/tokens single-sourced — no parallel-invented components)."
	echo "   Need a column, dep, binding, or UI primitive? Request it from the integration owner."
	echo "   Integration owner: re-run as  ALLOW_SCHEMA_CHANGE=1 git commit ..."
	exit 1
fi
