import { env } from "cloudflare:test";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "../app/db";
import seedSql from "../drizzle/seed.sql?raw";

// The demo seed is the deployed baseline every public surface serves. The
// public speaker surfaces render "Title, Company" attribution ONLY from
// contact data, so a speaker contact seeded without job_title/company_name
// makes the attribution silently vanish across every page — the seed must
// carry it for everyone who surfaces publicly.

function statements(raw: string): string[] {
	return raw
		.split("\n")
		.filter((line) => !line.trimStart().startsWith("--"))
		.join("\n")
		.split(";")
		.map((s) => s.trim())
		.filter(Boolean);
}

describe("demo seed baseline", () => {
	it("applies cleanly and gives every publicly-surfaced speaker contact a title and company", async () => {
		const db = getDb(env);
		for (const statement of statements(seedSql)) {
			await db.run(sql.raw(statement));
		}
		const { results } = await db.run(sql`
			SELECT DISTINCT c.id, c.job_title, c.company_name
			FROM contacts c
			JOIN participants p ON p.contact_id = c.id
		`);
		expect(results.length).toBeGreaterThan(0);
		for (const row of results as Array<{
			id: string;
			job_title: string | null;
			company_name: string | null;
		}>) {
			expect(row.job_title, `contact ${row.id} has no job title`).toBeTruthy();
			expect(row.company_name, `contact ${row.id} has no company`).toBeTruthy();
		}
	});
});
