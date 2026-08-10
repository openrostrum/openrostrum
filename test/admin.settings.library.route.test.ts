import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "../app/db";
import {
	events,
	fields,
	formFields,
	forms,
	formats,
	levels,
	organizationMembers,
	organizations,
	rooms,
	submissionAnswers,
	submissionTracks,
	submissions,
	tags,
	tracks,
	users,
} from "../app/db/schema";
import { createSession, hashPassword } from "../app/lib/auth";
import { action, loader } from "../app/routes/admin.settings.library";

const CONTEXT = { cloudflare: { env, ctx: {} } };

function unwrap<T>(result: unknown): T {
	if (
		result !== null &&
		typeof result === "object" &&
		"data" in result &&
		"init" in result
	) {
		return (result as { data: T }).data;
	}
	return result as T;
}

type LibResult = {
	ok?: true;
	fieldErrors?: Record<string, string[] | undefined>;
	formError?: string;
};

/** Two orgs: org_a runs two events (org-wide scope boundary), org_b is the
 * foreign tenant every guard must hold against. */
async function seed(): Promise<void> {
	const db = getDb(env);
	await db.insert(organizations).values([
		{ id: "org_a", name: "Org A" },
		{ id: "org_b", name: "Org B" },
	]);
	await db.insert(users).values([
		{
			id: "u_a",
			email: "a@test.co",
			passwordHash: await hashPassword("pw"),
			role: "admin",
		},
		{
			id: "u_b",
			email: "b@test.co",
			passwordHash: await hashPassword("pw"),
			role: "admin",
		},
	]);
	await db.insert(organizationMembers).values([
		{ organizationId: "org_a", userId: "u_a" },
		{ organizationId: "org_b", userId: "u_b" },
	]);
	await db.insert(events).values([
		{ id: "e_a", organizationId: "org_a", name: "A", slug: "a" },
		{ id: "e_a2", organizationId: "org_a", name: "A2", slug: "a2" },
		{ id: "e_b", organizationId: "org_b", name: "B", slug: "b" },
	]);
	await db
		.update(users)
		.set({ activeEventId: "e_a" })
		.where(eq(users.id, "u_a"));
	await db
		.update(users)
		.set({ activeEventId: "e_b" })
		.where(eq(users.id, "u_b"));
}

async function cookieFor(userId: string): Promise<string> {
	const setCookie = await createSession(env, userId);
	return setCookie.split(";")[0] ?? "";
}

async function post(
	fields_: Record<string, string>,
	userId = "u_a",
): Promise<LibResult> {
	const headers = new Headers({ Cookie: await cookieFor(userId) });
	const request = new Request("http://localhost/admin/settings/library", {
		method: "POST",
		headers,
		body: new URLSearchParams(fields_),
	});
	const result = await action({
		context: CONTEXT,
		request,
		params: {},
	} as unknown as Parameters<typeof action>[0]);
	return unwrap<LibResult>(result);
}

async function load(userId: string) {
	const headers = new Headers({ Cookie: await cookieFor(userId) });
	const result = await loader({
		context: CONTEXT,
		request: new Request("http://localhost/admin/settings/library", {
			headers,
		}),
		params: {},
	} as unknown as Parameters<typeof loader>[0]);
	return unwrap<{
		event: { id: string } | null;
		fields: Array<{ name: string }>;
	}>(result);
}

describe("library taxonomies", () => {
	it("creates tracks/tags/formats/levels/rooms scoped to the active event with their extra columns (AE-S3)", async () => {
		await seed();
		expect(
			(
				await post({
					intent: "track.create",
					name: "AI Infrastructure",
					color: "#7C3AED",
				})
			).ok,
		).toBe(true);
		await post({ intent: "tag.create", name: "Hands-on", color: "#F59E0B" });
		await post({
			intent: "format.create",
			name: "Workshop (120 min)",
			defaultDurationMins: "120",
		});
		await post({ intent: "level.create", name: "Expert" });
		await post({
			intent: "room.create",
			name: "Auditorium A",
			capacity: "300",
		});

		const db = getDb(env);
		const [track] = await db.select().from(tracks);
		expect(track).toMatchObject({
			eventId: "e_a",
			name: "AI Infrastructure",
			color: "#7C3AED",
		});
		const [format] = await db.select().from(formats);
		expect(format).toMatchObject({
			eventId: "e_a",
			defaultDurationMins: 120,
		});
		const [room] = await db.select().from(rooms);
		expect(room).toMatchObject({ eventId: "e_a", capacity: 300 });
		expect(await db.select().from(tags)).toHaveLength(1);
		expect(await db.select().from(levels)).toHaveLength(1);
	});

	it("rejects a blank name inline and inserts nothing (AE-S3.2)", async () => {
		await seed();
		const result = await post({
			intent: "track.create",
			name: "   ",
			color: "#7C3AED",
		});
		expect(result.fieldErrors?.name?.[0]).toMatch(/required/i);
		expect(await getDb(env).select().from(tracks)).toHaveLength(0);
	});

	it("updates a track's name and color in place (AE-S3.7)", async () => {
		await seed();
		const db = getDb(env);
		await db.insert(tracks).values({
			id: "t_sec",
			eventId: "e_a",
			name: "Security",
			color: "#0EA5E9",
		});
		const result = await post({
			intent: "track.update",
			id: "t_sec",
			name: "Security & Privacy",
			color: "#DC2626",
		});
		expect(result.ok).toBe(true);
		const [row] = await db.select().from(tracks);
		expect(row).toMatchObject({
			name: "Security & Privacy",
			color: "#DC2626",
		});
	});

	it("deleting a level clears it from submissions without deleting them (AE-S3.8)", async () => {
		await seed();
		const db = getDb(env);
		await db
			.insert(levels)
			.values({ id: "lvl_x", eventId: "e_a", name: "Expert" });
		await db.insert(submissions).values({
			id: "s1",
			eventId: "e_a",
			title: "Talk",
			levelId: "lvl_x",
		});

		expect((await post({ intent: "level.delete", id: "lvl_x" })).ok).toBe(true);

		// The dropdown feed (the levels table itself) no longer offers it…
		expect(await db.select().from(levels)).toHaveLength(0);
		// …and existing submissions degrade, never disappear.
		const [submission] = await db.select().from(submissions);
		expect(submission?.id).toBe("s1");
		expect(submission?.levelId).toBeNull();
	});

	// Register decision: track deletion must never silently strip submissions'
	// tracks — the Library refuses while references exist and reports the count.
	it("refuses to delete a track that submissions still use, and deletes it once unreferenced", async () => {
		await seed();
		const db = getDb(env);
		await db
			.insert(tracks)
			.values({ id: "t_x", eventId: "e_a", name: "Sec", color: "#0EA5E9" });
		await db.insert(submissions).values({
			id: "s1",
			eventId: "e_a",
			title: "Talk",
		});
		await db
			.insert(submissionTracks)
			.values({ submissionId: "s1", trackId: "t_x" });

		const refused = await post({ intent: "track.delete", id: "t_x" });
		expect(refused.ok).toBeUndefined();
		expect(refused.formError).toMatch(/in use by 1 submission/i);
		expect(await db.select().from(tracks)).toHaveLength(1);
		expect(await db.select().from(submissionTracks)).toHaveLength(1);

		// The loader surfaces the same count so the refusal is never a surprise.
		const listed = (await load("u_a")) as unknown as {
			tracks: Array<{ id: string; inUse: number }>;
		};
		expect(listed.tracks.find((t) => t.id === "t_x")?.inUse).toBe(1);

		await db.delete(submissionTracks);
		expect((await post({ intent: "track.delete", id: "t_x" })).ok).toBe(true);
		expect(await db.select().from(tracks)).toHaveLength(0);
	});

	it("refuses to touch another org's rows — update and delete write nothing cross-tenant", async () => {
		await seed();
		const db = getDb(env);
		await db.insert(tracks).values({
			id: "t_foreign",
			eventId: "e_b",
			name: "Foreign",
			color: "#0EA5E9",
		});
		const updated = await post({
			intent: "track.update",
			id: "t_foreign",
			name: "Hijacked",
			color: "#000000",
		});
		expect(updated.ok).toBeUndefined();
		expect(updated.formError).toBeTruthy();
		const removed = await post({ intent: "track.delete", id: "t_foreign" });
		expect(removed.formError).toBeTruthy();
		const [row] = await db.select().from(tracks);
		expect(row).toMatchObject({ id: "t_foreign", name: "Foreign" });
	});
});

describe("library fields", () => {
	it("event scope is the default; org-wide sets organizationId with eventId NULL — the XOR always has exactly one side (AE-S4.3)", async () => {
		await seed();
		await post({
			intent: "field.create",
			name: "Requires visa letter",
			type: "checkbox",
		});
		await post({
			intent: "field.create",
			name: "T-shirt size",
			type: "dropdown",
			scope: "org",
			options: "S, M, L, XL",
		});

		const db = getDb(env);
		const rows = await db.select().from(fields);
		const eventField = rows.find((r) => r.name === "Requires visa letter");
		const orgField = rows.find((r) => r.name === "T-shirt size");
		expect(eventField?.eventId).toBe("e_a");
		expect(eventField?.organizationId).toBeNull();
		expect(orgField?.organizationId).toBe("org_a");
		expect(orgField?.eventId).toBeNull();
		expect(orgField?.options).toEqual(["S", "M", "L", "XL"]);
	});

	it("org-wide fields appear in every org event's library; event fields only in theirs; nothing leaks across orgs (AE-S4.6)", async () => {
		await seed();
		const db = getDb(env);
		await db.insert(fields).values([
			{
				id: "f_org",
				organizationId: "org_a",
				name: "T-shirt size",
				type: "dropdown",
				options: ["S"],
			},
			{
				id: "f_evt",
				eventId: "e_a",
				name: "Requires visa letter",
				type: "checkbox",
			},
		]);

		// From e_a (the field's home): both visible.
		const home = await load("u_a");
		expect(home.fields.map((f) => f.name).sort()).toEqual([
			"Requires visa letter",
			"T-shirt size",
		]);

		// From the org's OTHER event: org-wide yes, event-scoped no.
		await db
			.update(users)
			.set({ activeEventId: "e_a2" })
			.where(eq(users.id, "u_a"));
		const sibling = await load("u_a");
		expect(sibling.fields.map((f) => f.name)).toEqual(["T-shirt size"]);

		// From a different org entirely: neither.
		const foreign = await load("u_b");
		expect(foreign.fields).toHaveLength(0);
	});

	it("a dropdown without options is rejected inline; the type is preserved in the error response (AE-S4.2)", async () => {
		await seed();
		const result = await post({
			intent: "field.create",
			name: "T-shirt size",
			type: "dropdown",
			options: "",
		});
		expect(result.fieldErrors?.options?.[0]).toMatch(/option/i);
		expect(await getDb(env).select().from(fields)).toHaveLength(0);
	});

	it("renaming a field updates the single definition; scope stays immutable on update", async () => {
		await seed();
		const db = getDb(env);
		await db.insert(fields).values({
			id: "f_yrs",
			eventId: "e_a",
			name: "Years of speaking experience",
			type: "number",
		});
		const result = await post({
			intent: "field.update",
			id: "f_yrs",
			name: "Years of experience",
			type: "number",
			scope: "org",
		});
		expect(result.ok).toBe(true);
		const [row] = await db.select().from(fields);
		expect(row?.name).toBe("Years of experience");
		// The posted scope=org was ignored — still event-scoped, XOR intact.
		expect(row?.eventId).toBe("e_a");
		expect(row?.organizationId).toBeNull();
	});

	it("a field with submitted answers refuses deletion with a friendly error; an unanswered field deletes and cascades its form placements (AE-S4.5)", async () => {
		await seed();
		const db = getDb(env);
		await db.insert(fields).values([
			{ id: "f_used", eventId: "e_a", name: "Used", type: "text" },
			{ id: "f_scratch", eventId: "e_a", name: "Scratch field", type: "text" },
		]);
		await db.insert(forms).values({
			id: "form1",
			eventId: "e_a",
			publicId: "pub1",
			internalName: "CFP",
		});
		await db.insert(formFields).values([
			{ id: "ff_used", formId: "form1", fieldId: "f_used" },
			{ id: "ff_scratch", formId: "form1", fieldId: "f_scratch" },
		]);
		await db.insert(submissions).values({
			id: "s1",
			eventId: "e_a",
			title: "Talk",
		});
		await db.insert(submissionAnswers).values({
			submissionId: "s1",
			fieldId: "f_used",
			value: "answered",
		});

		const refused = await post({ intent: "field.delete", id: "f_used" });
		expect(refused.formError).toMatch(/can't be deleted/i);
		expect(
			await db.select().from(fields).where(eq(fields.id, "f_used")),
		).toHaveLength(1);

		const deleted = await post({ intent: "field.delete", id: "f_scratch" });
		expect(deleted.ok).toBe(true);
		expect(
			await db.select().from(fields).where(eq(fields.id, "f_scratch")),
		).toHaveLength(0);
		// The placement goes with it; the answered field's placement stays.
		const placements = await db.select().from(formFields);
		expect(placements.map((p) => p.id)).toEqual(["ff_used"]);
	});

	it("an org member can manage org-wide fields from any of the org's events; a foreign org cannot", async () => {
		await seed();
		const db = getDb(env);
		await db.insert(fields).values({
			id: "f_org",
			organizationId: "org_a",
			name: "T-shirt size",
			type: "text",
		});
		// From org_a's second event.
		await db
			.update(users)
			.set({ activeEventId: "e_a2" })
			.where(eq(users.id, "u_a"));
		const renamed = await post({
			intent: "field.update",
			id: "f_org",
			name: "Shirt size",
			type: "text",
		});
		expect(renamed.ok).toBe(true);

		// org_b's admin gets a not-found, and the row is untouched.
		const foreign = await post(
			{ intent: "field.update", id: "f_org", name: "Stolen", type: "text" },
			"u_b",
		);
		expect(foreign.formError).toBeTruthy();
		const [row] = await db.select().from(fields);
		expect(row?.name).toBe("Shirt size");
	});
});
