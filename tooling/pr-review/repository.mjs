import { execFileSync, spawnSync } from "node:child_process";
import { isAbsolute, posix } from "node:path";
import { Type } from "@earendil-works/pi-ai";

const MAX_BUFFER = 128 * 1024 * 1024;
const MAX_PAGE_LINES = 400;
const MAX_SEARCH_RESULTS = 100;
const MAX_LIST_RESULTS = 500;

const REVISION = Type.Union([Type.Literal("head"), Type.Literal("base")]);

const REPOSITORY_TOOL_SPECS = [
	{
		name: "get_changed_file_diff",
		description:
			"Read a page of the base-to-head unified diff for one changed file. Use pagination for large diffs.",
		parameters: Type.Object({
			path: Type.String(),
			start_line: Type.Optional(Type.Integer({ minimum: 1 })),
			end_line: Type.Optional(Type.Integer({ minimum: 1 })),
		}),
	},
	{
		name: "read_file",
		description:
			"Read numbered lines from any tracked repository file at the PR head or merge base, including unchanged files.",
		parameters: Type.Object({
			path: Type.String(),
			revision: Type.Optional(REVISION),
			start_line: Type.Optional(Type.Integer({ minimum: 1 })),
			end_line: Type.Optional(Type.Integer({ minimum: 1 })),
		}),
	},
	{
		name: "search_repository",
		description:
			"Search tracked repository text literally at the PR head or merge base. Useful for definitions, callers, tests, schemas, and conventions.",
		parameters: Type.Object({
			query: Type.String(),
			path: Type.Optional(Type.String()),
			revision: Type.Optional(REVISION),
			max_results: Type.Optional(
				Type.Integer({ minimum: 1, maximum: MAX_SEARCH_RESULTS }),
			),
		}),
	},
	{
		name: "list_repository",
		description:
			"List tracked repository paths under an optional directory prefix at the PR head or merge base.",
		parameters: Type.Object({
			path: Type.Optional(Type.String()),
			revision: Type.Optional(REVISION),
			max_results: Type.Optional(
				Type.Integer({ minimum: 1, maximum: MAX_LIST_RESULTS }),
			),
		}),
	},
];

export function createRepositoryTools(repository) {
	return REPOSITORY_TOOL_SPECS.map((spec) => ({
		...spec,
		label: spec.name,
		execute: async (_toolCallId, params) => {
			const result = await repository.executeTool(spec.name, params);
			if (!result.ok) throw new Error(result.error);
			return {
				content: [{ type: "text", text: JSON.stringify(result) }],
				details: result,
			};
		},
	}));
}

function validPath(value, { allowEmpty = false } = {}) {
	if (allowEmpty && (value == null || value === "")) return "";
	if (typeof value !== "string" || !value || value.includes("\0"))
		throw new Error("path must be a repository-relative path");
	if (
		isAbsolute(value) ||
		value.includes("\\") ||
		value === ".." ||
		value.startsWith("../") ||
		posix.normalize(value) !== value
	)
		throw new Error("path must be a repository-relative path");
	return value;
}

function positiveInt(value, fallback) {
	return Number.isInteger(value) && value > 0 ? value : fallback;
}

function pageLines(text, args, { numbered = false } = {}) {
	const lines = String(text).replace(/\n$/, "").split("\n");
	const total = text === "" ? 0 : lines.length;
	const start = Math.min(positiveInt(args.start_line, 1), Math.max(total, 1));
	const requestedEnd = positiveInt(args.end_line, start + MAX_PAGE_LINES - 1);
	const end = Math.min(total, requestedEnd, start + MAX_PAGE_LINES - 1);
	const content =
		total === 0
			? ""
			: lines
					.slice(start - 1, end)
					.map((line, index) => (numbered ? `${start + index}: ${line}` : line))
					.join("\n");
	return {
		content,
		start_line: total === 0 ? 0 : start,
		end_line: total === 0 ? 0 : end,
		total_lines: total,
		truncated: end < total,
	};
}

function parseChanges(nameStatus, numstat) {
	const counts = new Map();
	const statFields = numstat.split("\0");
	for (let index = 0; index < statFields.length; index++) {
		const record = statFields[index];
		if (!record) continue;
		const [added, deleted, directPath] = record.split("\t");
		// With -z, rename/copy records carry an empty path in the header followed
		// by separate old/new path fields. Counts belong to the new path.
		const path = directPath || statFields[index + 2];
		if (!directPath) index += 2;
		if (!path) continue;
		counts.set(path, {
			additions: added === "-" ? null : Number(added),
			deletions: deleted === "-" ? null : Number(deleted),
		});
	}

	const fields = nameStatus.split("\0").filter(Boolean);
	const changes = [];
	for (let index = 0; index < fields.length; ) {
		const rawStatus = fields[index++];
		const status = rawStatus[0];
		let oldPath;
		let path;
		if (status === "R" || status === "C") {
			oldPath = fields[index++];
			path = fields[index++];
		} else {
			path = fields[index++];
		}
		const count = counts.get(path) ?? {};
		changes.push({
			status,
			...(oldPath ? { oldPath } : {}),
			path,
			additions: count.additions ?? null,
			deletions: count.deletions ?? null,
		});
	}
	return changes;
}

// `repoRoot` is the repository to read, so an inherited GIT_DIR must not
// redirect these commands elsewhere. Git exports it to hook children, and
// `pnpm verify` runs from pre-push: every read then resolved against the
// repository being pushed, which cannot name the revisions it was asked for.
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

export function createGitRepository({ repoRoot, baseSha, headSha }) {
	function git(...args) {
		return execFileSync("git", args, {
			cwd: repoRoot,
			encoding: "utf8",
			maxBuffer: MAX_BUFFER,
			env: gitEnv(),
		});
	}

	const mergeBase = git("merge-base", baseSha, headSha).trim();
	const changes = parseChanges(
		git("diff", "--name-status", "-z", mergeBase, headSha),
		git("diff", "--numstat", "-z", mergeBase, headSha),
	);
	const changedPaths = new Set(
		changes.flatMap((change) => [change.path, change.oldPath].filter(Boolean)),
	);

	function revision(name) {
		return name === "base" ? mergeBase : headSha;
	}

	async function executeTool(name, args = {}) {
		try {
			if (name === "get_changed_file_diff") {
				const path = validPath(args.path);
				if (!changedPaths.has(path))
					throw new Error("path is not changed in this pull request");
				return {
					ok: true,
					path,
					...pageLines(
						git("diff", "--no-ext-diff", mergeBase, headSha, "--", path),
						args,
					),
				};
			}
			if (name === "read_file") {
				const path = validPath(args.path);
				const rev = revision(args.revision);
				const content = git("show", `${rev}:${path}`);
				return {
					ok: true,
					path,
					revision: args.revision === "base" ? "base" : "head",
					...pageLines(content, args, { numbered: true }),
				};
			}
			if (name === "search_repository") {
				if (typeof args.query !== "string" || !args.query)
					throw new Error("query must be a non-empty string");
				const path = validPath(args.path, { allowEmpty: true });
				const rev = revision(args.revision);
				const maxResults = Math.min(
					positiveInt(args.max_results, MAX_SEARCH_RESULTS),
					MAX_SEARCH_RESULTS,
				);
				const command = ["grep", "-n", "-I", "-F", "-e", args.query, rev, "--"];
				if (path) command.push(path);
				const result = spawnSync("git", command, {
					cwd: repoRoot,
					encoding: "utf8",
					maxBuffer: MAX_BUFFER,
					env: gitEnv(),
				});
				if (result.status !== 0 && result.status !== 1)
					throw new Error(result.stderr || "git grep failed");
				const lines = result.stdout.split("\n").filter(Boolean);
				const matches = lines.slice(0, maxResults).map((line) => {
					const match = line.match(/^[^:]+:(.*?):(\d+):(.*)$/);
					return match
						? { path: match[1], line: Number(match[2]), text: match[3] }
						: { path: "", line: 0, text: line };
				});
				return {
					ok: true,
					matches,
					truncated: lines.length > maxResults,
				};
			}
			if (name === "list_repository") {
				const path = validPath(args.path, { allowEmpty: true });
				const maxResults = Math.min(
					positiveInt(args.max_results, MAX_LIST_RESULTS),
					MAX_LIST_RESULTS,
				);
				const command = [
					"ls-tree",
					"-r",
					"--name-only",
					revision(args.revision),
				];
				if (path) command.push("--", path);
				const paths = git(...command)
					.split("\n")
					.filter(Boolean);
				return {
					ok: true,
					paths: paths.slice(0, maxResults),
					truncated: paths.length > maxResults,
				};
			}
			throw new Error(`unknown repository tool: ${name}`);
		} catch (error) {
			return { ok: false, error: String(error?.message ?? error) };
		}
	}

	function getRawDiff(path) {
		return git(
			"diff",
			"--no-ext-diff",
			mergeBase,
			headSha,
			"--",
			validPath(path),
		);
	}

	return {
		baseSha: mergeBase,
		headSha,
		changes,
		executeTool,
		getRawDiff,
	};
}
