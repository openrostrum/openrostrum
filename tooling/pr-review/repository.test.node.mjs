import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createGitRepository } from "./repository.mjs";

function git(cwd, ...args) {
	return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

test("repository tools expose changed diffs and unchanged context on demand", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "agentic-review-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	git(root, "init", "-q");
	git(root, "config", "user.name", "Review Test");
	git(root, "config", "user.email", "review@example.test");
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
	const root = await mkdtemp(join(tmpdir(), "agentic-review-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	git(root, "init", "-q");
	git(root, "config", "user.name", "Review Test");
	git(root, "config", "user.email", "review@example.test");
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
	const root = await mkdtemp(join(tmpdir(), "agentic-review-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	git(root, "init", "-q");
	git(root, "config", "user.name", "Review Test");
	git(root, "config", "user.email", "review@example.test");
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
