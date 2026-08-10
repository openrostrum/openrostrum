import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "../app/db";
import { contacts, files } from "../app/db/schema";
import { loader as downloadLoader } from "../app/routes/portals.$eventSlug.$portalId.files_.$fileId";
import { loader as filesLoader } from "../app/routes/portals.$eventSlug.$portalId.files";
import { action as profileAction } from "../app/routes/portals.$eventSlug.$portalId.profile";
import {
	authedRequest,
	BASE,
	catchThrown,
	CONTEXT,
	makeContact,
	makeUser,
	PORTAL_PARAMS,
	seedPortalWorld,
	thrownStatus,
	unwrap,
} from "./portal.helpers";

type ProfileActionArgs = Parameters<typeof profileAction>[0];
type FilesLoaderArgs = Parameters<typeof filesLoader>[0];
type DownloadArgs = Parameters<typeof downloadLoader>[0];

async function seedPriya() {
	await seedPortalWorld();
	await makeUser("u_priya", "priya@example.com");
	await makeContact(
		"c_priya",
		"e1",
		"priya@example.com",
		"u_priya",
		"Priya",
		"R",
	);
}

function profileBody(overrides: Record<string, string> = {}) {
	return new URLSearchParams({
		intent: "profile",
		firstName: "Priya",
		lastName: "Raman",
		bio: "<p>Priya Raman is an infrastructure engineer focused on <strong>LLM evals</strong>.</p><ul><li>10 years in ML infra</li><li>Speaker at 12 conferences</li></ul>",
		linkedinUrl: "https://www.linkedin.com/in/priyaraman",
		twitterUrl: "https://x.com/priyaraman",
		websiteUrl: "https://priya.dev",
		jobTitle: "Principal Engineer",
		companyName: "Wompler Labs",
		...overrides,
	});
}

describe("portal profile", () => {
	it("persists bio formatting, links, and titles to the ONE contact row the admin also reads", async () => {
		await seedPriya();
		const db = getDb(env);
		const response = await profileAction({
			context: CONTEXT,
			request: await authedRequest("u_priya", `${BASE}/profile`, {
				method: "POST",
				body: profileBody(),
			}),
			params: PORTAL_PARAMS,
		} as unknown as ProfileActionArgs);
		expect((response as Response).status).toBe(302);

		const [row] = await db
			.select()
			.from(contacts)
			.where(eq(contacts.id, "c_priya"));
		expect(row?.bio).toContain("<strong>LLM evals</strong>");
		expect(row?.bio).toContain("<li>10 years in ML infra</li>");
		expect(row?.jobTitle).toBe("Principal Engineer");
		expect(row?.companyName).toBe("Wompler Labs");
		expect(row?.websiteUrl).toBe("https://priya.dev");
	});

	it("rejects a junk website URL with a field error and saves NOTHING from that submit", async () => {
		await seedPriya();
		const db = getDb(env);
		const result = (await profileAction({
			context: CONTEXT,
			request: await authedRequest("u_priya", `${BASE}/profile`, {
				method: "POST",
				body: profileBody({ websiteUrl: "not a url" }),
			}),
			params: PORTAL_PARAMS,
		} as unknown as ProfileActionArgs)) as {
			fieldErrors?: Record<string, string[]>;
		};
		expect(result.fieldErrors?.websiteUrl?.[0]).toBeTruthy();
		const [row] = await db
			.select({ jobTitle: contacts.jobTitle })
			.from(contacts)
			.where(eq(contacts.id, "c_priya"));
		expect(row?.jobTitle).toBeNull(); // the rest of the form didn't half-save
	});

	it("accepts a PNG headshot (bytes round-trip) and rejects wrong type / oversize", async () => {
		await seedPriya();
		const db = getDb(env);

		const post = async (file: File) => {
			const form = new FormData();
			form.set("intent", "headshot");
			form.set("headshot", file);
			return profileAction({
				context: CONTEXT,
				request: await authedRequest("u_priya", `${BASE}/profile`, {
					method: "POST",
					body: form,
				}),
				params: PORTAL_PARAMS,
			} as unknown as ProfileActionArgs);
		};

		const bmp = (await post(
			new File(["BM..."], "headshot.bmp", { type: "image/bmp" }),
		)) as { fieldErrors?: Record<string, string[]> };
		expect(bmp.fieldErrors?.headshot?.[0]).toMatch(/PNG|JPEG/);

		const huge = (await post(
			new File([new Uint8Array(5 * 1024 * 1024 + 1)], "big.png", {
				type: "image/png",
			}),
		)) as { fieldErrors?: Record<string, string[]> };
		expect(huge.fieldErrors?.headshot?.[0]).toMatch(/5 MB/);

		let [row] = await db
			.select({ headshotKey: contacts.headshotKey })
			.from(contacts)
			.where(eq(contacts.id, "c_priya"));
		expect(row?.headshotKey).toBeNull(); // bad input never destroys good state

		const PNG_BYTES = "fake-png-bytes-for-checksum";
		const ok = await post(
			new File([PNG_BYTES], "headshot-priya.png", { type: "image/png" }),
		);
		expect((ok as Response).status).toBe(302);
		[row] = await db
			.select({ headshotKey: contacts.headshotKey })
			.from(contacts)
			.where(eq(contacts.id, "c_priya"));
		expect(row?.headshotKey).toBeTruthy();
		const stored = await env.BLOBS.get(row?.headshotKey ?? "");
		expect(await stored?.text()).toBe(PNG_BYTES);
	});
});

describe("portal shared files", () => {
	async function seedFiles() {
		await seedPriya();
		const db = getDb(env);
		await env.BLOBS.put("shared/e1/kit.pdf", "SPEAKER-KIT-BYTES");
		await env.BLOBS.put("private/e1/internal.pdf", "INTERNAL-BYTES");
		await db.insert(files).values([
			{
				id: "f_kit",
				eventId: "e1",
				r2Key: "shared/e1/kit.pdf",
				fileName: "speaker-kit-2026.pdf",
				contentType: "application/pdf",
				sizeBytes: 17,
				sharedToPortal: true,
			},
			{
				id: "f_internal",
				eventId: "e1",
				r2Key: "private/e1/internal.pdf",
				fileName: "internal-budget.pdf",
				contentType: "application/pdf",
				sizeBytes: 14,
				sharedToPortal: false,
			},
		]);
	}

	it("lists ONLY organizer-shared files (unshared admin uploads never leak)", async () => {
		await seedFiles();
		const result = await filesLoader({
			context: CONTEXT,
			request: await authedRequest("u_priya", `${BASE}/files`),
			params: PORTAL_PARAMS,
		} as unknown as FilesLoaderArgs);
		const data = unwrap<{ files: Array<{ id: string; fileName: string }> }>(
			result,
		);
		expect(data.files.map((f) => f.id)).toEqual(["f_kit"]);
		expect(JSON.stringify(data)).not.toContain("internal-budget");
		// Display metadata only — object keys stay server-side.
		expect(JSON.stringify(data)).not.toContain("shared/e1/kit.pdf");
	});

	it("serves shared bytes to a portal user, 404s unshared files, and bounces the logged-out", async () => {
		await seedFiles();
		const ok = (await downloadLoader({
			context: CONTEXT,
			request: await authedRequest("u_priya", `${BASE}/files/f_kit`),
			params: { ...PORTAL_PARAMS, fileId: "f_kit" },
		} as unknown as DownloadArgs)) as Response;
		expect(await ok.text()).toBe("SPEAKER-KIT-BYTES");
		expect(ok.headers.get("Content-Disposition")).toContain(
			"speaker-kit-2026.pdf",
		);

		const denied = await catchThrown(async () =>
			downloadLoader({
				context: CONTEXT,
				request: await authedRequest("u_priya", `${BASE}/files/f_internal`),
				params: { ...PORTAL_PARAMS, fileId: "f_internal" },
			} as unknown as DownloadArgs),
		);
		expect(thrownStatus(denied)).toBe(404);

		const anonymous = await catchThrown(async () =>
			downloadLoader({
				context: CONTEXT,
				request: new Request(`${BASE}/files/f_kit`),
				params: { ...PORTAL_PARAMS, fileId: "f_kit" },
			} as unknown as DownloadArgs),
		);
		expect(anonymous).toBeInstanceOf(Response);
		expect(thrownStatus(anonymous)).toBe(302); // to /login — zero file bytes
	});

	it("lets an uploader download their OWN unshared file but never someone else's", async () => {
		await seedFiles();
		const db = getDb(env);
		await env.BLOBS.put("task-files/e1/mine.pdf", "MY-UPLOAD");
		await db.insert(files).values({
			id: "f_mine",
			eventId: "e1",
			contactId: "c_priya",
			r2Key: "task-files/e1/mine.pdf",
			fileName: "my-deck.pdf",
			sharedToPortal: false,
		});
		const mine = (await downloadLoader({
			context: CONTEXT,
			request: await authedRequest("u_priya", `${BASE}/files/f_mine`),
			params: { ...PORTAL_PARAMS, fileId: "f_mine" },
		} as unknown as DownloadArgs)) as Response;
		expect(await mine.text()).toBe("MY-UPLOAD");

		await makeUser("u_dana", "dana@example.com");
		await makeContact(
			"c_dana",
			"e1",
			"dana@example.com",
			"u_dana",
			"Dana",
			"O",
		);
		const foreign = await catchThrown(async () =>
			downloadLoader({
				context: CONTEXT,
				request: await authedRequest("u_dana", `${BASE}/files/f_mine`),
				params: { ...PORTAL_PARAMS, fileId: "f_mine" },
			} as unknown as DownloadArgs),
		);
		expect(thrownStatus(foreign)).toBe(404);
	});
});
