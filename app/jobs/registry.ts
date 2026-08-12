import { errorMessage, toError } from "~/lib/errors";
import { track } from "~/lib/track";

/**
 * JOB REGISTRY — a feature drops `app/jobs/<name>.scheduled.ts` instead of
 * editing the worker's `scheduled()` body. Dispatch is a string match on the
 * job's declared `cron`, so a cadence missing from `wrangler.json`
 * `triggers.crons` silently never runs. See docs/rules/tech-stack.md.
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
 * Runs the jobs whose `cron` matches this tick's trigger (an empty cron — a
 * manual dev trigger — runs everything). Jobs run serially but isolated: one
 * throwing never starves the rest, yet the invocation still fails afterward
 * so a crash stays error-visible. Every job is idempotent — retries are safe.
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
