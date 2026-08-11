// Cron cadences for `app/jobs/*.scheduled.ts` — kept OUT of registry.ts: its
// eager glob evaluates job modules first, so a job importing constants back
// from the registry gets `cron` as `undefined` and dispatch matches nothing.
// Every value here must also appear in `wrangler.json` `triggers.crons`.

export const DAILY_CRON = "0 9 * * *";

export const HOURLY_CRON = "0 * * * *";
