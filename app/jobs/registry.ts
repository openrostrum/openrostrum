/**
 * JOB REGISTRY — parallel-agent-safe scheduled work. Each feature drops
 * `app/jobs/<name>.scheduled.ts` exporting a default ScheduledJob; the worker
 * entry dispatches on the cron tick, so the shared `scheduled()` body in
 * workers/app.ts never becomes a merge chokepoint. A job declares its cadence
 * (`cron`) and Cloudflare invokes `scheduled()` once per matching trigger with
 * `controller.cron` set to that expression — dispatch is a string match. Every
 * cadence used here MUST also appear in `wrangler.json` `triggers.crons`
 * (pinned by test/scheduled.dispatch.test.ts) or the job silently never runs.
 * See docs/rules/tech-stack.md.
 */
export interface ScheduledJob {
	name: string;
	/** The `triggers.crons` expression this job runs on (controller.cron match). */
	cron: string;
	run(env: Env, ctx: ExecutionContext): Promise<void>;
}

// Cadence constants live in ./cadence.ts — jobs must import them from there,
// never from this module (the eager glob below makes that import circular).
export { DAILY_CRON, HOURLY_CRON } from "./cadence";

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
 * carries the matching expression.
 */
export async function runScheduledJobs(
	cron: string | undefined,
	env: Env,
	ctx: ExecutionContext,
): Promise<void> {
	const due = cron
		? scheduledJobs.filter((job) => job.cron === cron)
		: scheduledJobs;
	for (const job of due) {
		await job.run(env, ctx);
	}
}
