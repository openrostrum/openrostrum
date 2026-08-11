import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { getDb } from "../app/db";
import { pipelineCards, users } from "../app/db/schema";
import { hashPassword } from "../app/lib/auth";
import { loader } from "../app/routes/admin.crm._index";
import { loader as directoryLoader } from "../app/routes/admin.crm.directory";
import { CONTEXT, requestAs, seedCrmBaseline } from "./crm-fixtures";
import { catchThrown } from "./thrown";

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

	it("serves an admin without any org membership instead of redirect-looping", async () => {
		const db = getDb(env);
		await db.insert(users).values({
			id: "u_orphan",
			email: "orphan@test.co",
			passwordHash: await hashPassword("pw"),
			role: "admin",
		});

		// /admin/crm is this loader's own URL: it must return empty data (the
		// shell renders the no-org state), NEVER a self-redirect.
		const request = await requestAs("u_orphan", "http://localhost/admin/crm");
		const result = (await loader({
			context: CONTEXT,
			request,
			params: {},
		} as unknown as Parameters<typeof loader>[0])) as unknown as {
			data: { dashboard: unknown };
		};
		expect(result.data.dashboard).toBeNull();

		// Children redirect to the shell, where the empty state lives.
		const dirRequest = await requestAs(
			"u_orphan",
			"http://localhost/admin/crm/directory",
		);
		const thrown = await catchThrown(() =>
			directoryLoader({
				context: CONTEXT,
				request: dirRequest,
				params: {},
			} as unknown as Parameters<typeof directoryLoader>[0]),
		);
		expect(thrown).toBeInstanceOf(Response);
		expect((thrown as Response).status).toBe(302);
		expect((thrown as Response).headers.get("Location")).toBe("/admin/crm");
	});
});
