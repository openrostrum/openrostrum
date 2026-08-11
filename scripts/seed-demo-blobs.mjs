#!/usr/bin/env node
/**
 * Loads the committed demo headshots and slide decks into R2 after verifying
 * the whole bundle. Local is the safe default used by db:seed; `--remote` is
 * an explicit owner-run operation performed before remote D1 enrichment.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--remote") || args.length > 1) {
	console.error("Usage: node scripts/seed-demo-blobs.mjs [--remote]");
	process.exit(2);
}
const remote = args[0] === "--remote";
const locationFlag = remote ? "--remote" : "--local";
const locationLabel = remote ? "remote R2" : "local R2";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const assets = ["headshots", "slides"].flatMap((group) => {
	const dir = path.join(here, "seed-assets", group);
	const entries = JSON.parse(
		readFileSync(path.join(dir, "manifest.json"), "utf8"),
	);
	return entries.map((entry) => ({ ...entry, dir }));
});
const config = JSON.parse(readFileSync(path.join(repoRoot, "wrangler.json")));
const bucket = config.r2_buckets[0].bucket_name;

let failed = false;
const verified = [];
for (const entry of assets) {
	const file = path.join(entry.dir, entry.fileName);
	if (!existsSync(file)) {
		console.error(`missing seed asset: ${file}`);
		failed = true;
		continue;
	}
	const bytes = readFileSync(file);
	if (bytes.length !== entry.sizeBytes) {
		console.error(
			`${entry.fileName} is ${bytes.length} bytes; manifest expects ${entry.sizeBytes}`,
		);
		failed = true;
		continue;
	}
	const digest = createHash("sha256").update(bytes).digest("hex");
	if (digest !== entry.sha256) {
		console.error(
			`${entry.fileName} does not match its manifest sha256; regenerate and commit the asset with its manifest`,
		);
		failed = true;
		continue;
	}
	verified.push({ ...entry, file });
}
if (failed) process.exit(1);

for (const entry of verified) {
	const result = spawnSync(
		"pnpm",
		[
			"exec",
			"wrangler",
			"r2",
			"object",
			"put",
			`${bucket}/${entry.r2Key}`,
			`--file=${entry.file}`,
			`--content-type=${entry.contentType}`,
			locationFlag,
		],
		{ cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"] },
	);
	if (result.status !== 0) {
		console.error(`upload failed for ${entry.r2Key}`);
		console.error(String(result.stdout));
		console.error(String(result.stderr));
		process.exit(1);
	}
	console.log(`${locationLabel} <- ${entry.r2Key}`);
}
console.log(`Seeded ${verified.length} demo assets into ${locationLabel}.`);
