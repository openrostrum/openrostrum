import { errorMessage } from "~/lib/errors";
import { track } from "~/lib/track";
import { runAirtableSync } from "~/sync/runner";
import { HOURLY_CRON } from "./cadence";
import type { ScheduledJob } from "./registry";

/**
 * The full-base reconciliation poll — the safety net under the webhook
 * trigger (docs/airtable-sync-design.md): it self-heals missed pings and
 * refreshes the webhook's expiry; a full pass is idempotent, so any cadence
 * is safe. Hourly: until a webhook is provisioned this poll is the only pull
 * path, and team edits landing once a day would read as data loss.
 */
const job: ScheduledJob = {
	name: "airtable-sync",
	cron: HOURLY_CRON,
	async run(env) {
		try {
			await runAirtableSync(env, { trigger: "cron" });
		} catch (error) {
			// The registry runs jobs serially — a sync failure must never starve
			// the jobs after it of their tick.
			track("sync.job_failed", { error: errorMessage(error) });
		}
	},
};

export default job;
