import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { getDb } from "../app/db";
import { events, forms, organizations, submissions } from "../app/db/schema";
import { loader as successLoader } from "../app/routes/submit.$eventSlug.$formId.step.success";
import { BASE_URL, CONTEXT, createSpeaker, FIX, seedCfp } from "./cfp-helpers";
import { catchThrown, thrownStatus } from "./thrown";

const PARAMS = { eventSlug: FIX.eventSlug, formId: FIX.formPublicId };

type LoaderArgs = Parameters<typeof successLoader>[0];

function successRequest(cookie: string, submissionId: string) {
	return new Request(`${BASE_URL}/step/success?sid=${submissionId}`, {
		headers: { Cookie: cookie },
	});
}

async function seedOwnedSubmission(
	id: string,
	eventId: string,
	formId: string,
	submitterId: string,
	title: string,
) {
	await getDb(env).insert(submissions).values({
		id,
		eventId,
		formId,
		submitterId,
		title,
		status: "pending",
	});
}

describe("CFP success route tenancy", () => {
	it("404s the signed-in user's submission from another organization's form", async () => {
		await seedCfp();
		const speaker = await createSpeaker();
		const db = getDb(env);
		await db.insert(organizations).values({ id: "org2", name: "Other Org" });
		await db.insert(events).values({
			id: "e2",
			organizationId: "org2",
			name: "Other Conf",
			slug: "other-conf",
		});
		await db.insert(forms).values({
			id: "f2",
			eventId: "e2",
			publicId: "form-uuid-2",
			type: "session",
			status: "open",
			internalName: "Other CFP",
			externalTitle: "Other Call for Sessions",
		});
		await seedOwnedSubmission(
			"s_foreign",
			"e2",
			"f2",
			speaker.id,
			"Other Org Secret Title",
		);

		const thrown = await catchThrown(() =>
			successLoader({
				context: CONTEXT,
				request: successRequest(speaker.cookie, "s_foreign"),
				params: PARAMS,
			} as unknown as LoaderArgs),
		);

		expect(thrownStatus(thrown)).toBe(404);
	});

	it("404s the signed-in user's submission from another form in the same event", async () => {
		await seedCfp();
		const speaker = await createSpeaker();
		const db = getDb(env);
		await db.insert(forms).values({
			id: "f_same_event",
			eventId: FIX.eventId,
			publicId: "form-uuid-same-event",
			type: "session",
			status: "open",
			internalName: "Same Event CFP",
			externalTitle: "Same Event Call for Sessions",
		});
		await seedOwnedSubmission(
			"s_other_form",
			FIX.eventId,
			"f_same_event",
			speaker.id,
			"Other Form Secret Title",
		);

		const thrown = await catchThrown(() =>
			successLoader({
				context: CONTEXT,
				request: successRequest(speaker.cookie, "s_other_form"),
				params: PARAMS,
			} as unknown as LoaderArgs),
		);

		expect(thrownStatus(thrown)).toBe(404);
	});

	it("returns an owned submission from the selected event and form", async () => {
		await seedCfp();
		const speaker = await createSpeaker();
		await seedOwnedSubmission(
			"s_local",
			FIX.eventId,
			FIX.formId,
			speaker.id,
			"My Event Talk",
		);

		const result = await successLoader({
			context: CONTEXT,
			request: successRequest(speaker.cookie, "s_local"),
			params: PARAMS,
		} as unknown as LoaderArgs);

		expect(result.title).toBe("My Event Talk");
	});
});
