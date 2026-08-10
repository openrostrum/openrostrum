import type { D1Migration } from "cloudflare:test";

/**
 * Test-only bindings injected via vitest.config.ts `miniflare.bindings` —
 * they exist only inside the test runtime, so they are declared here rather
 * than in the wrangler-generated `worker-configuration.d.ts`.
 */
declare global {
	namespace Cloudflare {
		interface Env {
			TEST_MIGRATIONS: D1Migration[];
		}
	}
}
