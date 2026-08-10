/**
 * Cron cadences for `app/jobs/*.scheduled.ts`. Lives in its own module — NOT
 * in registry.ts — because the registry eagerly globs every job module: a job
 * importing a constant back from the registry would form a cycle in which the
 * job evaluates before the constant initializes and `cron` lands `undefined`,
 * so dispatch would match nothing.
 *
 * Every value here MUST also appear in `wrangler.json` `triggers.crons`
 * (integration-owned) or jobs on that cadence silently never run.
 */

/** Daily tick, 09:00 UTC — reminder-style jobs (once-a-day cadence). */
export const DAILY_CRON = "0 9 * * *";

/** Hourly tick — reconciliation polls (the Airtable sync safety net). */
export const HOURLY_CRON = "0 * * * *";
