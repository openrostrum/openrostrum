import { and, eq } from "drizzle-orm";
import { data } from "react-router";
import { getDb } from "~/db";
import { contacts, files } from "~/db/schema";
import { fileAttachmentResponse } from "~/domain/files";
import { requireUser, userCanAccessEvent } from "~/lib/auth";
import { track } from "~/lib/track";
import type { Route } from "./+types/files.$id";

/**
 * The canonical authz gate for file bytes (the bucket is private; r2 keys
 * never reach clients): an admin MEMBER of the file's org, or the user linked
 * to the owning contact. Everyone else gets a bodiless 404 — existence itself
 * is data. Portal-shared downloads have their own portal-scoped route.
 */
export async function loader({ context, request, params }: Route.LoaderArgs) {
	const env = context.cloudflare.env;
	const user = await requireUser(env, request);
	const db = getDb(env);
	const [file] = await db
		.select()
		.from(files)
		.where(eq(files.id, params.id))
		.limit(1);
	if (!file) throw data(null, { status: 404 });

	let allowed = false;
	if (user.role === "admin") {
		allowed = await userCanAccessEvent(env, user.id, file.eventId);
	}
	if (!allowed && file.contactId) {
		const [owner] = await db
			.select({ id: contacts.id })
			.from(contacts)
			.where(and(eq(contacts.id, file.contactId), eq(contacts.userId, user.id)))
			.limit(1);
		allowed = owner !== undefined;
	}
	if (!allowed) throw data(null, { status: 404 });

	const object = await env.BLOBS.get(file.r2Key);
	if (!object) throw data(null, { status: 404 });
	track("file.downloaded", {
		eventId: file.eventId,
		fileId: file.id,
		version: file.version,
		byAdmin: user.role === "admin",
	});
	return fileAttachmentResponse(object.body, file);
}
