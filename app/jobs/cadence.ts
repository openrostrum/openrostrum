// Cron cadences for `app/jobs/*.scheduled.ts` — kept OUT of registry.ts: its
// eager glob evaluates job modules first, so a job importing constants back
// from the registry gets `cron` as `undefined` and dispatch matches nothing.
// Every value here must also appear in `wrangler.json` `triggers.crons`.

/** Daily tick, 09:00 UTC — reminder-style jobs (once-a-day cadence). */
export const DAILY_CRON = "0 9 * * *";

/** Hourly tick — reconciliation polls (the Airtable sync safety net). */
export const HOURLY_CRON = "0 * * * *";
