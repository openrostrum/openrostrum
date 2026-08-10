import fs from "node:fs";
import path from "node:path";
import {
	cloudflareTest,
	readD1Migrations,
} from "@cloudflare/vitest-pool-workers";
import tsconfigPaths from "vite-tsconfig-paths";
import { configDefaults, defineConfig } from "vitest/config";

// Tests must never see a developer's .dev.vars: ports treat any present key as
// "use the real provider" (docs/rules/engineering.md §Tests, hermeticity), so
// blank every key the file defines. The pattern covers wrangler's dotenv line
// grammar and over-matches: an extra blank is harmless, a missed key leaks.
function blankedDevVars(): Record<string, string> {
	const devVarsPath = path.join(import.meta.dirname, ".dev.vars");
	if (!fs.existsSync(devVarsPath)) return {};
	const source = fs.readFileSync(devVarsPath, "utf8");
	const keys = [
		...source.matchAll(/^\s*(?:export\s+)?([\w.-]+)\s*(?:=|:\s)/gm),
	];
	return Object.fromEntries(keys.map(([, key]) => [key, ""]));
}

// Runs tests INSIDE workerd against a real (local, isolated) D1 — the same
// runtime and DB as prod. Applies the same drizzle/migrations the app uses, so
// "green test" genuinely means "works on Workers". See docs/rules/tech-stack.md.
export default defineConfig(async () => {
	const migrations = await readD1Migrations(
		path.join(import.meta.dirname, "drizzle/migrations"),
	);
	return {
		plugins: [
			tsconfigPaths(),
			cloudflareTest({
				wrangler: { configPath: "./wrangler.json" },
				// The `ai` binding is inherently remote: with remote bindings on, the
				// pool opens a proxy session to Cloudflare at startup — which needs
				// wrangler auth (breaks CI) and would let a test reach live Workers AI
				// (breaks hermeticity). Tests stub the model at the binding seam.
				remoteBindings: false,
				miniflare: {
					bindings: {
						...blankedDevVars(),
						TEST_MIGRATIONS: migrations,
						APP_ENV: "test",
					},
				},
			}),
		],
		test: {
			// Nested git worktrees under .claude/ run their own suites — never
			// from the parent (same rule as eslint's .claude/** ignore).
			exclude: [...configDefaults.exclude, ".claude/**"],
			setupFiles: ["./test/setup.ts"],
			deps: {
				optimizer: {
					ssr: {
						enabled: true,
						// `ics` pulls CJS deps (yup → property-expr) that workerd's
						// ESM shim can't import raw; pre-bundling restores interop.
						include: ["ics"],
					},
				},
			},
		},
	};
});
