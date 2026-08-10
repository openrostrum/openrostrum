import { and, eq } from "drizzle-orm";
import { data } from "react-router";
import { getDb } from "~/db";
import { contacts, files } from "~/db/schema";
import { sanitizeFileName } from "~/domain/files";
import { requireUser, userCanAccessEvent } from "~/lib/auth";
import { track } from "~/lib/track";
import type { Route } from "./+types/files.$id";

/**
 * The canonical authz-checked road to file bytes. The bucket is private and
 * r2 keys never reach a client, so every download passes this gate: an admin
 * MEMBER of the file's org (never admins of other orgs), or the user linked
 * to the file's owning contact. Everyone else gets a bodiless 404 — never a
 * hint that the id exists. Portal-shared downloads have their own
 * portal-scoped route.
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
	return new Response(object.body, {
		headers: {
			"Content-Type": file.contentType ?? "application/octet-stream",
			"Content-Disposition": `attachment; filename="${sanitizeFileName(file.fileName)}"`,
			"Cache-Control": "private, no-store",
		},
	});
}
