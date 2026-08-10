import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { redirect } from "react-router";
import { getDb } from "~/db";
import { contacts, files, submissions } from "~/db/schema";
import {
	checkUpload,
	GROUP_KEY_SQL,
	groupKeyOf,
	nextDirectVersion,
	UPLOAD_MAX_BYTES,
	type UploadErrorCode,
} from "~/domain/files";
import { getActiveEvent, requireAdmin, safeRedirect } from "~/lib/auth";
import { errorMessage } from "~/lib/errors";
import { createTimings, track } from "~/lib/track";
import type { Route } from "./+types/files.upload";

/** POST-only resource route — a stray GET lands on the library. */
export async function loader({ context, request }: Route.LoaderArgs) {
	await requireAdmin(context.cloudflare.env, request);
	return redirect("/admin/files");
}

/**
 * Admin upload chokepoint: bytes go Worker-mediated into the private R2
 * bucket (never presigned — the bucket has no public read path), the row is
 * scoped to the ACTIVE event server-side, and a re-upload of the same name to
 * the same target continues that chain at version + 1. Speaker uploads go
 * through the portal task route instead.
 */
export async function action({ context, request }: Route.ActionArgs) {
	const env = context.cloudflare.env;
	const user = await requireAdmin(env, request);
	const event = await getActiveEvent(env, user);
	if (!event) return failRedirect("/admin/files", "no-event");
	const db = getDb(env);
	const form = await request.formData();
	const backTo =
		safeRedirect(String(form.get("redirectTo") ?? "")) ?? "/admin/files";
	const fail = (code: UploadErrorCode) => failRedirect(backTo, code);

	const file = form.get("file");
	if (!(file instanceof File) || file.size === 0) {
		return fail("choose-file");
	}
	const check = checkUpload(file);
	if (!check.ok) {
		return fail(file.size > UPLOAD_MAX_BYTES ? "too-large" : "bad-type");
	}

	// Attachment targets resolve INSIDE the active event or not at all — a
	// foreign submission/contact id is refused, never silently dropped.
	const submissionId = String(form.get("submissionId") ?? "") || null;
	const contactId = String(form.get("contactId") ?? "") || null;
	let attachedContactId = contactId;
	if (submissionId) {
		const [row] = await db
			.select({ id: submissions.id })
			.from(submissions)
			.where(
				and(
					eq(submissions.id, submissionId),
					eq(submissions.eventId, event.id),
				),
			)
			.limit(1);
		if (!row) return fail("foreign-submission");
	}
	if (contactId) {
		const [row] = await db
			.select({ id: contacts.id })
			.from(contacts)
			.where(and(eq(contacts.id, contactId), eq(contacts.eventId, event.id)))
			.limit(1);
		if (!row) return fail("foreign-speaker");
		attachedContactId = row.id;
	}

	const shared = form.get("sharedToPortal") === "on";
	const timings = createTimings();
	try {
		const version = await timings.time("db", () =>
			nextDirectVersion(db, {
				eventId: event.id,
				submissionId,
				contactId: attachedContactId,
				fileName: file.name,
			}),
		);
		const target = submissionId ?? attachedContactId ?? "event";
		const r2Key = `admin-files/${event.id}/${target}/v${version}-${crypto.randomUUID()}`;
		const bytes = await file.arrayBuffer();
		await timings.time("r2", () =>
			env.BLOBS.put(r2Key, bytes, {
				httpMetadata: { contentType: file.type || "application/octet-stream" },
			}),
		);
		const row = {
			eventId: event.id,
			submissionId,
			contactId: attachedContactId,
			taskAssignmentId: null,
			r2Key,
			fileName: file.name,
			kind: check.kind,
			contentType: file.type || "application/octet-stream",
			sizeBytes: file.size,
			version,
			sharedToPortal: shared,
		};
		// Portal downloads list shared rows flat, so the shared flag lives on
		// exactly one version per chain — inherit it forward, clear it behind.
		const groupKey = groupKeyOf(row);
		const [inserted] = await timings.time("db", () =>
			db.insert(files).values(row).returning({ id: files.id }),
		);
		if (inserted && version > 1) {
			await timings.time("db", async () => {
				const [priorShared] = await db
					.select({ id: files.id })
					.from(files)
					.where(
						and(
							eq(files.eventId, event.id),
							isNull(files.taskAssignmentId),
							ne(files.id, inserted.id),
							eq(files.sharedToPortal, true),
							sql`${GROUP_KEY_SQL} = ${groupKey}`,
						),
					)
					.limit(1);
				if (!priorShared) return;
				await db.batch([
					db
						.update(files)
						.set({ sharedToPortal: false })
						.where(
							and(
								eq(files.eventId, event.id),
								ne(files.id, inserted.id),
								sql`${GROUP_KEY_SQL} = ${groupKey}`,
							),
						),
					db
						.update(files)
						.set({ sharedToPortal: true })
						.where(eq(files.id, inserted.id)),
				]);
			});
		}
		track("file.uploaded", {
			eventId: event.id,
			fileId: inserted?.id,
			version,
			sizeBytes: file.size,
			shared,
		});
	} catch (error) {
		track("file.upload_failed", {
			eventId: event.id,
			error: errorMessage(error),
		});
		return fail("failed");
	}
	return redirect(withParam(backTo, "notice", "uploaded"), {
		headers: { "Server-Timing": timings.header() },
	});
}

function withParam(path: string, key: string, value: string): string {
	const url = new URL(path, "http://sentinel.invalid");
	url.searchParams.set(key, value);
	return url.pathname + url.search;
}

function failRedirect(path: string, code: UploadErrorCode) {
	return redirect(withParam(path, "uploadError", code));
}
