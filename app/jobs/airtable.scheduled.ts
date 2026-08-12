import { errorMessage } from "~/lib/errors";
import { track } from "~/lib/track";
import { runAirtableSync } from "~/sync/runner";
import { HOURLY_CRON } from "./cadence";
import type { ScheduledJob } from "./registry";

/**
 * The full-base reconciliation poll — the safety net under the webhook trigger
 * (docs/airtable-sync-design.md): it self-heals missed pings and refreshes the
 * webhook's expiry. A full pass is idempotent, so any cadence is safe; hourly,
 * because until a webhook exists this poll is the only pull path.
 */
const job: ScheduledJob = {
	name: "airtable-sync",
	cron: HOURLY_CRON,
	async run(env) {
		try {
			await runAirtableSync(env, { trigger: "cron" });
		} catch (error) {
			// Operational failures (rate limits, breaker) never throw — the runner
			// returns them as typed statuses. Anything here is infrastructure-level
			// (D1/lock writes failing): track it under the sync-health name, then
			// rethrow so the registry fails the tick and the crash stays visible.
			track("sync.job_failed", { error: errorMessage(error) });
			throw error;
		}
	},
};

export default job;
