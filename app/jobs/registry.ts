import { errorMessage, toError } from "~/lib/errors";
import { track } from "~/lib/track";

/**
 * JOB REGISTRY — parallel-agent-safe scheduled work. Each feature drops
 * `app/jobs/<name>.scheduled.ts` exporting a default ScheduledJob; the worker
 * entry dispatches on the cron tick, so the shared `scheduled()` body in
 * workers/app.ts never becomes a merge chokepoint. A job declares its cadence
 * (`cron`) and Cloudflare invokes `scheduled()` once per matching trigger with
 * `controller.cron` set to that expression — dispatch is a string match. Every
 * cadence used here MUST also appear in `wrangler.json` `triggers.crons` or
 * the job silently never runs. See docs/rules/tech-stack.md.
 */
export interface ScheduledJob {
	name: string;
	/** The `triggers.crons` expression this job runs on (controller.cron match). */
	cron: string;
	run(env: Env, ctx: ExecutionContext): Promise<void>;
}

const modules = import.meta.glob<{ default: ScheduledJob }>(
	"./*.scheduled.ts",
	{ eager: true },
);

export const scheduledJobs: ScheduledJob[] = Object.values(modules).map(
	(m) => m.default,
);

/**
 * Runs the jobs whose `cron` matches this tick's trigger. An empty/absent
 * cron (only possible from a manual `wrangler dev` test trigger without a
 * `?cron=` param) runs everything — in production `controller.cron` always
 * carries the matching expression. Jobs run serially but isolated: one job
 * throwing must never starve the jobs after it of their tick — yet the
 * invocation still FAILS afterward, so a crashing job stays visible at error
 * level in Workers metrics/logs instead of drowning at info level. Every job
 * is idempotent (reminder stamps, sync lock), so re-running a tick is safe.
 */
export async function runScheduledJobs(
	cron: string | undefined,
	env: Env,
	ctx: ExecutionContext,
): Promise<void> {
	const due = cron
		? scheduledJobs.filter((job) => job.cron === cron)
		: scheduledJobs;
	const failures: Error[] = [];
	for (const job of due) {
		try {
			await job.run(env, ctx);
		} catch (error) {
			track("jobs.run_failed", { job: job.name, error: errorMessage(error) });
			failures.push(toError(error));
		}
	}
	if (failures.length > 0) {
		throw new AggregateError(
			failures,
			`${failures.length} scheduled job(s) failed`,
		);
	}
}
