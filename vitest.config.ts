import path from "node:path";
import {
	cloudflareTest,
	readD1Migrations,
} from "@cloudflare/vitest-pool-workers";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

// Runs tests INSIDE workerd against a real (local, isolated) D1 — the same
// runtime and DB as prod. Applies the same drizzle/migrations the app uses, so
// "green test" genuinely means "works on Workers". See docs/tech-stack.md.
export default defineConfig(async () => {
	const migrations = await readD1Migrations(
		path.join(import.meta.dirname, "drizzle/migrations"),
	);
	return {
		plugins: [
			tsconfigPaths(),
			cloudflareTest({
				wrangler: { configPath: "./wrangler.json" },
				miniflare: {
					bindings: { TEST_MIGRATIONS: migrations, APP_ENV: "test" },
				},
			}),
		],
		test: {
			setupFiles: ["./test/setup.ts"],
		},
	};
});
