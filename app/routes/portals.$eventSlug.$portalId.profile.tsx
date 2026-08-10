import { and, desc, eq } from "drizzle-orm";
import { data, redirect } from "react-router";
import { z } from "zod";
import {
	type ProfileActionData,
	ProfileView,
} from "~/components/portal/profile-view";
import { getDb } from "~/db";
import { contacts, files } from "~/db/schema";
import { getPortalContext, portalPath } from "~/domain/portal";
import { requireUser } from "~/lib/auth";
import { errorMessage } from "~/lib/errors";
import { textLength } from "~/lib/format";
import { sanitizeHtml } from "~/lib/html";
import { createTimings, track } from "~/lib/track";
import type { Route } from "./+types/portals.$eventSlug.$portalId.profile";

export function headers({ loaderHeaders }: Route.HeadersArgs) {
	return loaderHeaders;
}

function headshotUrl(base: string, key: string | null): string | null {
	// Cache-bust on the key's random suffix — a new upload mints a new key.
	return key ? `${base}/headshot?v=${key.slice(-20)}` : null;
}

export async function loader({ context, request, params }: Route.LoaderArgs) {
	const env = context.cloudflare.env;
	const user = await requireUser(env, request);
	const timings = createTimings();
	const ctx = await timings.time("db", () =>
		getPortalContext(env, user, params),
	);
	const base = portalPath(ctx);
	const c = ctx.contact;
	return data(
		{
			saved: new URL(request.url).searchParams.get("saved"),
			headshotUrl: headshotUrl(base, c?.headshotKey ?? null),
			// Explicit field whitelist (flows/09 rule o): organizer-internal fields
			// (workflow status, logistics notes, visibility flag) never reach the
			// portal payload.
			contact: c
				? {
						email: c.email,
						firstName: c.firstName,
						lastName: c.lastName,
						salutation: c.salutation,
						honorific: c.honorific,
						pronouns: c.pronouns,
						gender: c.gender,
						jobTitle: c.jobTitle,
						companyName: c.companyName,
						mobilePhone: c.mobilePhone,
						homePhone: c.homePhone,
						bioHtml: c.bio,
						linkedinUrl: c.linkedinUrl,
						twitterUrl: c.twitterUrl,
						facebookUrl: c.facebookUrl,
						websiteUrl: c.websiteUrl,
					}
				: null,
		},
		{ headers: { "Server-Timing": timings.header() } },
	);
}

const urlOrEmpty = z.union([
	z.string().url("Enter a valid URL, e.g. https://example.com"),
	z.literal(""),
]);

const ProfileSchema = z.object({
	firstName: z.string().min(1, "First name is required").max(100),
	lastName: z.string().min(1, "Last name is required").max(100),
	salutation: z.string().max(50),
	honorific: z.string().max(50),
	pronouns: z.string().max(50),
	gender: z.string().max(50),
	jobTitle: z.string().max(150),
	companyName: z.string().max(150),
	mobilePhone: z.string().max(50),
	homePhone: z.string().max(50),
	bio: z.string().max(60000, "Biography is too long"),
	linkedinUrl: urlOrEmpty,
	twitterUrl: urlOrEmpty,
	facebookUrl: urlOrEmpty,
	websiteUrl: urlOrEmpty,
});

const HEADSHOT_TYPES: Record<string, string> = {
	"image/png": "png",
	"image/jpeg": "jpg",
	"image/webp": "webp",
};
const HEADSHOT_MAX_BYTES = 5 * 1024 * 1024;

export async function action({ context, request, params }: Route.ActionArgs) {
	const env = context.cloudflare.env;
	const user = await requireUser(env, request);
	const ctx = await getPortalContext(env, user, params);
	if (!ctx.contact) throw data(null, { status: 404 });
	const contact = ctx.contact;
	const db = getDb(env);
	const form = await request.formData();
	const intent = String(form.get("intent") ?? "");
	const fail = (body: Omit<ProfileActionData, "intent">) => ({
		intent,
		...body,
	});
	const here = portalPath(ctx, "/profile");

	if (intent === "headshot") {
		const file = form.get("headshot");
		if (!(file instanceof File) || file.size === 0) {
			return fail({ fieldErrors: { headshot: ["Choose an image first."] } });
		}
		// Server-side enforcement — the accept= attribute is a hint, not a guard.
		const ext = HEADSHOT_TYPES[file.type];
		if (!ext) {
			return fail({
				fieldErrors: { headshot: ["Use a PNG, JPEG, or WebP image."] },
			});
		}
		if (file.size > HEADSHOT_MAX_BYTES) {
			return fail({
				fieldErrors: { headshot: ["Keep the image under 5 MB."] },
			});
		}
		const r2Key = `headshots/${ctx.event.id}/${contact.id}/${crypto.randomUUID()}.${ext}`;
		try {
			await env.BLOBS.put(r2Key, await file.arrayBuffer(), {
				httpMetadata: { contentType: file.type },
			});
			const [prior] = await db
				.select({ version: files.version })
				.from(files)
				.where(and(eq(files.contactId, contact.id), eq(files.kind, "headshot")))
				.orderBy(desc(files.version))
				.limit(1);
			await db.batch([
				db.insert(files).values({
					eventId: ctx.event.id,
					contactId: contact.id,
					r2Key,
					fileName: file.name,
					kind: "headshot",
					contentType: file.type,
					sizeBytes: file.size,
					version: (prior?.version ?? 0) + 1,
				}),
				db
					.update(contacts)
					.set({ headshotKey: r2Key })
					.where(eq(contacts.id, contact.id)),
			]);
		} catch (error) {
			track("portal.headshot_upload_failed", {
				eventId: ctx.event.id,
				contactId: contact.id,
				error: errorMessage(error),
			});
			return fail({
				fieldErrors: {
					headshot: ["The upload failed — please try again."],
				},
			});
		}
		track("portal.headshot_uploaded", {
			eventId: ctx.event.id,
			contactId: contact.id,
			sizeBytes: file.size,
		});
		return redirect(`${here}?saved=headshot`);
	}

	if (intent === "profile") {
		const raw = Object.fromEntries(
			[
				"firstName",
				"lastName",
				"salutation",
				"honorific",
				"pronouns",
				"gender",
				"jobTitle",
				"companyName",
				"mobilePhone",
				"homePhone",
				"bio",
				"linkedinUrl",
				"twitterUrl",
				"facebookUrl",
				"websiteUrl",
			].map((k) => [k, String(form.get(k) ?? "")]),
		);
		const parsed = ProfileSchema.safeParse(raw);
		if (!parsed.success) {
			return fail({ fieldErrors: z.flattenError(parsed.error).fieldErrors });
		}
		const bio = await sanitizeHtml(parsed.data.bio);
		if (textLength(bio) > 5000) {
			return fail({
				fieldErrors: { bio: ["Keep your biography under 5,000 characters."] },
			});
		}
		const opt = (v: string) => v.trim() || null;
		try {
			// Ownership is the ctx.contact chain — the WHERE hits only MY row.
			await db
				.update(contacts)
				.set({
					firstName: parsed.data.firstName.trim(),
					lastName: parsed.data.lastName.trim(),
					salutation: opt(parsed.data.salutation),
					honorific: opt(parsed.data.honorific),
					pronouns: opt(parsed.data.pronouns),
					gender: opt(parsed.data.gender),
					jobTitle: opt(parsed.data.jobTitle),
					companyName: opt(parsed.data.companyName),
					mobilePhone: opt(parsed.data.mobilePhone),
					homePhone: opt(parsed.data.homePhone),
					bio: bio || null,
					linkedinUrl: opt(parsed.data.linkedinUrl),
					twitterUrl: opt(parsed.data.twitterUrl),
					facebookUrl: opt(parsed.data.facebookUrl),
					websiteUrl: opt(parsed.data.websiteUrl),
				})
				.where(eq(contacts.id, contact.id));
		} catch (error) {
			track("portal.profile_update_failed", {
				eventId: ctx.event.id,
				contactId: contact.id,
				error: errorMessage(error),
			});
			return fail({
				formError: "Could not save your profile — please try again.",
			});
		}
		track("portal.profile_updated", {
			eventId: ctx.event.id,
			contactId: contact.id,
		});
		return redirect(`${here}?saved=profile`);
	}

	return fail({ formError: "Unknown action." });
}

export default function PortalProfile({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	return <ProfileView data={loaderData} actionData={actionData ?? undefined} />;
}
