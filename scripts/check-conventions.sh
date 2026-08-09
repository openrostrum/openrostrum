#!/usr/bin/env bash
# Fail the build on banned patterns that the type-checker can NOT catch.
# Rationale for each rule lives in docs/tech-stack.md; this script enforces them.
set -uo pipefail
cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
fail=0

report() { echo "❌ $1"; echo "$2" | sed 's/^/   /'; fail=1; }

# 1. React Router imports must come from 'react-router' only. v7 still ships
#    react-router-dom as a compat shim, so wrong imports compile clean.
hits=$(grep -rnE "from ['\"](react-router-dom|@remix-run/)" app workers test 2>/dev/null || true)
[ -n "$hits" ] && report "Import from 'react-router' only (no react-router-dom / @remix-run/*)." "$hits"

# 2. D1 has no interactive transactions — use db.batch().
hits=$(grep -rnE "\.transaction\(" app workers 2>/dev/null || true)
[ -n "$hits" ] && report "D1 has no interactive transactions — use db.batch(), not .transaction()." "$hits"

# 3. Routes must not import Node built-ins (Workers runtime). node: belongs in
#    app/ports/** or app/adapters/** behind an interface.
hits=$(grep -rnE "from ['\"]node:" app/routes 2>/dev/null || true)
[ -n "$hits" ] && report "No 'node:' imports in app/routes — put platform code behind a port." "$hits"

if [ "$fail" -eq 0 ]; then echo "✅ conventions OK"; fi
exit "$fail"
