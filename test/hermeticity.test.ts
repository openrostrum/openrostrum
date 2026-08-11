import { env } from "cloudflare:test";
import { expect, it } from "vitest";

// vitest.config.ts blanks every .dev.vars key so capability-resolved ports
// can't go live in tests (docs/rules/engineering.md §Tests, hermeticity).
// A checkout with real keys once ran the suite against live Resend/Airtable;
// this fails by name, before any provider 4xx, if that seal breaks again.
it("provider secrets never reach the test env", () => {
	const secrets = [
		"RESEND_API_KEY",
		"AIRTABLE_API_KEY",
		"AIRTABLE_BASE_ID",
		"AIRTABLE_WEBHOOK_SECRET",
		"TURNSTILE_SECRET",
		"UNSUBSCRIBE_SECRET",
		"DEEPSEEK_API_KEY",
	] as const;
	for (const key of secrets) {
		expect(env[key] ?? "", `${key} leaked into the test env`).toBe("");
	}
});
