// Runtime SECRETS (added via `wrangler secret put`, not wrangler.json bindings,
// so they aren't in the generated worker-configuration.d.ts). Declared here so
// port adapters read them type-safely instead of casting `env as {...}`.
declare namespace Cloudflare {
	interface Env {
		RESEND_API_KEY?: string;
		TURNSTILE_SECRET?: string;
		AIRTABLE_API_KEY?: string;
		AIRTABLE_BASE_ID?: string;
		/** Base64 MAC secret returned when the Airtable webhook is created. */
		AIRTABLE_WEBHOOK_SECRET?: string;
		/** The webhook's id — set alongside the secret so the cron poll can refresh its 7-day expiry. */
		AIRTABLE_WEBHOOK_ID?: string;
		/** Public origin (e.g. https://openrostrum.com) for links in cron-sent
		 * emails, where no request URL exists to derive it from. */
		APP_ORIGIN?: string;
	}
}
