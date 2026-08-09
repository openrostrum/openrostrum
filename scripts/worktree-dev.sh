#!/usr/bin/env bash
# Run the dev server on a stable port derived from THIS worktree, so multiple
# git worktrees run concurrently without collisions. Storage (.wrangler/state)
# is already per-worktree (cwd-relative), and we use no service bindings, so a
# unique port is all that's needed. See docs/tech-stack.md.
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
OFFSET=$(( $(printf '%s' "$ROOT" | cksum | cut -d' ' -f1) % 400 ))
PORT=$(( 5200 + OFFSET ))
echo "▶ worktree : $ROOT"
echo "▶ dev URL  : http://localhost:$PORT/"
exec pnpm exec react-router dev --port "$PORT"
