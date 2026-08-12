import { env } from "cloudflare:test";
import { asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "../app/db";
import {
	events,
	fields,
	formats,
	formFields,
	forms,
	organizationMembers,
	organizations,
	submissions,
	users,
} from "../app/db/schema";
import { createSession, hashPassword } from "../app/lib/auth";
import { utcToZonedInputs, zonedTimeToUtc } from "../app/lib/forms";
import { sanitizeRichText } from "../app/lib/forms.server";
import { action, loader } from "../app/routes/admin.forms.$formId";
import { unwrap as unwrapData } from "./route-data";

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
		name: "DevOps Days Lyon 2027",
		slug: "devops-days-lyon-2027",
		timezone: "Europe/Paris",
	});
	await db
		.update(users)
		.set({ activeEventId: "e1" })
		.where(eq(users.id, "u_admin"));
	const setCookie = await createSession(env, "u_admin");
	return { db, cookie: setCookie.split(";")[0] ?? "" };
}

function actionArgs(
	formId: string,
	body: URLSearchParams,
	cookie: string,
): Parameters<typeof action>[0] {
	return {
		context: CONTEXT,
		request: new Request(`http://localhost/admin/forms/${formId}`, {
			method: "POST",
			body,
			headers: { Cookie: cookie },
		}),
		params: { formId },
	} as unknown as Parameters<typeof action>[0];
}

function loaderArgs(
	formId: string,
	cookie: string,
	search = "",
): Parameters<typeof loader>[0] {
	return {
		context: CONTEXT,
		request: new Request(`http://localhost/admin/forms/${formId}${search}`, {
			headers: { Cookie: cookie },
		}),
		params: { formId },
	} as unknown as Parameters<typeof loader>[0];
}

/** Runs an action expected to THROW a redirect; returns the Location header. */
async function expectRedirect(
	formId: string,
	body: URLSearchParams,
	cookie: string,
): Promise<string> {
	let thrown: unknown;
	try {
		await action(actionArgs(formId, body, cookie));
	} catch (e) {
		thrown = e;
	}
	expect(thrown).toBeInstanceOf(Response);
	const res = thrown as Response;
	expect(res.status).toBe(302);
	return res.headers.get("Location") ?? "";
}

async function createForm(cookie: string): Promise<string> {
	const location = await expectRedirect(
		"new",
		new URLSearchParams({ intent: "create" }),
		cookie,
	);
	return location.split("/").pop() ?? "";
}

type ActionResult = {
	ok?: string;
	created?: string;
	fieldErrors?: Record<string, string[]>;
	formError?: string;
};

// Non-redirect action results come wrapped by `data()` (Server-Timing rides
// on the wrapper) — unwrap to the payload the UI sees.
const unwrap = (result: unknown) => unwrapData<ActionResult>(result);

async function runAction(
	formId: string,
	body: Record<string, string>,
	cookie: string,
): Promise<ActionResult> {
	return unwrap(
		await action(actionArgs(formId, new URLSearchParams(body), cookie)),
	);
}

/** All SaveForm keys with scenario-shaped defaults; override per test. */
function saveFormBody(
	over: Record<string, string> = {},
	multi: Array<[string, string]> = [],
): URLSearchParams {
	const base: Record<string, string> = {
		intent: "save-form",
		type: "abstract",
		participantsStep: "true",
		internalName: "CFP 2027 – Main Call",
		externalTitle: "DevOps Days Lyon 2027 — Call for Proposals",
		pageHeading: "CFP Lyon 2027",
		welcomeHtml:
			'<p>Join us — <strong>we cover travel</strong>. Details at <a href="https://devopsdays-lyon.example.com">devopsdays-lyon.example.com</a>.</p>',
		showWelcome: "true",
		sessionSectionTitle: "",
		sessionSectionHtml: "",
		participantSectionTitle: "",
		participantSectionHtml: "",
		notifyExistingContacts: "true",
		roleSpeakerMin: "1",
		roleSpeakerMax: "4",
		allowChairperson: "true",
		roleChairpersonMin: "0",
		roleChairpersonMax: "1",
		allowModerator: "false",
		roleModeratorMin: "0",
		roleModeratorMax: "",
		closeDate: "2027-04-30",
		closeTime: "23:59",
		sendReminders: "true",
		submissionLimit: "3",
		allowMultipleDrafts: "true",
		autoRedirect: "true",
		successHtml:
			"<p>Merci! Your proposal is in — watch your inbox for the confirmation email and your speaker portal link.</p>",
		sendConfirmationEmail: "true",
		...over,
	};
	const body = new URLSearchParams(base);
	for (const [k, v] of multi) body.append(k, v);
	return body;
}

describe("form create", () => {
	it("mints the default built-in questions in Sessionboard order", async () => {
		const { db, cookie } = await seedBase();
		const formId = await createForm(cookie);
		expect(formId).toBeTruthy();

		const placed = await db
			.select()
			.from(formFields)
			.where(eq(formFields.formId, formId))
			.orderBy(asc(formFields.position));
		const session = placed.filter((p) => p.section === "session");
		const participant = placed.filter((p) => p.section === "participant");
		expect(session.map((p) => p.builtinRef)).toEqual([
			"title",
			"description",
			"format",
			"tags",
			"track",
			"level",
			"language",
		]);
		expect(participant.map((p) => p.builtinRef)).toEqual([
			"first_name",
			"last_name",
			"email",
			"mobile_phone",
			"biography",
		]);
		// Title is locked AND required; Format starts optional and removable.
		const title = session.find((p) => p.builtinRef === "title");
		expect(title?.locked).toBe(true);
		expect(title?.required).toBe(true);
		const format = session.find((p) => p.builtinRef === "format");
		expect(format?.locked).toBe(false);
		expect(format?.required).toBe(false);
	});
});

describe("editor loader", () => {
	it("404s on a form belonging to another event (row-level tenancy)", async () => {
		const { db, cookie } = await seedBase();
		await db.insert(organizations).values({ id: "org2", name: "Other" });
		await db.insert(events).values({
			id: "e2",
			organizationId: "org2",
			name: "Other",
			slug: "other",
		});
		await db
			.insert(forms)
			.values({ id: "f_other", eventId: "e2", internalName: "Foreign" });

		let thrown: unknown;
		try {
			await loader(loaderArgs("f_other", cookie));
		} catch (e) {
			thrown = e;
		}
		// `throw data(...)` throws a DataWithResponseInit, not a Response.
		const status =
			thrown instanceof Response
				? thrown.status
				: (thrown as { init?: { status?: number } })?.init?.status;
		expect(status).toBe(404);
	});

	it("keeps GETs read-only for pre-builder forms; the explicit initialize action places built-ins with customs after them", async () => {
		const { db, cookie } = await seedBase();
		// Shape of the seeded demo forms: custom placements only, positions 0/1.
		await db
			.insert(forms)
			.values({ id: "f_legacy", eventId: "e1", internalName: "Legacy" });
		await db.insert(fields).values([
			{
				id: "fld_a",
				eventId: "e1",
				name: "Experience",
				type: "dropdown",
				options: ["First time", "Experienced"],
			},
			{ id: "fld_b", eventId: "e1", name: "Notes", type: "textarea" },
		]);
		await db.insert(formFields).values([
			{
				id: "ff_a",
				formId: "f_legacy",
				fieldId: "fld_a",
				section: "session",
				position: 0,
				required: true,
			},
			{
				id: "ff_b",
				formId: "f_legacy",
				fieldId: "fld_b",
				section: "session",
				position: 1,
			},
		]);

		// A page load must never write — upgrading is an explicit action.
		await loader(loaderArgs("f_legacy", cookie));
		const afterLoad = await db
			.select()
			.from(formFields)
			.where(eq(formFields.formId, "f_legacy"));
		expect(afterLoad).toHaveLength(2);
		expect(afterLoad.every((p) => p.builtinRef === null)).toBe(true);

		const result = await runAction(
			"f_legacy",
			{ intent: "initialize-builtins" },
			cookie,
		);
		expect(result.ok).toBe("initialize-builtins");
		const after = await db
			.select()
			.from(formFields)
			.where(eq(formFields.formId, "f_legacy"))
			.orderBy(asc(formFields.position));
		const session = after.filter((p) => p.section === "session");
		expect(session.map((p) => p.builtinRef ?? p.fieldId)).toEqual([
			"title",
			"description",
			"format",
			"tags",
			"track",
			"level",
			"language",
			"fld_a",
			"fld_b",
		]);

		// Idempotent: running it again adds nothing and moves nothing.
		await runAction("f_legacy", { intent: "initialize-builtins" }, cookie);
		const again = await db
			.select()
			.from(formFields)
			.where(eq(formFields.formId, "f_legacy"));
		expect(again.length).toBe(after.length);
	});

	it("scopes the field-library picker to this event + this org's org-wide fields", async () => {
		const { db, cookie } = await seedBase();
		await db.insert(organizations).values({ id: "org2", name: "Other" });
		await db.insert(events).values({
			id: "e2",
			organizationId: "org2",
			name: "Other",
			slug: "other",
		});
		const formId = await createForm(cookie);
		await db.insert(fields).values([
			{
				id: "f_own_event",
				eventId: "e1",
				name: "Own event field",
				type: "text",
			},
			{
				id: "f_own_org",
				organizationId: "org1",
				name: "Own org field",
				type: "text",
			},
			{
				id: "f_own_contact",
				organizationId: "org1",
				recordType: "contact",
				name: "Dietary requirements",
				type: "text",
			},
			{
				id: "f_other_event",
				eventId: "e2",
				name: "Other event field",
				type: "text",
			},
			{
				id: "f_other_org",
				organizationId: "org2",
				name: "Other org field",
				type: "text",
			},
		]);

		await db.insert(formFields).values({
			id: "ff_own_contact",
			formId,
			fieldId: "f_own_contact",
			section: "session",
			position: 99,
		});

		const result = (await loader(loaderArgs(formId, cookie))) as unknown as {
			data: {
				libraryFields: Array<{ id: string }>;
				placements: Array<{ fieldId: string | null }>;
			};
		};
		const ids = result.data.libraryFields.map((f) => f.id).sort();
		expect(ids).toEqual(["f_own_event", "f_own_org"]);
		expect(
			result.data.placements.map((placement) => placement.fieldId),
		).not.toContain("f_own_contact");
	});

	it("lists ONLY the event's org members as notify recipients — never other orgs' admins", async () => {
		const { db, cookie } = await seedBase();
		// A second tenant with its own admin: must not leak into the picker.
		await db.insert(organizations).values({ id: "org2", name: "Other" });
		await db.insert(users).values({
			id: "u_other_admin",
			email: "other@test.co",
			passwordHash: await hashPassword("pw"),
			role: "admin",
		});
		await db.insert(organizationMembers).values({
			id: "om2",
			organizationId: "org2",
			userId: "u_other_admin",
		});
		const formId = await createForm(cookie);

		const result = (await loader(loaderArgs(formId, cookie))) as unknown as {
			data: { members: Array<{ id: string }> };
		};
		expect(result.data.members.map((m) => m.id)).toEqual(["u_admin"]);
	});
});

describe("save-form", () => {
	it("persists settings incl. an event-timezone close date and the notify config", async () => {
		const { db, cookie } = await seedBase();
		const formId = await createForm(cookie);
		const result = unwrap(
			await action(
				actionArgs(
					formId,
					saveFormBody({}, [
						["notifyNew", "u_admin"],
						["notifyUpdated", "u_admin"],
					]),
					cookie,
				),
			),
		);
		expect(result.ok).toBe("save-form");

		const [form] = await db.select().from(forms).where(eq(forms.id, formId));
		expect(form?.internalName).toBe("CFP 2027 – Main Call");
		expect(form?.pageHeading).toBe("CFP Lyon 2027");
		expect(form?.welcomeHtml).toContain("<strong>");
		expect(form?.welcomeHtml).toContain(
			'href="https://devopsdays-lyon.example.com"',
		);
		// 2027-04-30 23:59 wall-clock in Europe/Paris (CEST, UTC+2) is 21:59 UTC.
		expect(form?.closeAt?.getTime()).toBe(1809122340 * 1000);
		expect(form?.submissionLimit).toBe(3);
		expect(form?.allowMultipleDrafts).toBe(true);
		expect(form?.autoRedirect).toBe(true);
		expect(form?.successHtml).toContain("Merci!");
		expect(form?.config).toEqual({
			notify: { newSubmission: ["u_admin"], updatedSubmission: ["u_admin"] },
		});
	});

	it("saves when the UI omits the panels it never rendered", async () => {
		// A hidden panel posts nothing at all, so an absent key must land exactly
		// like a blank one — otherwise saving from a collapsed section fails.
		const { db, cookie } = await seedBase();
		const formId = await createForm(cookie);
		const body = saveFormBody({
			allowChairperson: "false",
			allowModerator: "false",
		});
		for (const key of [
			"roleChairpersonMax",
			"roleModeratorMax",
			"submissionLimit",
			"closeDate",
			"closeTime",
		]) {
			body.delete(key);
		}
		expect(unwrap(await action(actionArgs(formId, body, cookie))).ok).toBe(
			"save-form",
		);
		const [form] = await db.select().from(forms).where(eq(forms.id, formId));
		expect(form?.closeAt).toBeNull();
		expect(form?.submissionLimit).toBeNull();
	});

	it("treats a whitespace-only optional value as cleared, not as invalid", async () => {
		const { db, cookie } = await seedBase();
		const formId = await createForm(cookie);
		const result = unwrap(
			await action(
				actionArgs(
					formId,
					saveFormBody({
						closeDate: "   ",
						closeTime: " ",
						submissionLimit: "  ",
					}),
					cookie,
				),
			),
		);
		expect(result.fieldErrors).toBeUndefined();
		expect(result.ok).toBe("save-form");
		const [form] = await db.select().from(forms).where(eq(forms.id, formId));
		expect(form?.closeAt).toBeNull();
		expect(form?.submissionLimit).toBeNull();
	});

	it("round-trips the existing-contact participant notification policy when disabled", async () => {
		const { db, cookie } = await seedBase();
		const formId = await createForm(cookie);
		const result = unwrap(
			await action(
				actionArgs(
					formId,
					saveFormBody({ notifyExistingContacts: "false" }),
					cookie,
				),
			),
		);
		expect(result.ok).toBe("save-form");
		const [persisted] = await db
			.select({ notifyExistingContacts: forms.notifyExistingContacts })
			.from(forms)
			.where(eq(forms.id, formId));
		expect(persisted?.notifyExistingContacts).toBe(false);

		const loaded = (await loader(loaderArgs(formId, cookie))) as unknown as {
			data: { form: { notifyExistingContacts: boolean } };
		};
		expect(loaded.data.form.notifyExistingContacts).toBe(false);
	});

	it("rejects a 16-character page heading and persists nothing", async () => {
		const { db, cookie } = await seedBase();
		const formId = await createForm(cookie);
		const result = unwrap(
			await action(
				actionArgs(
					formId,
					saveFormBody({ pageHeading: "Call for Papers!" }),
					cookie,
				),
			),
		);
		expect(result.fieldErrors?.pageHeading?.[0]).toContain("15");
		const [form] = await db.select().from(forms).where(eq(forms.id, formId));
		expect(form?.pageHeading).toBe("");
		expect(form?.internalName).toBe("Untitled form");
	});

	it("rejects speaker min > max inline and saves nothing", async () => {
		const { db, cookie } = await seedBase();
		const formId = await createForm(cookie);
		const result = unwrap(
			await action(
				actionArgs(
					formId,
					saveFormBody({ roleSpeakerMin: "5", roleSpeakerMax: "4" }),
					cookie,
				),
			),
		);
		expect(result.fieldErrors?.roleSpeakerMin?.[0]).toMatch(/maximum/i);
		const [form] = await db.select().from(forms).where(eq(forms.id, formId));
		expect(form?.roleSpeakerMin).toBe(1);
		expect(form?.roleSpeakerMax).toBeNull();
	});

	it("accepts a PAST close date (the harness closes forms by backdating)", async () => {
		const { db, cookie } = await seedBase();
		const formId = await createForm(cookie);
		const result = unwrap(
			await action(
				actionArgs(
					formId,
					saveFormBody({ closeDate: "2020-01-01", closeTime: "00:00" }),
					cookie,
				),
			),
		);
		expect(result.ok).toBe("save-form");
		const [form] = await db.select().from(forms).where(eq(forms.id, formId));
		expect(form?.closeAt?.getTime()).toBeLessThan(Date.now());
	});

	it("rejects notify recipients outside the event's organization", async () => {
		const { db, cookie } = await seedBase();
		await db.insert(organizations).values({ id: "org2", name: "Other" });
		await db.insert(users).values({
			id: "u_other_admin",
			email: "other@test.co",
			passwordHash: await hashPassword("pw"),
			role: "admin",
		});
		await db.insert(organizationMembers).values({
			id: "om2",
			organizationId: "org2",
			userId: "u_other_admin",
		});
		const formId = await createForm(cookie);
		const result = unwrap(
			await action(
				actionArgs(
					formId,
					saveFormBody({}, [["notifyNew", "u_other_admin"]]),
					cookie,
				),
			),
		);
		expect(result.formError).toMatch(/members of this organization/i);
		const [form] = await db.select().from(forms).where(eq(forms.id, formId));
		expect(form?.config).toBeNull();
	});
});

describe("field library + create-field", () => {
	it("event scope sets eventId with organizationId NULL; org scope the inverse (the XOR)", async () => {
		const { db, cookie } = await seedBase();
		const formId = await createForm(cookie);

		const eventScoped = await runAction(
			formId,
			{
				intent: "create-field",
				name: "Key takeaway",
				type: "text",
				maxLength: "140",
				options: "",
				description: "",
				scope: "event",
				section: "session",
				required: "true",
			},
			cookie,
		);
		expect(eventScoped.ok).toBe("create-field");
		const [keyTakeaway] = await db
			.select()
			.from(fields)
			.where(eq(fields.name, "Key takeaway"));
		expect(keyTakeaway?.eventId).toBe("e1");
		expect(keyTakeaway?.organizationId).toBeNull();
		expect(keyTakeaway?.maxLength).toBe(140);
		const [placement] = await db
			.select()
			.from(formFields)
			.where(eq(formFields.fieldId, keyTakeaway?.id ?? ""));
		expect(placement?.required).toBe(true);
		expect(placement?.formId).toBe(formId);

		const orgScoped = await runAction(
			formId,
			{
				intent: "create-field",
				name: "T-shirt size",
				type: "dropdown",
				maxLength: "",
				options: "S, M, L",
				description: "",
				scope: "org",
				section: "session",
				required: "false",
			},
			cookie,
		);
		expect(orgScoped.ok).toBe("create-field");
		const [shirt] = await db
			.select()
			.from(fields)
			.where(eq(fields.name, "T-shirt size"));
		expect(shirt?.organizationId).toBe("org1");
		expect(shirt?.eventId).toBeNull();
		expect(shirt?.options).toEqual(["S", "M", "L"]);
	});

	// Regression: the panel only renders the maxLength/options inputs for the
	// types they apply to, so the browser POST OMITS those keys entirely. The
	// schema once required them to be present — every create silently no-oped
	// with a 200 + fieldErrors payload on inputs the UI never rendered.
	it("creates fields from the payload the panel ACTUALLY posts (absent options/maxLength keys)", async () => {
		const { db, cookie } = await seedBase();
		const formId = await createForm(cookie);

		// type=text renders no options input → no `options` key in the POST.
		const text = await runAction(
			formId,
			{
				intent: "create-field",
				name: "Dietary requirements",
				type: "text",
				maxLength: "",
				description: "",
				scope: "event",
				section: "session",
				required: "false",
			},
			cookie,
		);
		expect(text.ok).toBe("create-field");
		const [textRow] = await db
			.select()
			.from(fields)
			.where(eq(fields.name, "Dietary requirements"));
		expect(textRow?.eventId).toBe("e1");
		expect(textRow?.organizationId).toBeNull();
		const [textPlacement] = await db
			.select()
			.from(formFields)
			.where(eq(formFields.fieldId, textRow?.id ?? ""));
		expect(textPlacement?.formId).toBe(formId);

		// type=dropdown renders no maxLength input → no `maxLength` key.
		const dropdown = await runAction(
			formId,
			{
				intent: "create-field",
				name: "Audience level",
				type: "dropdown",
				options: "Beginner, Advanced",
				description: "",
				scope: "event",
				section: "session",
				required: "false",
			},
			cookie,
		);
		expect(dropdown.ok).toBe("create-field");
		const [ddRow] = await db
			.select()
			.from(fields)
			.where(eq(fields.name, "Audience level"));
		expect(ddRow?.options).toEqual(["Beginner", "Advanced"]);
		expect(ddRow?.maxLength).toBeNull();

		// type=checkbox renders NEITHER input → both keys absent.
		const checkbox = await runAction(
			formId,
			{
				intent: "create-field",
				name: "Needs AV setup",
				type: "checkbox",
				description: "",
				scope: "org",
				section: "session",
				required: "false",
			},
			cookie,
		);
		expect(checkbox.ok).toBe("create-field");
		const [cbRow] = await db
			.select()
			.from(fields)
			.where(eq(fields.name, "Needs AV setup"));
		expect(cbRow?.organizationId).toBe("org1");
		expect(cbRow?.eventId).toBeNull();
	});

	it("a validation failure surfaces in the returned payload and persists nothing (never a silent 200)", async () => {
		const { db, cookie } = await seedBase();
		const formId = await createForm(cookie);
		const result = await runAction(
			formId,
			{
				intent: "create-field",
				name: "   ",
				type: "text",
				maxLength: "",
				description: "",
				scope: "event",
				section: "session",
				required: "false",
			},
			cookie,
		);
		expect(result.ok).toBeUndefined();
		expect(result.fieldErrors?.name?.[0]).toBe("Name is required");
		const rows = await db.select().from(fields).where(eq(fields.eventId, "e1"));
		expect(rows).toHaveLength(0);
	});

	it("a dropdown without options is rejected with a field error", async () => {
		const { cookie } = await seedBase();
		const formId = await createForm(cookie);
		const result = await runAction(
			formId,
			{
				intent: "create-field",
				name: "Broken dropdown",
				type: "dropdown",
				maxLength: "",
				options: "  ",
				description: "",
				scope: "event",
				section: "session",
				required: "false",
			},
			cookie,
		);
		expect(result.fieldErrors?.options?.[0]).toBeTruthy();
	});

	it("refuses to place another tenant's field even with a valid id (cross-org denial)", async () => {
		const { db, cookie } = await seedBase();
		await db.insert(organizations).values({ id: "org2", name: "Other" });
		await db.insert(fields).values({
			id: "f_foreign",
			organizationId: "org2",
			name: "Foreign",
			type: "text",
		});
		const formId = await createForm(cookie);

		const result = await runAction(
			formId,
			{ intent: "add-library", fieldId: "f_foreign", section: "session" },
			cookie,
		);
		expect(result.formError).toBeTruthy();
		const rows = await db
			.select()
			.from(formFields)
			.where(eq(formFields.fieldId, "f_foreign"));
		expect(rows).toHaveLength(0);
	});

	it("reuses a library field as the SAME row (no duplicate definition) and blocks double placement", async () => {
		const { db, cookie } = await seedBase();
		await db.insert(fields).values({
			id: "f_arrival",
			eventId: "e1",
			name: "Earliest arrival date",
			type: "date",
		});
		const formId = await createForm(cookie);

		const first = await runAction(
			formId,
			{ intent: "add-library", fieldId: "f_arrival", section: "session" },
			cookie,
		);
		expect(first.ok).toBe("add-library");
		const again = await runAction(
			formId,
			{ intent: "add-library", fieldId: "f_arrival", section: "session" },
			cookie,
		);
		expect(again.formError).toMatch(/already on this form/i);
		const defs = await db
			.select()
			.from(fields)
			.where(eq(fields.name, "Earliest arrival date"));
		expect(defs).toHaveLength(1);
	});
});

describe("placement config", () => {
	it("Title's required state cannot be toggled off; Description's can", async () => {
		const { db, cookie } = await seedBase();
		const formId = await createForm(cookie);
		const placed = await db
			.select()
			.from(formFields)
			.where(eq(formFields.formId, formId));
		const title = placed.find((p) => p.builtinRef === "title");
		const description = placed.find((p) => p.builtinRef === "description");

		const denied = await runAction(
			formId,
			{
				intent: "set-required",
				formFieldId: title?.id ?? "",
				required: "false",
			},
			cookie,
		);
		expect(denied.formError).toBeTruthy();
		const [titleAfter] = await db
			.select()
			.from(formFields)
			.where(eq(formFields.id, title?.id ?? ""));
		expect(titleAfter?.required).toBe(true);

		const allowed = await runAction(
			formId,
			{
				intent: "set-required",
				formFieldId: description?.id ?? "",
				required: "false",
			},
			cookie,
		);
		expect(allowed.ok).toBe("set-required");
		const [descAfter] = await db
			.select()
			.from(formFields)
			.where(eq(formFields.id, description?.id ?? ""));
		expect(descAfter?.required).toBe(false);
	});

	it("locked rows can't be removed; removing a trigger clears rules that depend on it", async () => {
		const { db, cookie } = await seedBase();
		const formId = await createForm(cookie);
		await runAction(
			formId,
			{
				intent: "create-field",
				name: "Audience level",
				type: "dropdown",
				maxLength: "",
				options: "Beginner, Intermediate, Advanced",
				description: "",
				scope: "event",
				section: "session",
				required: "false",
			},
			cookie,
		);
		await runAction(
			formId,
			{
				intent: "create-field",
				name: "Assumed knowledge",
				type: "text",
				maxLength: "",
				options: "",
				description: "",
				scope: "event",
				section: "session",
				required: "false",
			},
			cookie,
		);
		const placed = await db.query.formFields.findMany({
			where: eq(formFields.formId, formId),
			with: { field: true },
		});
		const trigger = placed.find((p) => p.field?.name === "Audience level");
		const target = placed.find((p) => p.field?.name === "Assumed knowledge");
		const title = placed.find((p) => p.builtinRef === "title");

		const lockedDenied = await runAction(
			formId,
			{ intent: "remove-field", formFieldId: title?.id ?? "" },
			cookie,
		);
		expect(lockedDenied.formError).toMatch(/locked/i);

		const ruleSet = await runAction(
			formId,
			{
				intent: "set-rule",
				formFieldId: target?.id ?? "",
				trigger: `field:${trigger?.fieldId}`,
				operator: "equals",
				value: "Advanced",
			},
			cookie,
		);
		expect(ruleSet.ok).toBe("set-rule");

		const removed = await runAction(
			formId,
			{ intent: "remove-field", formFieldId: trigger?.id ?? "" },
			cookie,
		);
		expect(removed.ok).toBe("remove-field");
		const [targetAfter] = await db
			.select()
			.from(formFields)
			.where(eq(formFields.id, target?.id ?? ""));
		// A rule pointing at a removed question would silently never fire.
		expect(targetAfter?.questionRule).toBeNull();
	});

	it("persists a drag order and rejects an order containing foreign rows", async () => {
		const { db, cookie } = await seedBase();
		const formId = await createForm(cookie);
		await runAction(
			formId,
			{
				intent: "create-field",
				name: "Key takeaway",
				type: "text",
				maxLength: "140",
				options: "",
				description: "",
				scope: "event",
				section: "session",
				required: "true",
			},
			cookie,
		);
		const placed = await db.query.formFields.findMany({
			where: eq(formFields.formId, formId),
			with: { field: true },
		});
		const session = placed
			.filter((p) => p.section === "session")
			.sort((a, b) => a.position - b.position);
		const byRef = (ref: string) =>
			session.find((p) => p.builtinRef === ref)?.id ?? "";
		const custom =
			session.find((p) => p.field?.name === "Key takeaway")?.id ?? "";
		// Scenario order: Title, Description, Key takeaway, Format, rest.
		const desired = [
			byRef("title"),
			byRef("description"),
			custom,
			byRef("format"),
			byRef("tags"),
			byRef("track"),
			byRef("level"),
			byRef("language"),
		];
		const result = await runAction(
			formId,
			{ intent: "reorder", section: "session", order: desired.join(",") },
			cookie,
		);
		expect(result.ok).toBe("reorder");
		const after = await db
			.select()
			.from(formFields)
			.where(eq(formFields.formId, formId))
			.orderBy(asc(formFields.position));
		expect(
			after.filter((p) => p.section === "session").map((p) => p.id),
		).toEqual(desired);

		const rejected = await runAction(
			formId,
			{
				intent: "reorder",
				section: "session",
				order: [...desired.slice(0, -1), "ff_not_yours"].join(","),
			},
			cookie,
		);
		expect(rejected.formError).toBeTruthy();
	});
});

describe("question rules", () => {
	it("persists a built-in Format trigger in the schema's trigger-union shape", async () => {
		const { db, cookie } = await seedBase();
		await db.insert(formats).values({
			id: "fmt_workshop",
			eventId: "e1",
			name: "Workshop (120 min)",
		});
		const formId = await createForm(cookie);
		await runAction(
			formId,
			{
				intent: "create-field",
				name: "Workshop prerequisites",
				type: "textarea",
				maxLength: "1000",
				options: "",
				description: "",
				scope: "event",
				section: "session",
				required: "true",
			},
			cookie,
		);
		const placed = await db.query.formFields.findMany({
			where: eq(formFields.formId, formId),
			with: { field: true },
		});
		const target = placed.find(
			(p) => p.field?.name === "Workshop prerequisites",
		);

		const result = await runAction(
			formId,
			{
				intent: "set-rule",
				formFieldId: target?.id ?? "",
				trigger: "builtin:format",
				operator: "equals",
				value: "fmt_workshop",
			},
			cookie,
		);
		expect(result.ok).toBe("set-rule");
		const [after] = await db
			.select()
			.from(formFields)
			.where(eq(formFields.id, target?.id ?? ""));
		expect(after?.questionRule).toEqual({
			trigger: { kind: "builtin", ref: "format" },
			operator: "equals",
			value: "fmt_workshop",
		});
	});

	it("rejects a rule whose value is not one of the trigger's options", async () => {
		const { db, cookie } = await seedBase();
		await db.insert(formats).values({
			id: "fmt_talk",
			eventId: "e1",
			name: "Talk (30 min)",
		});
		const formId = await createForm(cookie);
		await runAction(
			formId,
			{
				intent: "create-field",
				name: "Target",
				type: "text",
				maxLength: "",
				options: "",
				description: "",
				scope: "event",
				section: "session",
				required: "false",
			},
			cookie,
		);
		const placed = await db.query.formFields.findMany({
			where: eq(formFields.formId, formId),
			with: { field: true },
		});
		const target = placed.find((p) => p.field?.name === "Target");

		const badValue = await runAction(
			formId,
			{
				intent: "set-rule",
				formFieldId: target?.id ?? "",
				trigger: "builtin:format",
				operator: "equals",
				value: "fmt_of_another_event",
			},
			cookie,
		);
		expect(badValue.formError).toBeTruthy();
		const [after] = await db
			.select()
			.from(formFields)
			.where(eq(formFields.id, target?.id ?? ""));
		expect(after?.questionRule).toBeNull();
	});

	it("rejects a text-type field as a trigger (only dropdown/checkbox/number can drive rules)", async () => {
		const { db, cookie } = await seedBase();
		const formId = await createForm(cookie);
		await runAction(
			formId,
			{
				intent: "create-field",
				name: "Free text",
				type: "text",
				maxLength: "",
				options: "",
				description: "",
				scope: "event",
				section: "session",
				required: "false",
			},
			cookie,
		);
		await runAction(
			formId,
			{
				intent: "create-field",
				name: "Target",
				type: "text",
				maxLength: "",
				options: "",
				description: "",
				scope: "event",
				section: "session",
				required: "false",
			},
			cookie,
		);
		const placed = await db.query.formFields.findMany({
			where: eq(formFields.formId, formId),
			with: { field: true },
		});
		const freeText = placed.find((p) => p.field?.name === "Free text");
		const target = placed.find((p) => p.field?.name === "Target");

		const result = await runAction(
			formId,
			{
				intent: "set-rule",
				formFieldId: target?.id ?? "",
				trigger: `field:${freeText?.fieldId}`,
				operator: "equals",
				value: "anything",
			},
			cookie,
		);
		expect(result.formError).toMatch(/dropdown, checkbox or number/i);
	});
});

describe("publish / duplicate / delete", () => {
	it("publish flips status to open", async () => {
		const { db, cookie } = await seedBase();
		const formId = await createForm(cookie);
		const [before] = await db.select().from(forms).where(eq(forms.id, formId));
		expect(before?.status).toBe("draft");
		const result = await runAction(formId, { intent: "publish" }, cookie);
		expect(result.ok).toBe("publish");
		const [after] = await db.select().from(forms).where(eq(forms.id, formId));
		expect(after?.status).toBe("open");
	});

	it("duplicate copies fields AND rules under a new public URL with zero submissions", async () => {
		const { db, cookie } = await seedBase();
		await db.insert(formats).values({
			id: "fmt_ws",
			eventId: "e1",
			name: "Workshop (120 min)",
		});
		const formId = await createForm(cookie);
		await runAction(
			formId,
			{
				intent: "create-field",
				name: "Workshop prerequisites",
				type: "textarea",
				maxLength: "1000",
				options: "",
				description: "",
				scope: "event",
				section: "session",
				required: "true",
			},
			cookie,
		);
		const placed = await db.query.formFields.findMany({
			where: eq(formFields.formId, formId),
			with: { field: true },
		});
		const target = placed.find(
			(p) => p.field?.name === "Workshop prerequisites",
		);
		await runAction(
			formId,
			{
				intent: "set-rule",
				formFieldId: target?.id ?? "",
				trigger: "builtin:format",
				operator: "equals",
				value: "fmt_ws",
			},
			cookie,
		);
		await db.insert(submissions).values({
			id: "s1",
			eventId: "e1",
			formId,
			title: "Postmortems people actually read",
			status: "pending",
		});

		await expectRedirect(
			formId,
			new URLSearchParams({ intent: "duplicate" }),
			cookie,
		);

		const all = await db.select().from(forms);
		const copy = all.find((f) => f.id !== formId);
		const [original] = await db
			.select()
			.from(forms)
			.where(eq(forms.id, formId));
		expect(copy?.internalName).toBe("Copy of Untitled form");
		expect(copy?.status).toBe("draft");
		expect(copy?.publicId).not.toBe(original?.publicId);

		const copyPlacements = await db
			.select()
			.from(formFields)
			.where(eq(formFields.formId, copy?.id ?? ""));
		const originalPlacements = await db
			.select()
			.from(formFields)
			.where(eq(formFields.formId, formId));
		expect(copyPlacements.length).toBe(originalPlacements.length);
		const copiedRule = copyPlacements.find((p) => p.questionRule != null);
		expect(copiedRule?.questionRule).toEqual({
			trigger: { kind: "builtin", ref: "format" },
			operator: "equals",
			value: "fmt_ws",
		});

		const copySubs = await db
			.select()
			.from(submissions)
			.where(eq(submissions.formId, copy?.id ?? ""));
		expect(copySubs).toHaveLength(0);
		const originalSubs = await db
			.select()
			.from(submissions)
			.where(eq(submissions.formId, formId));
		expect(originalSubs).toHaveLength(1);
	});

	it("delete removes the form + placements + its per-use layout rows but keeps submissions (unlinked)", async () => {
		const { db, cookie } = await seedBase();
		const formId = await createForm(cookie);
		await runAction(
			formId,
			{
				intent: "add-layout",
				kind: "section_header",
				label: "Logistics",
				section: "session",
			},
			cookie,
		);
		await db.insert(submissions).values({
			id: "s1",
			eventId: "e1",
			formId,
			title: "Kept",
			status: "accepted",
		});

		await expectRedirect(
			formId,
			new URLSearchParams({ intent: "delete" }),
			cookie,
		);

		expect(await db.select().from(forms)).toHaveLength(0);
		expect(
			await db.select().from(formFields).where(eq(formFields.formId, formId)),
		).toHaveLength(0);
		// Per-use layout rows must not pile up invisibly after a form delete.
		expect(
			await db.select().from(fields).where(eq(fields.name, "Logistics")),
		).toHaveLength(0);
		const [sub] = await db
			.select()
			.from(submissions)
			.where(eq(submissions.id, "s1"));
		expect(sub?.title).toBe("Kept");
		expect(sub?.formId).toBeNull();
	});

	it("duplicated layout rows are independent — removing one never touches the other form", async () => {
		const { db, cookie } = await seedBase();
		const formId = await createForm(cookie);
		await runAction(
			formId,
			{
				intent: "add-layout",
				kind: "section_header",
				label: "Logistics",
				section: "session",
			},
			cookie,
		);
		await expectRedirect(
			formId,
			new URLSearchParams({ intent: "duplicate" }),
			cookie,
		);
		const all = await db.select().from(forms);
		const copy = all.find((f) => f.id !== formId);
		const copyPlacements = await db.query.formFields.findMany({
			where: eq(formFields.formId, copy?.id ?? ""),
			with: { field: true },
		});
		const copyHeader = copyPlacements.find(
			(p) => p.field?.type === "section_header",
		);
		const origPlacements = await db.query.formFields.findMany({
			where: eq(formFields.formId, formId),
			with: { field: true },
		});
		const origHeader = origPlacements.find(
			(p) => p.field?.type === "section_header",
		);
		expect(copyHeader).toBeTruthy();
		expect(copyHeader?.fieldId).not.toBe(origHeader?.fieldId);

		const removed = await runAction(
			copy?.id ?? "",
			{ intent: "remove-field", formFieldId: copyHeader?.id ?? "" },
			cookie,
		);
		expect(removed.ok).toBe("remove-field");
		const origAfter = await db.query.formFields.findMany({
			where: eq(formFields.formId, formId),
			with: { field: true },
		});
		expect(
			origAfter.some(
				(p) =>
					p.field?.type === "section_header" && p.field.name === "Logistics",
			),
		).toBe(true);
	});
});

describe("write-boundary sanitization", () => {
	it("strips scripts, event handlers and javascript: hrefs from stored rich text", async () => {
		const { db, cookie } = await seedBase();
		const formId = await createForm(cookie);
		const result = unwrap(
			await action(
				actionArgs(
					formId,
					saveFormBody({
						welcomeHtml:
							'<p onclick="steal()">Hi <strong>there</strong> <a href="javascript:evil()">bad</a> <a href="https://ok.example.com">good</a></p><script>alert(1)</script>',
					}),
					cookie,
				),
			),
		);
		expect(result.ok).toBe("save-form");
		const [form] = await db.select().from(forms).where(eq(forms.id, formId));
		const html = form?.welcomeHtml ?? "";
		expect(html).not.toContain("<script");
		expect(html).not.toContain("alert(1)");
		expect(html).not.toContain("onclick");
		expect(html).not.toContain("javascript:");
		expect(html).toContain("<strong>there</strong>");
		expect(html).toContain('href="https://ok.example.com"');
	});

	it("keeps the shared editor's own output intact", async () => {
		const clean =
			'<p>Join us — <strong>we cover travel</strong>. Details at <a href="https://devopsdays-lyon.example.com" rel="noopener noreferrer">the site</a>.</p><ul><li>One</li></ul>';
		expect(await sanitizeRichText(clean)).toBe(clean);
	});
});

describe("stale notify recipients", () => {
	it("drops recipients who left the org instead of bricking every save", async () => {
		const { db, cookie } = await seedBase();
		const formId = await createForm(cookie);
		// A second org member is the stored recipient — auth is membership-aware,
		// so the ACTING admin must keep their own membership to stay signed in.
		await db.insert(users).values({
			id: "u_leaver",
			email: "leaver@test.co",
			passwordHash: await hashPassword("pw"),
			role: "admin",
		});
		await db.insert(organizationMembers).values({
			id: "om_leaver",
			organizationId: "org1",
			userId: "u_leaver",
		});
		await action(
			actionArgs(formId, saveFormBody({}, [["notifyNew", "u_leaver"]]), cookie),
		);
		// The recipient leaves the organization; their stored id must not come
		// back as an unremovable hidden selection.
		await db
			.delete(organizationMembers)
			.where(eq(organizationMembers.id, "om_leaver"));
		const result = (await loader(loaderArgs(formId, cookie))) as unknown as {
			data: { notify: { newSubmission: string[] } };
		};
		expect(result.data.notify.newSubmission).toEqual([]);
	});
});

describe("event-timezone close dates", () => {
	it("round-trips a wall-clock entry through the event timezone", () => {
		// 2027-04-30 23:59 in Europe/Paris (CEST, UTC+2) is 21:59:00Z.
		const utc = zonedTimeToUtc("2027-04-30", "23:59", "Europe/Paris");
		expect(utc.getTime()).toBe(1809122340 * 1000);
		expect(utcToZonedInputs(utc, "Europe/Paris")).toEqual({
			date: "2027-04-30",
			time: "23:59",
		});
	});

	it("handles a winter (CET, non-DST) date distinctly from summer", () => {
		const winter = zonedTimeToUtc("2027-01-15", "12:00", "Europe/Paris");
		expect(winter.toISOString()).toBe("2027-01-15T11:00:00.000Z");
		const summer = zonedTimeToUtc("2027-07-15", "12:00", "Europe/Paris");
		expect(summer.toISOString()).toBe("2027-07-15T10:00:00.000Z");
	});
});
