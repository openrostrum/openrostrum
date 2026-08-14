import { assertPreviewIsolation } from "./names.mjs";

export function previewCommands(names) {
	assertPreviewIsolation(names);
	return {
		d1List: ["d1", "list", "--json"],
		d1Create: ["d1", "create", names.database],
		d1Migrate: ["d1", "migrations", "apply", names.database, "--remote"],
		d1Seed: [
			"d1",
			"execute",
			names.database,
			"--remote",
			"--yes",
			"--file=drizzle/seed.sql",
		],
		d1Enrich: [
			"d1",
			"execute",
			names.database,
			"--remote",
			"--yes",
			"--file=drizzle/seed-demo-enrichment.sql",
		],
		d1Delete: ["d1", "delete", names.database, "--skip-confirmation"],
		r2Create: ["r2", "bucket", "create", names.bucket],
		r2List: ["r2", "bucket", "list"],
		r2Delete: ["r2", "bucket", "delete", names.bucket],
		deploy: ["deploy"],
		deleteWorker: ["delete", "--name", names.worker, "--force"],
	};
}
