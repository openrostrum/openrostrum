import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { getDb } from "../app/db";
import { pipelineCards } from "../app/db/schema";
import { loader } from "../app/routes/admin.crm._index";
import { CONTEXT, requestAs, seedCrmBaseline } from "./crm-fixtures";

type LoaderResult = {
	data: {
		dashboard: {
			people: number;
			eventCount: number;
			returningSpeakers: number;
			inPipeline: number;
			byStage: Array<{ stage: string; n: number }>;
			topCompanies: Array<{ companyName: string; people: number }>;
			topEvents: Array<{ name: string; contacts: number }>;
			recentPeople: Array<{ email: string }>;
		};
	};
};

async function runLoader(userId: string): Promise<LoaderResult> {
	const request = await requestAs(userId, "http://localhost/admin/crm");
	return (await loader({
		context: CONTEXT,
		request,
		params: {},
	} as unknown as Parameters<typeof loader>[0])) as unknown as LoaderResult;
}

describe("CRM overview", () => {
	it("computes org-scoped KPIs that agree with the fixture directory", async () => {
		await seedCrmBaseline();
		const db = getDb(env);
		await db.insert(pipelineCards).values({
			id: "card1",
			organizationId: "org1",
			email: "marcus@example.com",
			firstName: "Marcus",
			lastName: "Okafor",
			stage: "contacted",
		});

		const { data } = await runLoader("u_admin1");
		const d = data.dashboard;
		// Three distinct people across org1's two events; Priya (two events)
		// is the one returning speaker. org2's rows must not inflate anything.
		expect(d.people).toBe(3);
		expect(d.eventCount).toBe(2);
		expect(d.returningSpeakers).toBe(1);
		expect(d.inPipeline).toBe(1);
		expect(d.byStage.find((s) => s.stage === "contacted")?.n).toBe(1);
		// Latticework counts ONE person, not her two event rows.
		expect(d.topCompanies).toContainEqual({
			companyName: "Latticework Systems",
			people: 1,
		});
		expect(d.topEvents.map((e) => e.name)).not.toContain("Rival Conf");
		expect(d.recentPeople.map((p) => p.email)).toEqual([
			"priya.alt@example.com",
			"marcus@example.com",
			"priya@example.com",
		]);
	});

	it("shows org2 its own numbers, untouched by org1's pipeline", async () => {
		await seedCrmBaseline();
		const db = getDb(env);
		await db.insert(pipelineCards).values({
			id: "card1",
			organizationId: "org1",
			email: "marcus@example.com",
			firstName: "Marcus",
			lastName: "Okafor",
			stage: "contacted",
		});
		const { data } = await runLoader("u_admin2");
		expect(data.dashboard.people).toBe(3);
		expect(data.dashboard.eventCount).toBe(1);
		expect(data.dashboard.returningSpeakers).toBe(0);
		expect(data.dashboard.inPipeline).toBe(0);
	});
});
