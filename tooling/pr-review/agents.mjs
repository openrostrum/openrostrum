// Full-coverage reviewer: one focused agent per rule doc in docs/rules/. The set
// is DISCOVERED, not hand-listed — drop a rule doc in docs/rules/ and it gets a
// reviewer; delete one and it's gone. Each agent loads its doc VERBATIM at review
// time as the source of truth, so the rules can never drift from the md files and
// coverage is provably the union of docs/rules/.
//
// Purely-procedural rules (git append-only, squash-merge, verify-before-commit)
// aren't checkable from a PR diff and stay hook/CI-enforced — they aren't docs
// here by design.
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(HERE, "..", "..");
export const RULES_DIR = join(REPO_ROOT, "docs", "rules");

export function loadAgents() {
	return readdirSync(RULES_DIR)
		.filter((f) => f.endsWith(".md"))
		.sort()
		.map((f) => ({ id: f.replace(/\.md$/, ""), doc: `docs/rules/${f}` }));
}
