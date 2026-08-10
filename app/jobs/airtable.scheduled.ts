import { runAirtableSync } from "~/sync/runner";
import type { ScheduledJob } from "./registry";

/**
 * The full-base reconciliation poll — the safety net under the webhook
 * trigger (docs/airtable-sync-design.md): it self-heals missed pings,
 * refreshes the webhook's expiry, and a full pass is idempotent, so running
 * on every cron tick is always safe. Errors flow to the registry's per-job
 * isolation.
 */
const job: ScheduledJob = {
	name: "airtable-sync",
	async run(env) {
		await runAirtableSync(env, { trigger: "cron" });
	},
};

export default job;
