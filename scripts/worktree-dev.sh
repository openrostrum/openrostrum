#!/usr/bin/env bash
# Run the dev server on a stable, FREE port derived from THIS worktree, so
# multiple git worktrees run concurrently without collisions. Storage
# (.wrangler/state) is already per-worktree (cwd-relative) and we use no service
# bindings, so a unique port is all that's needed. See docs/rules/tech-stack.md.
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
OFFSET=$(( $(printf '%s' "$ROOT" | cksum | cut -d' ' -f1) % 400 ))
PORT=$(( 5200 + OFFSET ))

# cksum can hash-collide across worktree paths; probe upward for a free port so
# two worktrees never silently share one, and so the URL we print is the one the
# server actually binds.
is_free() { ! (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
tries=0
while ! is_free "$PORT"; do
	PORT=$(( PORT + 1 ))
	tries=$(( tries + 1 ))
	if [ "$tries" -ge 50 ]; then
		echo "✋ no free port near $(( 5200 + OFFSET ))" >&2
		exit 1
	fi
done

echo "▶ worktree : $ROOT"
echo "▶ dev URL  : http://localhost:$PORT/"
exec pnpm exec react-router dev --port "$PORT"
