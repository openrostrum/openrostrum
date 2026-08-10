/**
 * JOB REGISTRY — parallel-agent-safe scheduled work. Each feature drops
 * `app/jobs/<name>.scheduled.ts` exporting a default ScheduledJob; the worker
 * entry dispatches to all of them on the cron tick, so the shared `scheduled()`
 * body in workers/app.ts never becomes a merge chokepoint. A job decides for
 * itself what (if anything) is due this tick. See docs/rules/tech-stack.md.
 */
import { errorMessage } from "~/lib/errors";
import { track } from "~/lib/track";

export interface ScheduledJob {
	name: string;
	run(env: Env, ctx: ExecutionContext): Promise<void>;
}

const modules = import.meta.glob<{ default: ScheduledJob }>(
	"./*.scheduled.ts",
	{ eager: true },
);

export const scheduledJobs: ScheduledJob[] = Object.values(modules).map(
	(m) => m.default,
);

export async function runScheduledJobs(
	env: Env,
	ctx: ExecutionContext,
): Promise<void> {
	for (const job of scheduledJobs) {
		// Isolation lives HERE, once: jobs let errors flow, and one failing job
		// must never starve the jobs after it of their tick.
		try {
			await job.run(env, ctx);
		} catch (error) {
			track("job.run_failed", {
				job: job.name,
				error: errorMessage(error),
			});
		}
	}
}
