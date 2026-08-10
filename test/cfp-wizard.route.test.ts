import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "../app/db";
import {
	contacts,
	emailOutbox,
	fields,
	formFields,
	forms,
	participants,
	submissionAnswers,
	submissionRevisions,
	submissions,
	submissionTags,
	submissionTracks,
	tags,
	tracks,
} from "../app/db/schema";
import { resolveFormDefinition } from "../app/cfp/server";
import { action as sessionAction } from "../app/routes/submit.$eventSlug.$formId.step.session";
import { action as submitAction } from "../app/routes/submit.$eventSlug.$formId.step.review";
import {
	BASE_URL,
	CONTEXT,
	createSpeaker,
	FIX,
	FRESH,
	FRESH_BASE_URL,
	FRESH_PARAMS,
	jsonRequest,
	seedCfp,
	seedFreshCfp,
	selfRow,
	speakerRow,
	validValues,
} from "./cfp-helpers";

const PARAMS = { eventSlug: FIX.eventSlug, formId: FIX.formPublicId };
const WIZARD_ID = "11111111-2222-4333-8444-555555555555";

type DataResult = { data: Record<string, unknown>; init?: { status?: number } };

function callSession(cookie: string, body: unknown) {
	return sessionAction({
		context: CONTEXT,
		request: jsonRequest(`${BASE_URL}/step/session`, cookie, body),
		params: PARAMS,
	} as unknown as Parameters<typeof sessionAction>[0]);
}

function callSubmit(cookie: string, body: unknown) {
	return submitAction({
		context: CONTEXT,
		request: jsonRequest(`${BASE_URL}/step/review`, cookie, body),
		params: PARAMS,
	} as unknown as Parameters<typeof submitAction>[0]);
}

function submitBody(overrides: Partial<Record<string, unknown>> = {}) {
	return {
		intent: "submit",
		wizardId: WIZARD_ID,
		values: validValues(),
		participants: [selfRow()],
		...overrides,
	};
}

describe("CFP submit action", () => {
	it("creates submission + contact + participants + answers atomically, status pending, confirmation email with portal link", async () => {
		await seedCfp();
		const speaker = await createSpeaker();
		const db = getDb(env);

		const response = (await callSubmit(
			speaker.cookie,
			submitBody(),
		)) as Response;
		expect(response.status).toBe(302);
		expect(response.headers.get("Location")).toContain(
			`/step/success?sid=${WIZARD_ID}`,
		);

		const [row] = await db
			.select()
			.from(submissions)
			.where(eq(submissions.id, WIZARD_ID));
		expect(row?.status).toBe("pending");
		expect(row?.title).toBe("Evals in Production: Lessons from 40 Deployments");
		expect(row?.description).toContain("<strong>offline evals lie</strong>");
		expect(row?.formatId).toBe(FIX.formatId);
		expect(row?.language).toBe("English");
		expect(row?.eventId).toBe(FIX.eventId); // server-derived, never client-supplied

		const trackRows = await db
			.select()
			.from(submissionTracks)
			.where(eq(submissionTracks.submissionId, WIZARD_ID));
		expect(trackRows.map((t) => t.trackId)).toEqual([FIX.trackId]);

		const people = await db
			.select({
				role: participants.role,
				email: contacts.email,
				userId: contacts.userId,
				mobilePhone: contacts.mobilePhone,
			})
			.from(participants)
			.innerJoin(contacts, eq(contacts.id, participants.contactId))
			.where(eq(participants.submissionId, WIZARD_ID));
		expect(people).toHaveLength(1);
		expect(people[0]?.email).toBe("priya@example.com"); // self row uses the ACCOUNT email
		expect(people[0]?.userId).toBe(speaker.id);
		expect(people[0]?.mobilePhone).toBe("+1 415 555 0142");

		const [mail] = await db
			.select()
			.from(emailOutbox)
			.where(eq(emailOutbox.to, "priya@example.com"));
		expect(mail?.status).toBe("sent");
		expect(mail?.subject).toBe("We received your submission");
		expect(mail?.html).toContain("Priya"); // {{first_name}} merge tag rendered
		expect(mail?.html).toContain(
			`/portals/${FIX.eventSlug}/${FIX.portalPublicId}`,
		);
	});

	it("is double-submit safe: replaying the same wizardId neither duplicates the row nor re-sends the email", async () => {
		await seedCfp();
		const speaker = await createSpeaker();
		const db = getDb(env);

		const first = (await callSubmit(speaker.cookie, submitBody())) as Response;
		const second = (await callSubmit(speaker.cookie, submitBody())) as Response;
		expect(first.status).toBe(302);
		expect(second.status).toBe(302);

		expect(await db.select().from(submissions)).toHaveLength(1);
		expect(await db.select().from(emailOutbox)).toHaveLength(1);
	});

	it("rejects missing required fields — including a rule-SHOWN required field — and persists nothing", async () => {
		await seedCfp();
		const speaker = await createSpeaker();
		const db = getDb(env);

		// Experience = Experienced reveals the required notes field, left empty.
		const values = {
			...validValues(),
			b_title: "",
			f_fld_exp: "Experienced",
			f_fld_notes: "",
		};
		const result = (await callSubmit(
			speaker.cookie,
			submitBody({ values }),
		)) as unknown as DataResult;

		expect(result.init?.status).toBe(422);
		const fieldErrors = result.data.fieldErrors as Record<string, string>;
		expect(fieldErrors.b_title).toBeTruthy();
		expect(fieldErrors.f_fld_notes).toBeTruthy();
		expect(await db.select().from(submissions)).toHaveLength(0);
	});

	it("accepts the submission when the rule keeps the required field HIDDEN, and drops the stale hidden value", async () => {
		await seedCfp();
		const speaker = await createSpeaker();
		const db = getDb(env);

		// The speaker typed notes while "Experienced" was selected, then switched
		// back — the reviewed record shows no notes, so none may be stored.
		const values = {
			...validValues(),
			f_fld_exp: "First time",
			f_fld_notes: "stale text typed while the field was visible",
		};
		const response = (await callSubmit(
			speaker.cookie,
			submitBody({ values }),
		)) as Response;
		expect(response.status).toBe(302);

		const answers = await db.select().from(submissionAnswers);
		expect(answers.map((a) => a.fieldId)).toEqual([FIX.expFieldId]);
	});

	it("enforces role minimum and maximum server-side", async () => {
		await seedCfp({ roleSpeakerMin: 2, roleSpeakerMax: 4 });
		const speaker = await createSpeaker();
		const db = getDb(env);

		const tooFew = (await callSubmit(
			speaker.cookie,
			submitBody(),
		)) as unknown as DataResult;
		expect(tooFew.init?.status).toBe(422);
		expect(String(tooFew.data.participantErrors)).toContain("At least 2");

		const five = [
			selfRow(),
			speakerRow("b", "Dana", "Okafor", "dana@example.com"),
			speakerRow("c", "Pat", "Quinn", "pat@example.com"),
			speakerRow("d", "Sam", "Reyes", "sam@example.com"),
			speakerRow("e", "Extra", "Person", "extra@example.com"),
		];
		const tooMany = (await callSubmit(
			speaker.cookie,
			submitBody({ participants: five }),
		)) as unknown as DataResult;
		expect(tooMany.init?.status).toBe(422);
		expect(String(tooMany.data.participantErrors)).toContain("No more than 4");
		expect(await db.select().from(submissions)).toHaveLength(0);

		// 2 speakers + 1 secondary passes (secondary is uncounted).
		const valid = [
			selfRow(),
			speakerRow("b", "Dana", "Okafor", "dana@example.com"),
			{
				...speakerRow("s", "Leo", "Martins", "leo@example.com"),
				role: "secondary",
			},
		];
		const ok = (await callSubmit(
			speaker.cookie,
			submitBody({ participants: valid }),
		)) as Response;
		expect(ok.status).toBe(302);

		const people = await db
			.select({ role: participants.role, email: contacts.email })
			.from(participants)
			.innerJoin(contacts, eq(contacts.id, participants.contactId));
		expect(people).toHaveLength(3);
		expect(people.find((p) => p.email === "leo@example.com")?.role).toBe(
			"secondary",
		);
	});

	it("links co-speakers to EXISTING contacts by email without overwriting organizer data", async () => {
		await seedCfp();
		const speaker = await createSpeaker();
		const db = getDb(env);
		await db.insert(contacts).values({
			id: "c_dana",
			eventId: FIX.eventId,
			email: "dana@example.com",
			firstName: "Dana",
			lastName: "Okafor-Original",
		});

		const body = submitBody({
			participants: [
				selfRow(),
				speakerRow("b", "Dana", "Typo-Name", "Dana@Example.com"),
			],
		});
		const response = (await callSubmit(speaker.cookie, body)) as Response;
		expect(response.status).toBe(302);

		const rows = await db
			.select()
			.from(contacts)
			.where(eq(contacts.email, "dana@example.com"));
		expect(rows).toHaveLength(1); // matched by normalized email, no duplicate
		expect(rows[0]?.lastName).toBe("Okafor-Original"); // organizer data wins
		const linked = await db
			.select()
			.from(participants)
			.where(eq(participants.contactId, "c_dana"));
		expect(linked).toHaveLength(1);
	});
});

describe("submission limit", () => {
	it("counts drafts toward the limit and blocks the over-limit submit server-side", async () => {
		await seedCfp({ submissionLimit: 3, allowMultipleDrafts: true });
		const speaker = await createSpeaker();
		const db = getDb(env);

		await db.insert(submissions).values([
			{
				id: "s1",
				eventId: FIX.eventId,
				formId: FIX.formId,
				title: "Retrieval Beyond RAG",
				status: "pending",
				submitterId: speaker.id,
			},
			{
				id: "s2",
				eventId: FIX.eventId,
				formId: FIX.formId,
				title: "Guardrails that Scale",
				status: "draft",
				submitterId: speaker.id,
			},
			{
				id: "s3",
				eventId: FIX.eventId,
				formId: FIX.formId,
				title: "Fine-tuning on a Budget",
				status: "pending",
				submitterId: speaker.id,
			},
		]);

		const blocked = (await callSubmit(
			speaker.cookie,
			submitBody({
				values: { ...validValues(), b_title: "Sneaky Fourth Talk" },
			}),
		)) as unknown as DataResult;
		expect(blocked.init?.status).toBe(422);
		expect(String(blocked.data.formError)).toContain("limit of 3");

		const titles = (await db.select().from(submissions)).map((s) => s.title);
		expect(titles).not.toContain("Sneaky Fourth Talk");
	});

	it("frees the slot when a submission is withdrawn", async () => {
		await seedCfp({ submissionLimit: 1 });
		const speaker = await createSpeaker();
		const db = getDb(env);
		await db.insert(submissions).values({
			id: "s_w",
			eventId: FIX.eventId,
			formId: FIX.formId,
			title: "Withdrawn talk",
			status: "withdrawn",
			submitterId: speaker.id,
		});

		const response = (await callSubmit(
			speaker.cookie,
			submitBody(),
		)) as Response;
		expect(response.status).toBe(302);
	});

	it("does NOT re-count an existing draft being completed at the limit", async () => {
		await seedCfp({ submissionLimit: 1, allowMultipleDrafts: true });
		const speaker = await createSpeaker();
		const db = getDb(env);
		await db.insert(submissions).values({
			id: WIZARD_ID,
			eventId: FIX.eventId,
			formId: FIX.formId,
			title: "Draft occupying the only slot",
			status: "draft",
			submitterId: speaker.id,
		});

		const response = (await callSubmit(
			speaker.cookie,
			submitBody({ sid: WIZARD_ID }),
		)) as Response;
		expect(response.status).toBe(302);
		const [row] = await db
			.select()
			.from(submissions)
			.where(eq(submissions.id, WIZARD_ID));
		expect(row?.status).toBe("pending");
	});
});

describe("draft save", () => {
	it("saves with ONLY a title (validation applies to advance, never draft save)", async () => {
		await seedCfp();
		const speaker = await createSpeaker();
		const db = getDb(env);

		const result = (await callSession(speaker.cookie, {
			intent: "save-draft",
			wizardId: WIZARD_ID,
			values: { b_title: "Async Agents on the Edge" },
			participants: [],
		})) as unknown as DataResult;

		expect(result.data.ok).toBe(true);
		expect(result.data.sid).toBe(WIZARD_ID);
		const [row] = await db.select().from(submissions);
		expect(row?.status).toBe("draft");
		expect(row?.title).toBe("Async Agents on the Edge");
	});

	it("rejects a draft with no title and persists nothing", async () => {
		await seedCfp();
		const speaker = await createSpeaker();
		const db = getDb(env);

		const result = (await callSession(speaker.cookie, {
			intent: "save-draft",
			wizardId: WIZARD_ID,
			values: { b_description: "<p>body without title</p>" },
			participants: [],
		})) as unknown as DataResult;

		expect(result.init?.status).toBe(400);
		expect(
			(result.data.fieldErrors as Record<string, string>).b_title,
		).toBeTruthy();
		expect(await db.select().from(submissions)).toHaveLength(0);
	});

	it("resaving updates the SAME row (no duplicate minted by resuming)", async () => {
		await seedCfp();
		const speaker = await createSpeaker();
		const db = getDb(env);

		await callSession(speaker.cookie, {
			intent: "save-draft",
			wizardId: WIZARD_ID,
			values: { b_title: "Async Agents on the Edge" },
			participants: [],
		});
		await callSession(speaker.cookie, {
			intent: "save-draft",
			wizardId: WIZARD_ID,
			sid: WIZARD_ID,
			values: {
				b_title: "Async Agents on the Edge",
				b_description: "<p><strong>durable</strong> agents</p>",
			},
			participants: [],
		});

		const rows = await db.select().from(submissions);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.description).toContain("<strong>durable</strong>");
	});

	it("resolves two co-speakers sharing an email to ONE contact instead of failing the save", async () => {
		await seedCfp();
		const speaker = await createSpeaker();
		const db = getDb(env);

		const result = (await callSession(speaker.cookie, {
			intent: "save-draft",
			wizardId: WIZARD_ID,
			values: { b_title: "Panel with a duplicate email" },
			participants: [
				selfRow(),
				speakerRow("b", "Dana", "Okafor", "dana@example.com"),
				speakerRow("c", "Dana Again", "Okafor", "Dana@Example.com"),
			],
		})) as unknown as DataResult;
		expect(result.data.ok).toBe(true);

		const danaContacts = await db
			.select()
			.from(contacts)
			.where(eq(contacts.email, "dana@example.com"));
		expect(danaContacts).toHaveLength(1);
		const rows = await db
			.select()
			.from(participants)
			.where(eq(participants.submissionId, WIZARD_ID));
		expect(rows).toHaveLength(2); // self + one Dana
	});

	it("enforces the single-draft rule when multiple drafts are disabled", async () => {
		await seedCfp({ allowMultipleDrafts: false });
		const speaker = await createSpeaker();

		await callSession(speaker.cookie, {
			intent: "save-draft",
			wizardId: WIZARD_ID,
			values: { b_title: "Draft one" },
			participants: [],
		});
		const second = (await callSession(speaker.cookie, {
			intent: "save-draft",
			wizardId: "99999999-8888-4777-8666-555555555555",
			values: { b_title: "Draft two" },
			participants: [],
		})) as unknown as DataResult;

		expect(second.init?.status).toBe(422);
		expect(String(second.data.formError)).toContain(
			"already have a saved draft",
		);
	});

	it("deletes a draft (and only a draft) for its owner", async () => {
		await seedCfp();
		const speaker = await createSpeaker();
		const other = await createSpeaker("u_other", "other@example.com", "Other");
		const db = getDb(env);
		await callSession(speaker.cookie, {
			intent: "save-draft",
			wizardId: WIZARD_ID,
			values: { b_title: "Mine" },
			participants: [],
		});

		const foreign = (await callSession(other.cookie, {
			intent: "delete-draft",
			sid: WIZARD_ID,
		})) as unknown as DataResult;
		expect(foreign.init?.status).toBe(404);
		expect(await db.select().from(submissions)).toHaveLength(1);

		await callSession(speaker.cookie, {
			intent: "delete-draft",
			sid: WIZARD_ID,
		});
		expect(await db.select().from(submissions)).toHaveLength(0);
	});
});

describe("closed form", () => {
	it("rejects forged submits and draft saves after the close date, and reopens when the date moves forward", async () => {
		await seedCfp({ closeAt: new Date("2020-01-01T00:00:00Z") });
		const speaker = await createSpeaker();
		const db = getDb(env);

		const blockedSubmit = (await callSubmit(
			speaker.cookie,
			submitBody(),
		)) as unknown as DataResult;
		expect(blockedSubmit.init?.status).toBe(403);

		const blockedDraft = (await callSession(speaker.cookie, {
			intent: "save-draft",
			wizardId: WIZARD_ID,
			values: { b_title: "Too late" },
			participants: [],
		})) as unknown as DataResult;
		expect(blockedDraft.init?.status).toBe(403);
		expect(await db.select().from(submissions)).toHaveLength(0);

		// The close date is data-driven in both directions, not a one-way latch.
		await db
			.update(forms)
			.set({ closeAt: new Date("2027-09-15T23:59:00Z") })
			.where(eq(forms.id, FIX.formId));
		const reopened = (await callSubmit(
			speaker.cookie,
			submitBody(),
		)) as Response;
		expect(reopened.status).toBe(302);
	});
});

describe("edit until close", () => {
	it("lets the submitter edit a SUBMITTED proposal: same row updated, status kept, revision appended, no second email", async () => {
		await seedCfp();
		const speaker = await createSpeaker();
		const db = getDb(env);

		await callSubmit(speaker.cookie, submitBody());

		const edited = submitBody({
			sid: WIZARD_ID,
			values: {
				...validValues(),
				b_title: "Evals in Production (revised)",
			},
			participants: [
				selfRow(),
				speakerRow("b", "Dana", "Okafor", "dana@example.com"),
			],
		});
		const response = (await callSubmit(speaker.cookie, edited)) as Response;
		expect(response.status).toBe(302);
		expect(response.headers.get("Location")).toContain("updated=1");

		const rows = await db.select().from(submissions);
		expect(rows).toHaveLength(1); // organizer sees the same row, edited
		expect(rows[0]?.status).toBe("pending");
		expect(rows[0]?.title).toBe("Evals in Production (revised)");

		const revisions = await db.select().from(submissionRevisions);
		expect(revisions).toHaveLength(1);
		expect(revisions[0]?.editedById).toBe(speaker.id);

		expect(await db.select().from(emailOutbox)).toHaveLength(1); // only the original confirmation

		const people = await db
			.select({ email: contacts.email })
			.from(participants)
			.innerJoin(contacts, eq(contacts.id, participants.contactId))
			.where(eq(participants.submissionId, WIZARD_ID));
		expect(people.map((p) => p.email).sort()).toEqual([
			"dana@example.com",
			"priya@example.com",
		]);
	});

	it("preserves organizer-applied tags and tracks through a speaker edit", async () => {
		await seedCfp();
		const speaker = await createSpeaker();
		const db = getDb(env);
		await callSubmit(speaker.cookie, submitBody());

		// Organizer applies a second tag and a second track after submission.
		await db
			.insert(tags)
			.values({ id: "tag2", eventId: FIX.eventId, name: "Tag B" });
		await db
			.insert(tracks)
			.values({ id: "tr2", eventId: FIX.eventId, name: "Topic B" });
		await db
			.insert(submissionTags)
			.values({ submissionId: WIZARD_ID, tagId: "tag2" });
		await db
			.insert(submissionTracks)
			.values({ submissionId: WIZARD_ID, trackId: "tr2" });

		// The speaker edits the title; the wizard round-trips the loaded tag set
		// (both tags) and leaves the unchanged track selection alone.
		const response = (await callSubmit(
			speaker.cookie,
			submitBody({
				sid: WIZARD_ID,
				values: {
					...validValues(),
					b_title: "Edited without touching taxonomy",
					b_tags: `${FIX.tagId},tag2`,
				},
			}),
		)) as Response;
		expect(response.status).toBe(302);

		const tagRows = await db
			.select()
			.from(submissionTags)
			.where(eq(submissionTags.submissionId, WIZARD_ID));
		expect(tagRows.map((t) => t.tagId).sort()).toEqual(["tag1", "tag2"]);
		const trackRows = await db
			.select()
			.from(submissionTracks)
			.where(eq(submissionTracks.submissionId, WIZARD_ID));
		expect(trackRows.map((t) => t.trackId).sort()).toEqual(["tr1", "tr2"]);
	});

	it("refuses edits by anyone but the submitter", async () => {
		await seedCfp();
		const speaker = await createSpeaker();
		const other = await createSpeaker("u_other", "other@example.com", "Other");
		const db = getDb(env);
		await callSubmit(speaker.cookie, submitBody());

		const stolen = (await callSubmit(
			other.cookie,
			submitBody({
				sid: WIZARD_ID,
				values: { ...validValues(), b_title: "Hijacked" },
			}),
		)) as unknown as DataResult;
		expect(stolen.init?.status).toBe(403);
		const [row] = await db.select().from(submissions);
		expect(row?.title).not.toBe("Hijacked");
	});

	it("strips script content from speaker-authored rich text before it is stored", async () => {
		await seedCfp();
		const speaker = await createSpeaker();
		const db = getDb(env);

		const values = {
			...validValues(),
			b_description:
				'<p>fine</p><script>document.cookie</script><p onmouseover="x()">hover</p>',
		};
		const response = (await callSubmit(
			speaker.cookie,
			submitBody({ values }),
		)) as Response;
		expect(response.status).toBe(302);
		const [row] = await db.select().from(submissions);
		expect(row?.description).not.toContain("script");
		expect(row?.description).not.toContain("onmouseover");
		expect(row?.description).toContain("<p>fine</p>");
	});
});

// With zero taxonomies configured, the default form's required selects offer
// nothing to choose — draft save and submit must still work end to end.
describe("fresh event with zero taxonomies", () => {
	function callFreshSession(cookie: string, body: unknown) {
		return sessionAction({
			context: CONTEXT,
			request: jsonRequest(`${FRESH_BASE_URL}/step/session`, cookie, body),
			params: FRESH_PARAMS,
		} as unknown as Parameters<typeof sessionAction>[0]);
	}
	function callFreshSubmit(cookie: string, body: unknown) {
		return submitAction({
			context: CONTEXT,
			request: jsonRequest(`${FRESH_BASE_URL}/step/review`, cookie, body),
			params: FRESH_PARAMS,
		} as unknown as Parameters<typeof submitAction>[0]);
	}

	it("omits every option-backed built-in from the resolved definition", async () => {
		await seedFreshCfp();
		const db = getDb(env);
		const [form] = await db
			.select()
			.from(forms)
			.where(eq(forms.id, FRESH.formId));
		if (!form) throw new Error("fixture form missing");
		const definition = await resolveFormDefinition(db, form);
		// Default session set is Title/Description + the five taxonomy
		// dropdowns; with no options to offer, only the text questions remain.
		expect(definition.session.map((f) => f.key)).toEqual([
			"b_title",
			"b_description",
		]);
	});

	it("saves a draft with just a title", async () => {
		await seedFreshCfp();
		const speaker = await createSpeaker();
		const db = getDb(env);

		const result = (await callFreshSession(speaker.cookie, {
			intent: "save-draft",
			wizardId: WIZARD_ID,
			values: { b_title: "First talk on a fresh event" },
			participants: [],
		})) as unknown as DataResult;

		expect(result.data.ok).toBe(true);
		const [row] = await db.select().from(submissions);
		expect(row?.status).toBe("draft");
		expect(row?.eventId).toBe(FRESH.eventId);
	});

	it("accepts a submission carrying no taxonomy answers and the stale default language", async () => {
		await seedFreshCfp();
		const speaker = await createSpeaker();
		const db = getDb(env);

		const response = (await callFreshSubmit(speaker.cookie, {
			intent: "submit",
			wizardId: WIZARD_ID,
			values: {
				b_title: "Shipping without a taxonomy",
				b_description: "<p>The form must accept this.</p>",
				// A resumed draft round-trips the row's default language even
				// though the event has no language options configured.
				b_language: "English",
			},
			participants: [selfRow()],
		})) as Response;

		expect(response.status).toBe(302);
		expect(response.headers.get("Location")).toContain(
			`/step/success?sid=${WIZARD_ID}`,
		);
		const [row] = await db.select().from(submissions);
		expect(row?.status).toBe("pending");
		expect(row?.language).toBe("English");
		expect(row?.formatId).toBeNull();
	});

	it("a placed REQUIRED select with zero options never blocks the submit", async () => {
		await seedFreshCfp();
		const db = getDb(env);
		await db.insert(fields).values({
			id: "fld_empty_dd",
			eventId: FRESH.eventId,
			name: "Room preference",
			type: "dropdown",
			options: [],
		});
		await db.insert(formFields).values([
			{
				id: "ffr_title",
				formId: FRESH.formId,
				builtinRef: "title",
				section: "session",
				position: 0,
				required: true,
				locked: true,
			},
			{
				id: "ffr_track",
				formId: FRESH.formId,
				builtinRef: "track",
				section: "session",
				position: 1,
				required: true,
			},
			{
				id: "ffr_empty_dd",
				formId: FRESH.formId,
				fieldId: "fld_empty_dd",
				section: "session",
				position: 2,
				required: true,
			},
		]);
		const speaker = await createSpeaker();

		const response = (await callFreshSubmit(speaker.cookie, {
			intent: "submit",
			wizardId: WIZARD_ID,
			values: { b_title: "Required selects with nothing to select" },
			participants: [selfRow()],
		})) as Response;

		expect(response.status).toBe(302);
		const [row] = await db.select().from(submissions);
		expect(row?.status).toBe("pending");
		const trackRows = await db.select().from(submissionTracks);
		expect(trackRows).toHaveLength(0);
	});
});
