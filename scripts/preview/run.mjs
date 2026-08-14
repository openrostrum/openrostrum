import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { previewCommentBody, selectPreviewComment } from "./comment.mjs";
import { previewCommands } from "./commands.mjs";
import { applyPreviewConfig } from "./config.mjs";
import { PRODUCTION, assertPreviewIsolation, previewNames } from "./names.mjs";
import {
	classifyWranglerError,
	parseCreatedDatabaseId,
	parseWorkersDevUrl,
	shouldSkipFork,
} from "./parse.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, "..", "..");

function env() {
	return {
		CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN ?? "",
		CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID ?? "",
		GH_TOKEN: process.env.GH_TOKEN || process.env.GITHUB_TOKEN || "",
		REPO: process.env.REPO ?? "",
		PR_NUMBER: process.env.PR_NUMBER ?? "",
		HEAD_SHA: process.env.HEAD_SHA ?? "",
		HEAD_REPO: process.env.HEAD_REPO ?? "",
	};
}

export function missingPreviewSecrets(values = env()) {
	const missing = [];
	if (!values.CLOUDFLARE_API_TOKEN) missing.push("CLOUDFLARE_API_TOKEN");
	if (!values.CLOUDFLARE_ACCOUNT_ID) missing.push("CLOUDFLARE_ACCOUNT_ID");
	return missing;
}

function wrangler(args, { config } = {}) {
	const argv = ["exec", "wrangler", ...args];
	if (config) argv.push("--config", config);
	const result = spawnSync("pnpm", argv, {
		cwd: repoRoot,
		encoding: "utf8",
		env: process.env,
	});
	const text = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
	if (result.status !== 0) {
		const kind = classifyWranglerError(text);
		const error = new Error(text.trim() || `wrangler ${args.join(" ")} failed`);
		error.kind = kind;
		if (kind === "token") {
			error.message = `Cloudflare API token lacks a required permission.\n${error.message}`;
		}
		throw error;
	}
	return text;
}

function alreadyExists(text) {
	return /already exists|A database with that name already exists|code:\s*8000005|code:\s*10014/i.test(
		text,
	);
}

function gone(text) {
	return /not found|does not exist|404|code:\s*10007/i.test(text);
}

function tryCreate(args) {
	try {
		return wrangler(args);
	} catch (error) {
		if (alreadyExists(String(error.message))) return String(error.message);
		throw error;
	}
}

export function parseD1List(raw, name) {
	const listed = typeof raw === "string" ? JSON.parse(raw) : raw;
	const rows = Array.isArray(listed)
		? listed
		: (listed.result ?? listed.databases ?? []);
	const match = rows.find((row) => row.name === name);
	return match?.uuid ?? match?.id ?? match?.database_id ?? null;
}

function findDatabaseId(names, cmds) {
	return parseD1List(wrangler(cmds.d1List), names.database);
}

function ensureDatabase(names, cmds) {
	const existing = findDatabaseId(names, cmds);
	if (existing) return existing;
	const created = tryCreate(cmds.d1Create);
	return parseCreatedDatabaseId(created) ?? findDatabaseId(names, cmds);
}

function bucketExists(names, cmds) {
	return wrangler(cmds.r2List).includes(names.bucket);
}

function writePreviewConfig(source, dest, pr, databaseId) {
	const input = JSON.parse(readFileSync(source, "utf8"));
	const config = applyPreviewConfig(input, { pr, databaseId });
	writeFileSync(dest, `${JSON.stringify(config, null, "\t")}\n`);
	return config;
}

function seedRemote(configPath) {
	const result = spawnSync(
		process.execPath,
		[
			path.join(repoRoot, "scripts", "seed-demo-blobs.mjs"),
			"--remote",
			`--config=${configPath}`,
		],
		{ cwd: repoRoot, encoding: "utf8", env: process.env },
	);
	if (result.status !== 0) {
		throw new Error(
			`${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim() ||
				"seed-demo-blobs --remote failed",
		);
	}
}

async function gh(method, pathname, body) {
	const values = env();
	const response = await fetch(`https://api.github.com${pathname}`, {
		method,
		headers: {
			authorization: `Bearer ${values.GH_TOKEN}`,
			accept: "application/vnd.github+json",
			"content-type": "application/json",
			"user-agent": "openrostrum-pr-preview",
		},
		body: body ? JSON.stringify(body) : undefined,
	});
	if (!response.ok) {
		throw new Error(
			`${method} ${pathname} → ${response.status} ${await response.text()}`,
		);
	}
	if (response.status === 204) return null;
	return response.json();
}
async function upsertComment(pr, url, sha) {
	const values = env();
	const comments = [];
	let page = 1;
	for (;;) {
		const batch = await gh(
			"GET",
			`/repos/${values.REPO}/issues/${pr}/comments?per_page=100&page=${page}`,
		);
		comments.push(...batch);
		if (batch.length < 100) break;
		page += 1;
	}
	const body = previewCommentBody({ url, pr, sha });
	const existing = selectPreviewComment(comments);
	if (existing) {
		await gh("PATCH", `/repos/${values.REPO}/issues/comments/${existing.id}`, {
			body,
		});
		return;
	}
	await gh("POST", `/repos/${values.REPO}/issues/${pr}/comments`, { body });
}
async function emptyBucket(names) {
	const token = process.env.CLOUDFLARE_API_TOKEN;
	const account = process.env.CLOUDFLARE_ACCOUNT_ID;
	if (!token || !account) {
		throw new Error("cannot empty preview R2 without Cloudflare credentials");
	}
	let cursor;
	for (;;) {
		const url = new URL(
			`https://api.cloudflare.com/client/v4/accounts/${account}/r2/buckets/${names.bucket}/objects`,
		);
		url.searchParams.set("per_page", "1000");
		if (cursor) url.searchParams.set("cursor", cursor);
		const response = await fetch(url, {
			headers: { authorization: `Bearer ${token}` },
		});
		if (!response.ok) {
			if (response.status === 404) return;
			throw new Error(
				`R2 list objects → ${response.status} ${await response.text()}`,
			);
		}
		const payload = await response.json();
		for (const object of payload.result ?? []) {
			if (!object.key) continue;
			try {
				wrangler([
					"r2",
					"object",
					"delete",
					`${names.bucket}/${object.key}`,
					"--remote",
				]);
			} catch (error) {
				if (!gone(String(error.message))) throw error;
			}
		}
		const truncated =
			payload.result_info?.is_truncated ?? payload.truncated ?? false;
		if (!truncated) break;
		cursor = payload.result_info?.cursor ?? payload.cursor;
		if (!cursor) break;
	}
}

export async function deployPreview() {
	const values = env();
	const missing = missingPreviewSecrets(values);
	if (missing.length) {
		console.log(`Preview skipped — missing ${missing.join(", ")}.`);
		return { skipped: "secrets", missing };
	}
	if (!values.PR_NUMBER || !values.REPO) {
		throw new Error("PR_NUMBER and REPO are required");
	}
	if (shouldSkipFork({ head: values.HEAD_REPO, base: values.REPO })) {
		console.log(
			"Preview skipped — fork PRs do not receive Cloudflare credentials.",
		);
		return { skipped: "fork" };
	}

	const names = previewNames(values.PR_NUMBER);
	assertPreviewIsolation(names);
	const cmds = previewCommands(names);

	const databaseId = ensureDatabase(names, cmds);
	if (!databaseId)
		throw new Error(`could not resolve D1 id for ${names.database}`);
	if (!bucketExists(names, cmds)) tryCreate(cmds.r2Create);

	const built = path.join(repoRoot, "build", "server", "wrangler.json");
	if (!existsSync(built)) {
		throw new Error(
			"build/server/wrangler.json is missing — run pnpm build first",
		);
	}
	writePreviewConfig(built, built, names.pr, databaseId);

	wrangler(cmds.d1Migrate, { config: built });
	seedRemote(built);
	wrangler(cmds.d1Seed, { config: built });
	wrangler(cmds.d1Enrich, { config: built });

	const deployed = wrangler(cmds.deploy, { config: built });
	const url = parseWorkersDevUrl(deployed);
	if (!url) {
		throw new Error(`could not parse workers.dev URL from:\n${deployed}`);
	}
	if (values.GH_TOKEN) await upsertComment(names.pr, url, values.HEAD_SHA);
	console.log(`Preview URL: ${url}`);
	return { url, names };
}

export async function teardownPreview() {
	const values = env();
	const missing = missingPreviewSecrets(values);
	if (missing.length) {
		console.log(`Preview teardown skipped — missing ${missing.join(", ")}.`);
		return { skipped: "secrets", missing };
	}
	if (!values.PR_NUMBER) throw new Error("PR_NUMBER is required");
	if (shouldSkipFork({ head: values.HEAD_REPO, base: values.REPO })) {
		console.log(
			"Preview teardown skipped — fork PRs never received a preview.",
		);
		return { skipped: "fork" };
	}

	const names = previewNames(values.PR_NUMBER);
	assertPreviewIsolation(names);
	if (names.worker === PRODUCTION.worker) {
		throw new Error("refusing to delete the production worker");
	}

	const cmds = previewCommands(names);
	for (const args of [cmds.deleteWorker, cmds.d1Delete]) {
		try {
			wrangler(args);
		} catch (error) {
			if (!gone(String(error.message))) throw error;
		}
	}
	try {
		if (bucketExists(names, cmds)) {
			await emptyBucket(names);
			wrangler(cmds.r2Delete);
		}
	} catch (error) {
		if (!gone(String(error.message))) throw error;
	}

	console.log(`Tore down preview ${names.worker}`);
	return { names };
}

const invoked =
	process.argv[1] &&
	path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
	const run = process.argv[2] === "teardown" ? teardownPreview : deployPreview;
	run().catch((error) => {
		console.error(error.message);
		process.exit(1);
	});
}
