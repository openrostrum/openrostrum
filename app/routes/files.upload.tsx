import { and, eq } from "drizzle-orm";
import { redirect } from "react-router";
import { getDb } from "~/db";
import { submissions } from "~/db/schema";
import {
	checkUpload,
	insertDirectUpload,
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
	if (!check.ok) return fail(check.code);

	// The attachment target resolves INSIDE the active event or not at all —
	// a foreign submission id is refused, never silently dropped.
	const submissionId = String(form.get("submissionId") ?? "") || null;
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

	const shared = form.get("sharedToPortal") === "on";
	const timings = createTimings();
	try {
		const target = submissionId ?? "event";
		const r2Key = `admin-files/${event.id}/${target}/${crypto.randomUUID()}`;
		const bytes = await file.arrayBuffer();
		await timings.time("r2", () =>
			env.BLOBS.put(r2Key, bytes, {
				httpMetadata: { contentType: file.type || "application/octet-stream" },
			}),
		);
		const inserted = await timings.time("db", () =>
			insertDirectUpload(db, {
				eventId: event.id,
				submissionId,
				r2Key,
				fileName: file.name,
				kind: check.kind,
				contentType: file.type || "application/octet-stream",
				sizeBytes: file.size,
				sharedToPortal: shared,
			}),
		);
		track("file.uploaded", {
			eventId: event.id,
			fileId: inserted.id,
			version: inserted.version,
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
