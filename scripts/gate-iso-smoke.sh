#!/bin/bash
# Isolation acceptance: >=3 worktree instances run the demo path at once with
# zero cross-talk; reset on one doesn't touch another.
set -uo pipefail
REPO=/Users/thytu/Prog/kill-my-saas
WT=$REPO/.claude/worktrees
PIDS=()

cleanup() {
  for p in "${PIDS[@]:-}"; do kill "$p" 2>/dev/null; done
  sleep 1
  for n in smoke-a smoke-b smoke-c; do
    git -C "$REPO" worktree remove --force "$WT/$n" 2>/dev/null
  done
}
trap cleanup EXIT

port_of() { grep -o 'localhost:[0-9]*' "$WT/$1/dev-$1.log" | head -1 | cut -d: -f2; }
d1() { (cd "$WT/$1" && npx wrangler d1 execute openrostrum --local --command "$2" --json 2>/dev/null | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['results'][0]['n'])"); }

echo "== create 3 worktrees"
for n in smoke-a smoke-b smoke-c; do
  git -C "$REPO" worktree add --detach "$WT/$n" origin/main >/dev/null 2>&1 || exit 1
done

echo "== install + seed each (isolated .wrangler/state)"
for n in smoke-a smoke-b smoke-c; do
  (cd "$WT/$n" && pnpm install --prefer-offline >/dev/null 2>&1 && pnpm db:reset >/dev/null 2>&1) || { echo "setup failed: $n"; exit 1; }
done

echo "== start 3 dev servers concurrently"
for n in smoke-a smoke-b smoke-c; do
  (cd "$WT/$n" && bash scripts/worktree-dev.sh > "dev-$n.log" 2>&1) &
  PIDS+=($!)
done
sleep 25
for n in smoke-a smoke-b smoke-c; do
  echo "$n → port $(port_of "$n")"
done

echo "== demo path on each instance (home 200 + admin login 302)"
for n in smoke-a smoke-b smoke-c; do
  p=$(port_of "$n")
  home=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$p/")
  login=$(curl -s -o /dev/null -w "%{http_code}" -d "email=admin@example.com&password=password" "http://localhost:$p/login")
  echo "$n: home=$home login=$login"
done

echo "== cross-talk: marker row in A only"
(cd "$WT/smoke-a" && npx wrangler d1 execute openrostrum --local --command "insert into email_outbox (id,\"to\",subject,html,status,created_at) values ('em_iso','iso@example.com','iso','<p>x</p>','sent',unixepoch())" >/dev/null 2>&1)
echo "marker in A=$(d1 smoke-a "select count(*) as n from email_outbox where id='em_iso'") (want 1)  leaked to B=$(d1 smoke-b "select count(*) as n from email_outbox where id='em_iso'") (want 0)"

echo "== reset B; A must keep its marker, C must keep its rows"
(cd "$WT/smoke-b" && pnpm db:reset >/dev/null 2>&1)
echo "after B reset: A marker=$(d1 smoke-a "select count(*) as n from email_outbox where id='em_iso'") (want 1)  C users=$(d1 smoke-c "select count(*) as n from users") (want 3)"

echo "== servers still healthy after reset"
for n in smoke-a smoke-b smoke-c; do
  echo "$n: $(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$(port_of "$n")/")"
done
