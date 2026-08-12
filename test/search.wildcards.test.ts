import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { getDb } from "../app/db";
import {
	evaluations,
	fields,
	forms,
	reviews,
	submissions,
	submissionTracks,
} from "../app/db/schema";
import { loader as planLoader } from "../app/routes/admin.evaluation.$planId";
import { loader as evalLoader } from "../app/routes/admin.evaluation";
import { loader as formEditorLoader } from "../app/routes/admin.forms.$formId";
import { loader as formsLoader } from "../app/routes/admin.forms";
import { loader as queueLoader } from "../app/routes/reviews";
import { apiJson, RAW_TOKENS, seedApiFixtures } from "./api-v1-fixtures";
import { CONTEXT_OF, seedEvalBase, sessionRequest } from "./eval-fixtures";

/**
 * `_` and `%` are LIKE wildcards. A speaker typing "check_in" or "100%" into a
 * search box means the characters, so every search predicate has to escape them
 * — the decoy rows below are exactly what an unescaped pattern drags in.
 */
const LITERAL = {
	underscore: {
		hit: "Session check_in kiosk",
		decoy: "Session check-in kiosk",
	},
	percent: { hit: "Reaching 100% Coverage", decoy: "Reaching 100 Tests" },
} as const;

const CONTEXT = CONTEXT_OF(env);

type Fn = (args: unknown) => Promise<unknown>;
const call = (fn: unknown, request: Request, params: object = {}) =>
	(fn as Fn)({ context: CONTEXT, request, params });

/** Four submissions on e1: a literal-character hit and its wildcard decoy, twice. */
async function seedWildcardSubmissions() {
	const db = getDb(env);
	await db.insert(submissions).values([
		{
			id: "w_us",
			eventId: "e1",
			title: LITERAL.underscore.hit,
			status: "pending",
		},
		{
			id: "w_us_decoy",
			eventId: "e1",
			title: LITERAL.underscore.decoy,
			status: "pending",
		},
		{
			id: "w_pc",
			eventId: "e1",
			title: LITERAL.percent.hit,
			status: "pending",
		},
		{
			id: "w_pc_decoy",
			eventId: "e1",
			title: LITERAL.percent.decoy,
			status: "pending",
		},
	]);
	return db;
}

const titlesOf = (rows: Array<{ title: string }>) => rows.map((r) => r.title);

describe("admin search boxes treat % and _ as literals", () => {
	it("forms list: an internal name with an underscore excludes the hyphen twin", async () => {
		await seedEvalBase(env, { withPlan: false });
		const db = getDb(env);
		await db.insert(forms).values([
			{ id: "f_us", eventId: "e1", internalName: "Speaker check_in form" },
			{ id: "f_decoy", eventId: "e1", internalName: "Speaker check-in form" },
			{ id: "f_pc", eventId: "e1", internalName: "Reaching 100% Coverage" },
			{
				id: "f_pc_decoy",
				eventId: "e1",
				externalTitle: "Reaching 100 Tests",
				internalName: "Other",
			},
		]);
		const underscore = (await call(
			formsLoader,
			await sessionRequest(
				env,
				"u_admin",
				"http://localhost/admin/forms?q=check_in",
			),
		)) as { data: { forms: Array<{ id: string }> } };
		expect(underscore.data.forms.map((f) => f.id)).toEqual(["f_us"]);

		const percent = (await call(
			formsLoader,
			await sessionRequest(
				env,
				"u_admin",
				`http://localhost/admin/forms?q=${encodeURIComponent("100%")}`,
			),
		)) as { data: { forms: Array<{ id: string }> } };
		expect(percent.data.forms.map((f) => f.id)).toEqual(["f_pc"]);
	});

	it("form editor field picker: the library search matches the literal name only", async () => {
		await seedEvalBase(env, { withPlan: false });
		const db = getDb(env);
		await db.insert(forms).values({
			id: "f1",
			eventId: "e1",
			internalName: "Session CFP",
		});
		await db.insert(fields).values([
			{ id: "fld_us", eventId: "e1", name: "check_in time", type: "text" },
			{ id: "fld_decoy", eventId: "e1", name: "check-in time", type: "text" },
		]);
		const result = (await call(
			formEditorLoader,
			await sessionRequest(
				env,
				"u_admin",
				"http://localhost/admin/forms/f1?pickerQ=check_in",
			),
			{ formId: "f1" },
		)) as { data: { libraryFields: Array<{ id: string }> } };
		expect(result.data.libraryFields.map((f) => f.id)).toEqual(["fld_us"]);
	});

	it("evaluation AI tab: the queue search excludes the wildcard decoy", async () => {
		await seedEvalBase(env, { withPlan: false });
		await seedWildcardSubmissions();
		const result = (await call(
			evalLoader,
			await sessionRequest(
				env,
				"u_admin",
				"http://localhost/admin/evaluation?tab=ai&q=check_in",
			),
		)) as { data: { ai: { rows: Array<{ title: string }>; total: number } } };
		expect(titlesOf(result.data.ai.rows)).toEqual([LITERAL.underscore.hit]);
		expect(result.data.ai.total).toBe(1);
	});

	it("evaluation decisions tab: the reviewed-submission search stays literal", async () => {
		await seedEvalBase(env, { withPlan: false });
		const db = await seedWildcardSubmissions();
		await db.insert(reviews).values([
			{
				id: "rv_us",
				submissionId: "w_us",
				reviewerId: "u_rev",
				decision: "approve",
			},
			{
				id: "rv_decoy",
				submissionId: "w_us_decoy",
				reviewerId: "u_rev",
				decision: "approve",
			},
		]);
		const result = (await call(
			evalLoader,
			await sessionRequest(
				env,
				"u_admin",
				"http://localhost/admin/evaluation?tab=decisions&q=check_in",
			),
		)) as {
			data: { decisions: { rows: Array<{ title: string }>; total: number } };
		};
		expect(titlesOf(result.data.decisions.rows)).toEqual([
			LITERAL.underscore.hit,
		]);
		expect(result.data.decisions.total).toBe(1);
	});

	it("plan assign tab: the candidate pool search stays literal", async () => {
		await seedEvalBase(env);
		await seedWildcardSubmissions();
		const result = (await call(
			planLoader,
			await sessionRequest(
				env,
				"u_admin",
				`http://localhost/admin/evaluation/plan1?tab=assign&q=${encodeURIComponent("100%")}`,
			),
			{ planId: "plan1" },
		)) as {
			data: {
				assign: { submissions: Array<{ title: string }>; total: number };
			};
		};
		expect(titlesOf(result.data.assign.submissions)).toEqual([
			LITERAL.percent.hit,
		]);
		expect(result.data.assign.total).toBe(1);
	});
});

describe("reviewer queue search treats % and _ as literals", () => {
	it("assigned and track tabs both exclude the wildcard decoy", async () => {
		await seedEvalBase(env);
		const db = await seedWildcardSubmissions();
		await db.insert(evaluations).values([
			{
				id: "ev_us",
				roundId: "r1",
				submissionId: "w_us",
				evaluatorId: "u_rev",
			},
			{
				id: "ev_decoy",
				roundId: "r1",
				submissionId: "w_us_decoy",
				evaluatorId: "u_rev",
			},
		]);
		await db.insert(submissionTracks).values([
			{ submissionId: "w_us", trackId: "t_ai" },
			{ submissionId: "w_us_decoy", trackId: "t_ai" },
		]);

		const assigned = (await call(
			queueLoader,
			await sessionRequest(
				env,
				"u_rev",
				"http://localhost/reviews?tab=assigned&q=check_in",
			),
		)) as {
			data: {
				assignedItems: { rows: Array<{ title: string }>; total: number };
			};
		};
		expect(titlesOf(assigned.data.assignedItems.rows)).toEqual([
			LITERAL.underscore.hit,
		]);
		expect(assigned.data.assignedItems.total).toBe(1);

		const tracks = (await call(
			queueLoader,
			await sessionRequest(
				env,
				"u_rev",
				"http://localhost/reviews?tab=tracks&q=check_in",
			),
		)) as {
			data: { trackItems: { rows: Array<{ title: string }>; total: number } };
		};
		expect(titlesOf(tracks.data.trackItems.rows)).toEqual([
			LITERAL.underscore.hit,
		]);
		expect(tracks.data.trackItems.total).toBe(1);
	});
});

describe("compat API session search treats % and _ as literals", () => {
	it("?search= matches the literal characters, not the wildcard expansion", async () => {
		await seedApiFixtures();
		const db = getDb(env);
		await db.insert(submissions).values([
			{
				id: "api_us",
				eventId: "e_a1",
				type: "session",
				title: LITERAL.underscore.hit,
				status: "accepted",
			},
			{
				id: "api_decoy",
				eventId: "e_a1",
				type: "session",
				title: LITERAL.underscore.decoy,
				status: "accepted",
			},
		]);
		const { json } = await apiJson<{ data: { id: string }[] }>(
			"/api/v1/event/e_a1/sessions?search=check_in",
			{ token: RAW_TOKENS.orgA },
		);
		expect(json.data.map((r) => r.id)).toEqual(["api_us"]);
	});
});
