#!/usr/bin/env bash
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"

server_pid=""
app_url=""
stage="init"
cleanup() {
	local code=$?
	printf '{"stage":"%s","exitCode":%d}\n' "$stage" "$code" \
		>/tmp/ai-review-e2e-stage.json
	if [ -n "$server_pid" ]; then
		kill "$server_pid" 2>/dev/null || true
		wait "$server_pid" 2>/dev/null || true
	fi
	rm -f .dev.vars
	trap - EXIT
	exit "$code"
}
trap cleanup EXIT

start_app() {
	local log_file=$1
	pnpm dev:worktree >"$log_file" 2>&1 &
	server_pid=$!
	local url=""
	for _ in $(seq 1 120); do
		url=$(grep -Eo 'http://localhost:[0-9]+' "$log_file" | tr '\n' ' ' | cut -d' ' -f1 || true)
		if [ -n "$url" ] && curl -sS -o /dev/null "$url/login"; then
			app_url=$url
			return 0
		fi
		if ! kill -0 "$server_pid" 2>/dev/null; then
			printf 'App exited before ready\n' >&2
			grep -E 'Error|ERROR|failed|Failed' "$log_file" >&2 || true
			return 1
		fi
		sleep 1
	done
	printf 'App did not become ready\n' >&2
	return 1
}

stop_app() {
	kill "$server_pid" 2>/dev/null || true
	wait "$server_pid" 2>/dev/null || true
	server_pid=""
}

run_case() {
	local provider=$1
	local expected_model=$2
	local log_file="/tmp/ai-review-${provider}.log"
	if [ "$provider" = "deepseek" ]; then
		printf 'APP_ENV=development\nDEEPSEEK_API_KEY=%s\nAI_REVIEW_WORKERS_MODEL=@cf/openai/gpt-oss-120b\n' \
			"$DEEPSEEK_API_KEY" >.dev.vars
	else
		printf 'APP_ENV=development\nAI_REVIEW_WORKERS_MODEL=@cf/openai/gpt-oss-120b\n' >.dev.vars
	fi

	stage="${provider}:db-reset"
	pnpm db:reset >/tmp/ai-review-db-reset.log
	local url
	stage="${provider}:app-start"
	start_app "$log_file"
	url=$app_url
	local jar
	jar=$(mktemp)
	stage="${provider}:login"
	curl --fail-with-body -sS -c "$jar" \
		-d 'email=admin@example.com&password=password' \
		"$url/login" >/tmp/ai-review-login-response.txt
	stage="${provider}:inference-action"
	curl --fail-with-body -sS --max-time 70 -b "$jar" \
		-d 'intent=ai-run&submissionId=s_pending&knownRunStamp=0' \
		"$url/admin/evaluation?tab=ai&sub=s_pending" \
		>/tmp/ai-review-action-response.txt

	local detail_before=/tmp/ai-review-detail-before.html
	stage="${provider}:reload-detail"
	curl --fail-with-body -sS -b "$jar" \
		"$url/admin/evaluation?tab=ai&sub=s_pending" >"$detail_before"
	stage="${provider}:assert-detail"
	grep -Fq "$expected_model" "$detail_before"
	grep -Fq 'AI first-pass' "$detail_before"

	stage="${provider}:override-action"
	curl --fail-with-body -sS -b "$jar" \
		-d 'intent=ai-override&submissionId=s_pending&score=3.2' \
		"$url/admin/evaluation?tab=ai&sub=s_pending" \
		>/tmp/ai-review-override-response.txt
	local detail_after=/tmp/ai-review-detail-after.html
	stage="${provider}:reload-override"
	curl --fail-with-body -sS -b "$jar" \
		"$url/admin/evaluation?tab=ai&sub=s_pending" >"$detail_after"
	grep -Fq 'Overridden to 3.20' "$detail_after"
	grep -Fq "$expected_model" "$detail_after"

	stage="${provider}:query-persistence"
	pnpm exec wrangler d1 execute openrostrum --local --json \
		--command "SELECT score, rationale, model, override_score FROM ai_reviews WHERE submission_id = 's_pending'" \
		>"/tmp/ai-review-${provider}-query.json"
	local row
	row=$(jq -c '.[0].results[0]' "/tmp/ai-review-${provider}-query.json")
	jq -e --arg model "$expected_model" \
		'.model == $model and (.score >= 0 and .score <= 10) and (.rationale | length) >= 40 and .override_score == 3.2' \
		<<<"$row" >/dev/null
	printf '%s' "$row" >"/tmp/ai-review-${provider}-row.json"
	rm -f "$jar"
	stop_app
}

run_case deepseek deepseek-v4-flash
run_case workers @cf/openai/gpt-oss-120b

jq -n \
	--slurpfile deepseek /tmp/ai-review-deepseek-row.json \
	--slurpfile workers /tmp/ai-review-workers-row.json \
	'{deepseek: $deepseek[0], workers: $workers[0], reloadVerified: true, overrideVerified: true}' \
	>ai-review-e2e-results.json
