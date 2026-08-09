/**
 * JOB REGISTRY — parallel-agent-safe scheduled work. Each feature drops
 * `app/jobs/<name>.scheduled.ts` exporting a default ScheduledJob; the worker
 * entry dispatches to all of them on the cron tick, so the shared `scheduled()`
 * body in workers/app.ts never becomes a merge chokepoint. A job decides for
 * itself what (if anything) is due this tick. See docs/tech-stack.md.
 */
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
		await job.run(env, ctx);
	}
}
