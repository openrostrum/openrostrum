import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { createGitRepository } from "./repository.mjs";

// These fixtures build throwaway git repositories. If one is ever created inside
// this repository, `git init` finds the parent instead of making its own repo:
// the fixture's commits land in real history and its `git config user.name`
// rewrites the real identity. That happened — two worktrees ended up with a HEAD
// whose whole tree was one fixture file, and every later commit was authored
// "Review Test". So the sandbox is now proven, not assumed, and the identity
// rides on the command instead of being written to config at all.
const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const IDENTITY = [
	"-c",
	"user.name=Review Test",
	"-c",
	"user.email=review@example.test",
];

// Git exports these to hook children, and `pnpm verify` runs from pre-push. An
// inherited GIT_DIR makes `git init` adopt the repository being pushed instead
// of the sandbox, so fixture commits rewrite its HEAD. Location assertions
// cannot see it: the work tree comes from the cwd, the object store from GIT_DIR.
const INHERITED_GIT_VARS = [
	"GIT_DIR",
	"GIT_WORK_TREE",
	"GIT_INDEX_FILE",
	"GIT_OBJECT_DIRECTORY",
	"GIT_ALTERNATE_OBJECT_DIRECTORIES",
	"GIT_COMMON_DIR",
	"GIT_NAMESPACE",
	"GIT_CEILING_DIRECTORIES",
	"GIT_PREFIX",
];

function gitEnv() {
	const env = { ...process.env };
	for (const name of INHERITED_GIT_VARS) delete env[name];
	return env;
}

async function sandbox(t) {
	const root = await realpath(await mkdtemp(join(tmpdir(), "agentic-review-")));
	assert.ok(
		!root.startsWith(REPO_ROOT),
		`fixture sandbox ${root} is inside ${REPO_ROOT}; git would use the real repository`,
	);
	t.after(() => rm(root, { recursive: true, force: true }));
	git(root, "init", "-q");
	assert.equal(
		resolve(git(root, "rev-parse", "--absolute-git-dir"), ".."),
		root,
		"fixture commits must write to the sandbox's own object store",
	);
	return root;
}

function git(cwd, ...args) {
	return execFileSync("git", [...IDENTITY, ...args], {
		cwd,
		encoding: "utf8",
		env: gitEnv(),
	}).trim();
}

// The leak is an environment variable, so the test sets it and proves a fixture
// commit cannot reach the repository it points at.
test("fixtures cannot reach a repository a leaked GIT_DIR points at", async (t) => {
	const outer = await realpath(await mkdtemp(join(tmpdir(), "outer-repo-")));
	t.after(() => rm(outer, { recursive: true, force: true }));
	git(outer, "init", "-q");
	await writeFile(join(outer, "real.ts"), "export const real = true;\n");
	git(outer, "add", ".");
	git(outer, "commit", "-qm", "real work");
	const before = git(outer, "rev-parse", "HEAD");

	const restore = process.env.GIT_DIR;
	process.env.GIT_DIR = join(outer, ".git");
	t.after(() => {
		if (restore === undefined) delete process.env.GIT_DIR;
		else process.env.GIT_DIR = restore;
	});

	const root = await sandbox(t);
	await writeFile(join(root, "fixture.ts"), "export const fixture = 1;\n");
	git(root, "add", ".");
	git(root, "commit", "-qm", "base");

	assert.equal(
		git(outer, "rev-parse", "HEAD"),
		before,
		"a fixture commit rewrote the history of the repository GIT_DIR pointed at",
	);
	assert.deepEqual(
		git(outer, "ls-tree", "HEAD", "--name-only").split("\n"),
		["real.ts"],
		"a fixture commit replaced the real repository's tree with its own files",
	);
});

test("repository tools expose changed diffs and unchanged context on demand", async (t) => {
	const root = await sandbox(t);
	await writeFile(join(root, "changed.ts"), "export const value = 1;\n");
	await writeFile(
		join(root, "unchanged.ts"),
		"export function sharedHelper() { return true; }\n",
	);
	git(root, "add", ".");
	git(root, "commit", "-qm", "base");
	const baseSha = git(root, "rev-parse", "HEAD");
	await writeFile(
		join(root, "changed.ts"),
		"import { sharedHelper } from './unchanged';\nexport const value = sharedHelper();\n",
	);
	git(root, "add", ".");
	git(root, "commit", "-qm", "head");
	const headSha = git(root, "rev-parse", "HEAD");

	const repository = createGitRepository({ repoRoot: root, baseSha, headSha });
	assert.deepEqual(repository.changes, [
		{ status: "M", path: "changed.ts", additions: 2, deletions: 1 },
	]);

	const diff = await repository.executeTool("get_changed_file_diff", {
		path: "changed.ts",
	});
	assert.equal(diff.ok, true);
	assert.match(diff.content, /\+import \{ sharedHelper \}/);

	const unchanged = await repository.executeTool("read_file", {
		path: "unchanged.ts",
		start_line: 1,
		end_line: 20,
	});
	assert.equal(unchanged.ok, true);
	assert.match(unchanged.content, /1: export function sharedHelper/);

	const search = await repository.executeTool("search_repository", {
		query: "sharedHelper",
	});
	assert.equal(search.ok, true);
	assert.ok(search.matches.some((match) => match.path === "unchanged.ts"));
});

test("change manifest preserves rename metadata and counts", async (t) => {
	const root = await sandbox(t);
	await writeFile(join(root, "before.ts"), "export const value = 1;\n");
	git(root, "add", ".");
	git(root, "commit", "-qm", "base");
	const baseSha = git(root, "rev-parse", "HEAD");
	git(root, "mv", "before.ts", "after.ts");
	git(root, "commit", "-qm", "head");
	const headSha = git(root, "rev-parse", "HEAD");

	const repository = createGitRepository({ repoRoot: root, baseSha, headSha });
	assert.deepEqual(repository.changes, [
		{
			status: "R",
			oldPath: "before.ts",
			path: "after.ts",
			additions: 0,
			deletions: 0,
		},
	]);
});

test("repository tools reject traversal and paginate large outputs", async (t) => {
	const root = await sandbox(t);
	await writeFile(
		join(root, "long.ts"),
		Array.from(
			{ length: 30 },
			(_, i) => `export const line${i + 1} = ${i + 1};`,
		).join("\n") + "\n",
	);
	git(root, "add", ".");
	git(root, "commit", "-qm", "base");
	const baseSha = git(root, "rev-parse", "HEAD");
	await writeFile(
		join(root, "long.ts"),
		Array.from(
			{ length: 35 },
			(_, i) => `export const line${i + 1} = ${i + 1};`,
		).join("\n") + "\n",
	);
	git(root, "add", ".");
	git(root, "commit", "-qm", "head");
	const headSha = git(root, "rev-parse", "HEAD");
	const repository = createGitRepository({ repoRoot: root, baseSha, headSha });

	const traversal = await repository.executeTool("read_file", {
		path: "../secret",
	});
	assert.equal(traversal.ok, false);
	assert.match(traversal.error, /repository-relative/);

	const page = await repository.executeTool("read_file", {
		path: "long.ts",
		start_line: 11,
		end_line: 15,
	});
	assert.equal(page.ok, true);
	assert.equal(page.start_line, 11);
	assert.equal(page.end_line, 15);
	assert.equal(page.total_lines, 35);
	assert.match(page.content, /^11: export const line11/m);
	assert.doesNotMatch(page.content, /16: export const line16/);
});
