import { and, eq } from "drizzle-orm";
import { data } from "react-router";
import { getDb } from "~/db";
import { files } from "~/db/schema";
import { fileAttachmentResponse } from "~/domain/files";
import { getPortalContext } from "~/domain/portal";
import { requireUser } from "~/lib/auth";
import { track } from "~/lib/track";
import type { Route } from "./+types/portals.$eventSlug.$portalId.files_.$fileId";

/**
 * Authz-gated file bytes for portal users: organizer-shared portal files, or
 * the caller's OWN uploads (headshots, task files). Anything else 404s — the
 * bucket is private and r2 keys never reach the client, so this loader is the
 * only road to the bytes.
 */
export async function loader({ context, request, params }: Route.LoaderArgs) {
	const env = context.cloudflare.env;
	const user = await requireUser(env, request);
	const ctx = await getPortalContext(env, user, params);
	const db = getDb(env);
	const [file] = await db
		.select()
		.from(files)
		.where(and(eq(files.id, params.fileId), eq(files.eventId, ctx.event.id)))
		.limit(1);
	if (!file) throw data(null, { status: 404 });
	const isMine = ctx.contact !== null && file.contactId === ctx.contact.id;
	if (!file.sharedToPortal && !isMine) throw data(null, { status: 404 });

	const object = await env.BLOBS.get(file.r2Key);
	if (!object) throw data(null, { status: 404 });
	track("portal.file_downloaded", {
		eventId: ctx.event.id,
		fileId: file.id,
		shared: file.sharedToPortal,
	});
	return fileAttachmentResponse(object.body, file);
}
