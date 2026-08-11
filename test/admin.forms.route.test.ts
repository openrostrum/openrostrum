import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { getDb } from "../app/db";
import {
	events,
	forms,
	organizationMembers,
	organizations,
	submissions,
	users,
} from "../app/db/schema";
import { createSession, hashPassword } from "../app/lib/auth";
import {
	effectiveFormStatus,
	placementMissingOptions,
	questionRuleValueAvailable,
	ruleApplyDisabled,
} from "../app/lib/forms";
import { loader } from "../app/routes/admin.forms";

const CONTEXT = { cloudflare: { env, ctx: {} } };

async function seedBase() {
	const db = getDb(env);
	await db.insert(users).values({
		id: "u_admin",
		email: "admin@test.co",
		passwordHash: await hashPassword("pw"),
		role: "admin",
	});
	await db.insert(organizations).values({ id: "org1", name: "Org" });
	await db.insert(organizationMembers).values({
		id: "om1",
		organizationId: "org1",
		userId: "u_admin",
	});
	await db.insert(events).values({
		id: "e1",
		organizationId: "org1",
		name: "E",
		slug: "e",
		timezone: "Europe/Paris",
	});
	const setCookie = await createSession(env, "u_admin");
	return { db, cookie: setCookie.split(";")[0] ?? "" };
}

async function runLoader(url: string, cookie: string) {
	const headers = new Headers({ Cookie: cookie });
	return (await loader({
		context: CONTEXT,
		request: new Request(url, { headers }),
		params: {},
	} as unknown as Parameters<typeof loader>[0])) as unknown as {
		data: {
			forms: Array<{
				id: string;
				internalName: string;
				status: string;
				submissionsCount: number;
				draftsCount: number;
			}>;
			tabCounts: { all: number; open: number; closed: number; draft: number };
		};
	};
}

describe("admin forms list", () => {
	it("lists only the active event's forms, with submission/draft counts split", async () => {
		const { db, cookie } = await seedBase();
		await db.insert(organizations).values({ id: "org2", name: "Other" });
		await db.insert(events).values({
			id: "e2",
			organizationId: "org2",
			name: "Other event",
			slug: "other",
		});
		await db.insert(forms).values([
			{ id: "f1", eventId: "e1", internalName: "Session CFP", status: "open" },
			{
				id: "f_other",
				eventId: "e2",
				internalName: "Foreign form",
				status: "open",
			},
		]);
		await db.insert(submissions).values([
			{ id: "s1", eventId: "e1", formId: "f1", title: "A", status: "pending" },
			{ id: "s2", eventId: "e1", formId: "f1", title: "B", status: "accepted" },
			{ id: "s3", eventId: "e1", formId: "f1", title: "C", status: "draft" },
		]);

		const result = await runLoader("http://localhost/admin/forms", cookie);
		expect(result.data.forms.map((f) => f.id)).toEqual(["f1"]);
		expect(result.data.forms[0]?.submissionsCount).toBe(2);
		expect(result.data.forms[0]?.draftsCount).toBe(1);
	});

	it("filters by search on internal AND external names", async () => {
		const { db, cookie } = await seedBase();
		await db.insert(forms).values([
			{ id: "f1", eventId: "e1", internalName: "Session CFP" },
			{ id: "f2", eventId: "e1", internalName: "Workshop CFP" },
			{
				id: "f3",
				eventId: "e1",
				internalName: "Internal name",
				externalTitle: "Workshop proposals",
			},
		]);
		const result = await runLoader(
			"http://localhost/admin/forms?q=workshop",
			cookie,
		);
		expect(result.data.forms.map((f) => f.id).sort()).toEqual(["f2", "f3"]);
	});

	it("shows an open form with a past close date as effectively closed", async () => {
		// The harness closes a CFP by backdating the close date — the list must
		// reflect that as Closed without any status flip.
		const { db, cookie } = await seedBase();
		await db.insert(forms).values({
			id: "f1",
			eventId: "e1",
			internalName: "Backdated",
			status: "open",
			closeAt: new Date("2020-01-01T00:00:00Z"),
		});
		const result = await runLoader("http://localhost/admin/forms", cookie);
		expect(result.data.forms[0]?.status).toBe("closed");
		expect(result.data.tabCounts.closed).toBe(1);
		expect(result.data.tabCounts.open).toBe(0);
	});
});

describe("effectiveFormStatus", () => {
	it("only an open status is affected by the close date", () => {
		const past = new Date(Date.now() - 1000);
		const future = new Date(Date.now() + 100000);
		expect(effectiveFormStatus("open", past, Date.now())).toBe("closed");
		expect(effectiveFormStatus("open", future, Date.now())).toBe("open");
		expect(effectiveFormStatus("open", null, Date.now())).toBe("open");
		expect(effectiveFormStatus("draft", past, Date.now())).toBe("draft");
	});
});

describe("ruleApplyDisabled", () => {
	it("blocks a valid rule while any mutation is pending", () => {
		expect(ruleApplyDisabled(false, "field:experience", true)).toBe(false);
		expect(ruleApplyDisabled(true, "field:experience", true)).toBe(true);
		expect(ruleApplyDisabled(false, "", true)).toBe(true);
		expect(ruleApplyDisabled(false, "field:experience", false)).toBe(true);
	});
});

describe("questionRuleValueAvailable", () => {
	const options = [
		{ value: "beginner", label: "Beginner" },
		{ value: "advanced", label: "Advanced" },
	];

	it("accepts only a current option for option-backed triggers", () => {
		expect(questionRuleValueAvailable("options", options, "advanced")).toBe(
			true,
		);
		expect(questionRuleValueAvailable("options", options, "removed")).toBe(
			false,
		);
		expect(questionRuleValueAvailable("options", [], "advanced")).toBe(false);
		expect(questionRuleValueAvailable("options", options, "")).toBe(false);
	});

	it("accepts only numeric conditions the action can persist", () => {
		expect(questionRuleValueAvailable("number", [], "0")).toBe(true);
		expect(questionRuleValueAvailable("number", [], "-1.5")).toBe(true);
		expect(questionRuleValueAvailable("number", [], "1e3")).toBe(false);
		expect(questionRuleValueAvailable("number", [], "advanced")).toBe(false);
		expect(questionRuleValueAvailable("number", [], "  ")).toBe(false);
	});
});

// An organizer who publishes before configuring taxonomies must SEE that the
// public wizard will omit the question — this warning is the only signal.
describe("placementMissingOptions", () => {
	const eventOptions = {
		format: [],
		tags: [],
		track: [{ value: "tr1", label: "Topic A" }],
		level: [],
		language: [{ value: "English", label: "English" }],
	};

	it("flags taxonomy built-ins exactly when the event has zero options", () => {
		const placed = (builtinRef: string) => ({ builtinRef, field: null });
		expect(placementMissingOptions(placed("format"), eventOptions)).toBe(true);
		expect(placementMissingOptions(placed("tags"), eventOptions)).toBe(true);
		expect(placementMissingOptions(placed("track"), eventOptions)).toBe(false);
		expect(placementMissingOptions(placed("language"), eventOptions)).toBe(
			false,
		);
		// Non-option built-ins (Title …) never warn.
		expect(placementMissingOptions(placed("title"), eventOptions)).toBe(false);
	});

	it("flags a library dropdown without options, never other field types", () => {
		const libRow = (type: string, options: string[] | null) => ({
			builtinRef: null,
			field: { type, options },
		});
		expect(placementMissingOptions(libRow("dropdown", []), eventOptions)).toBe(
			true,
		);
		expect(
			placementMissingOptions(libRow("dropdown", null), eventOptions),
		).toBe(true);
		expect(
			placementMissingOptions(libRow("dropdown", ["A"]), eventOptions),
		).toBe(false);
		expect(placementMissingOptions(libRow("text", null), eventOptions)).toBe(
			false,
		);
	});
});
