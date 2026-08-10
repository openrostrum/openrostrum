import { eq } from "drizzle-orm";
import { data, redirect } from "react-router";
import { z } from "zod";
import {
	type ProfileActionData,
	ProfileView,
} from "~/components/portal/profile-view";
import { getDb } from "~/db";
import { contacts, insertContactSchema } from "~/db/schema";
import { type HeadshotUploadResult, uploadHeadshot } from "~/domain/files";
import { getPortalContext, portalPath } from "~/domain/portal";
import { requireUser } from "~/lib/auth";
import { errorMessage } from "~/lib/errors";
import { textLength } from "~/lib/format";
import { headshotUrl } from "~/lib/headshot";
import { sanitizeHtml } from "~/lib/html";
import { createTimings, track } from "~/lib/track";
import type { Route } from "./+types/portals.$eventSlug.$portalId.profile";

export function headers({ loaderHeaders }: Route.HeadersArgs) {
	return loaderHeaders;
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
			headshotUrl: headshotUrl(`${base}/headshot`, c?.headshotKey ?? null),
			// Explicit field whitelist: organizer-internal fields (workflow
			// status, logistics notes, visibility flag) never reach the portal
			// payload.
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

// Derived from the DB schema (single source of truth) with form refinements —
// a renamed contact column breaks this pick at compile time.
const ProfileSchema = insertContactSchema
	.pick({
		firstName: true,
		lastName: true,
		salutation: true,
		honorific: true,
		pronouns: true,
		gender: true,
		jobTitle: true,
		companyName: true,
		mobilePhone: true,
		homePhone: true,
		bio: true,
		linkedinUrl: true,
		twitterUrl: true,
		facebookUrl: true,
		websiteUrl: true,
	})
	.extend({
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
	const timings = createTimings();

	if (intent === "headshot") {
		const file = form.get("headshot");
		let result: HeadshotUploadResult;
		try {
			result = await timings.time("upload", () =>
				uploadHeadshot(env, db, {
					eventId: ctx.event.id,
					contactId: contact.id,
					file,
				}),
			);
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
		if (!result.ok) {
			return fail({ fieldErrors: { headshot: [result.error] } });
		}
		track("portal.headshot_uploaded", {
			eventId: ctx.event.id,
			contactId: contact.id,
			sizeBytes: file instanceof File ? file.size : 0,
		});
		return redirect(`${here}?saved=headshot`, {
			headers: { "Server-Timing": timings.header() },
		});
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
			await timings.time("db", () =>
				db
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
					.where(eq(contacts.id, contact.id)),
			);
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
		return redirect(`${here}?saved=profile`, {
			headers: { "Server-Timing": timings.header() },
		});
	}

	return fail({ formError: "Unknown action." });
}

export default function PortalProfile({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	return <ProfileView data={loaderData} actionData={actionData ?? undefined} />;
}
