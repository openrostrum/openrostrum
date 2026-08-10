import { and, asc, eq, ne } from "drizzle-orm";
import { getDb } from "~/db";
import { contacts, files, submissions } from "~/db/schema";
import { serializeContent } from "~/lib/compat/serializers";
import { type ApiApp, type ApiContext, notFound } from "./context";

/**
 * Binary companions to the JSON payloads: session file attachments (the
 * spec's Session Files reads) and contact headshots. Bytes stream through
 * the same token guard as everything else — the emitted `photo_url` /
 * `content[].url` values resolve with the x-access-token header, there is no
 * unauthenticated CDN.
 */

async function requireVisibleSession(
	c: ApiContext,
	sessionId: string,
): Promise<void> {
	const [row] = await getDb(c.env)
		.select({ id: submissions.id })
		.from(submissions)
		.where(
			and(
				eq(submissions.id, sessionId),
				eq(submissions.eventId, c.get("event").id),
				ne(submissions.status, "draft"),
			),
		)
		.limit(1);
	if (!row) throw notFound("Session");
}

function streamBlob(
	c: ApiContext,
	object: R2ObjectBody,
	contentType: string | null,
	fileName: string,
): Response {
	return c.body(object.body, 200, {
		"content-type": contentType ?? "application/octet-stream",
		"content-length": String(object.size),
		"content-disposition": `attachment; filename="${fileName.replaceAll('"', "")}"`,
	});
}

export function registerFileRoutes(app: ApiApp): void {
	// List files attached to a session (spec: `{data: Content[]}`).
	app.get("/event/:eventId/sessions/:sessionId/files", async (c) => {
		const sessionId = c.req.param("sessionId");
		await requireVisibleSession(c, sessionId);
		const rows = await getDb(c.env).query.files.findMany({
			where: eq(files.submissionId, sessionId),
			with: { contact: true },
			orderBy: [asc(files.createdAt), asc(files.id)],
		});
		const origin = new URL(c.req.url).origin;
		return c.json({ data: rows.map((f) => serializeContent(f, origin)) });
	});

	// Stream a session file's bytes — the target of Content.url.
	app.get(
		"/event/:eventId/sessions/:sessionId/files/:fileId/download",
		async (c) => {
			const sessionId = c.req.param("sessionId");
			await requireVisibleSession(c, sessionId);
			const [file] = await getDb(c.env)
				.select()
				.from(files)
				.where(
					and(
						eq(files.id, c.req.param("fileId")),
						eq(files.submissionId, sessionId),
						eq(files.eventId, c.get("event").id),
					),
				)
				.limit(1);
			if (!file) throw notFound("File");
			const object = await c.env.BLOBS.get(file.r2Key);
			if (!object) throw notFound("File");
			return streamBlob(c, object, file.contentType, file.fileName);
		},
	);

	// Stream a contact's headshot — the target of photo_url.
	app.get("/event/:eventId/contacts/:contactId/photo", async (c) => {
		const [contact] = await getDb(c.env)
			.select()
			.from(contacts)
			.where(
				and(
					eq(contacts.id, c.req.param("contactId")),
					eq(contacts.eventId, c.get("event").id),
				),
			)
			.limit(1);
		if (!contact?.headshotKey) throw notFound("Photo");
		const object = await c.env.BLOBS.get(contact.headshotKey);
		if (!object) throw notFound("Photo");
		return streamBlob(
			c,
			object,
			object.httpMetadata?.contentType ?? null,
			`${contact.firstName}-${contact.lastName}-headshot`.toLowerCase(),
		);
	});
}
