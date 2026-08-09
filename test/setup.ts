import { applyD1Migrations, env } from "cloudflare:test";
import { beforeEach } from "vitest";

/**
 * PER-TEST ISOLATION. The vitest-pool-workers plugin does NOT reset D1 storage
 * between tests, so without this, rows leak across `it()` blocks and reused
 * fixture ids trip UNIQUE constraints. Before each test we ensure the schema is
 * migrated (idempotent — tracked in d1_migrations) and wipe every table's rows
 * inside one transaction with foreign keys deferred, so delete order can't cause
 * FK errors. Each test therefore starts from a pristine, fully migrated D1.
 */
beforeEach(async () => {
	await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
	const { results } = await env.DB.prepare(
		"SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name != 'd1_migrations'",
	).all<{ name: string }>();
	await env.DB.batch([
		env.DB.prepare("PRAGMA defer_foreign_keys = TRUE"),
		...results.map(({ name }) => env.DB.prepare(`DELETE FROM "${name}"`)),
	]);
});
