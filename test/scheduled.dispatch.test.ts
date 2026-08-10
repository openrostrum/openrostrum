import { createExecutionContext, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { emailOutbox, taskAssignments } from "../app/db/schema";
import { DAILY_CRON, HOURLY_CRON } from "../app/jobs/cadence";
import { scheduledJobs } from "../app/jobs/registry";
import wrangler from "../wrangler.json";
import worker from "../workers/app";
import { DAY_MS, seedTasksBaseline } from "./tasks-fixtures";

// Contract under test: the worker's scheduled() handler routes each cron tick
// to the jobs declaring that cadence — the daily tick sends task reminders,
// the hourly tick runs the Airtable reconciliation poll — and every cadence a
// job declares is registered in wrangler.json `triggers.crons` (an
// unregistered cadence = a job that silently never runs). Ticks run the REAL
// jobs: outcomes are observed in D1 (email_outbox), so a job whose `cron`
// field breaks (e.g. the registry⇄job import cycle that once left it
// `undefined`) fails on missing/extra sends, not on wiring introspection.

async function tick(cron: string) {
	const controller = {
		cron,
		scheduledTime: Date.now(),
		noRetry() {},
	} as ScheduledController;
	await worker.scheduled?.(controller, env, createExecutionContext());
}

/** One assignment due tomorrow — inside the reminder window, never reminded. */
async function seedDueReminder() {
	const db = await seedTasksBaseline();
	await db.insert(taskAssignments).values({
		id: "a_sweep_due",
		taskId: "t_hotel",
		contactId: "c_priya",
		status: "incomplete",
		dueAt: new Date(Date.now() + 1 * DAY_MS),
	});
	return db;
}

describe("scheduled() cron dispatch", () => {
	it("the daily tick delivers a due task reminder end-to-end", async () => {
		const db = await seedDueReminder();
		await tick(DAILY_CRON);
		const sent = await db.select().from(emailOutbox);
		expect(sent).toHaveLength(1);
		expect(sent[0]?.dedupeKey).toContain("task-due:a_sweep_due");
	});

	it("the hourly tick runs the Airtable poll, not the reminder job", async () => {
		// Airtable is unconfigured in tests → the poll no-ops; the observable
		// outcome is the NEGATIVE: a due reminder must not send on this tick.
		const db = await seedDueReminder();
		await tick(HOURLY_CRON);
		expect(await db.select().from(emailOutbox)).toHaveLength(0);
	});

	it("a manual test trigger without a cron runs every job", async () => {
		// Same observable outcome as the daily tick: the due reminder sends —
		// proving the reminder job is included when no cadence is given (the
		// Airtable poll runs too; unconfigured it no-ops).
		const db = await seedDueReminder();
		await tick("");
		expect(await db.select().from(emailOutbox)).toHaveLength(1);
	});

	it("every job's cadence is registered in wrangler.json triggers.crons", () => {
		const crons: string[] = wrangler.triggers.crons;
		expect(scheduledJobs.length).toBeGreaterThanOrEqual(2);
		for (const job of scheduledJobs) {
			expect(
				typeof job.cron === "string" && job.cron.length > 0,
				`"${job.name}" declares no cadence`,
			).toBe(true);
			expect(
				crons,
				`"${job.name}" cadence "${job.cron}" missing from wrangler.json`,
			).toContain(job.cron);
		}
	});

	it("pins each job to its decided cadence — reminders daily, Airtable hourly", () => {
		// The positive half of the cadence contract: the negative outcome tests
		// above would still pass if the Airtable poll silently regressed to the
		// daily tick (it no-ops unconfigured); this fails on exactly that flip.
		const byName = new Map(scheduledJobs.map((j) => [j.name, j.cron]));
		expect(byName.get("task-due-reminders")).toBe(DAILY_CRON);
		expect(byName.get("airtable-sync")).toBe(HOURLY_CRON);
	});
});
