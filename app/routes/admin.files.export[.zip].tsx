import { and, eq, inArray, sql } from "drizzle-orm";
import { data } from "react-router";
import { getDb } from "~/db";
import { contacts, submissions } from "~/db/schema";
import {
	canonicalRowsSql,
	rankedChainsSql,
	sanitizeFileName,
} from "~/domain/files";
import { parseZipGrouping, preflightZipExport } from "~/domain/zip-export";
import { getActiveEvent, requireAdmin } from "~/lib/auth";
import { errorMessage } from "~/lib/errors";
import { track } from "~/lib/track";
import { zipStream } from "~/lib/zip";
import type { Route } from "./+types/admin.files.export[.zip]";

/**
 * Bulk download: LATEST version of each selected chain. Default grouping is
 * one folder per session/speaker; `group=flat` puts everything in one folder.
 * Any version's id selects its whole chain; `all=1` exports every chain.
 * `preflight=1` returns the count/limit result without streaming bytes.
 */
export async function loader({ context, request }: Route.LoaderArgs) {
	const env = context.cloudflare.env;
	const user = await requireAdmin(env, request);
	const event = await getActiveEvent(env, user);
	if (!event) throw data(null, { status: 404 });
	const db = getDb(env);
	const url = new URL(request.url);
	const fileIds = url.searchParams.getAll("fileIds").filter(Boolean);
	const all = url.searchParams.get("all") === "1";
	const preflight = url.searchParams.get("preflight") === "1";
	const grouping = parseZipGrouping(url.searchParams.get("group"));
	if (!all && fileIds.length === 0) {
		const message = "Select at least one file to export.";
		if (preflight) {
			return Response.json({ error: message }, { status: 400 });
		}
		throw data(message, { status: 400 });
	}

	const ranked = rankedChainsSql(event.id);
	const canonical = canonicalRowsSql(event.id);

	type LatestRow = {
		id: string;
		r2_key: string;
		file_name: string;
		size_bytes: number | null;
		submission_id: string | null;
		contact_id: string | null;
	};
	const selection = all
		? sql``
		: sql`and r.grp in (
				select distinct c.grp from ${canonical} c
				where c.id in (
					select value from json_each(${JSON.stringify(fileIds)})
				)
			)`;
	const latest = await db.all<LatestRow>(sql`
			select id, r2_key, file_name, size_bytes, submission_id, contact_id
			from ${ranked} r
			where r.rn = 1 ${selection}`);
	latest.sort(
		(a, b) =>
			(a.submission_id ?? "").localeCompare(b.submission_id ?? "") ||
			a.file_name.localeCompare(b.file_name),
	);
	const check = preflightZipExport(
		latest.map((file) => ({ sizeBytes: file.size_bytes })),
	);
	if (!check.ok) {
		if (preflight) {
			return Response.json({ error: check.message }, { status: check.status });
		}
		throw data(check.message, { status: check.status });
	}
	if (preflight) {
		return Response.json({
			files: check.files,
			totalBytes: check.totalBytes,
		});
	}

	const folders =
		grouping === "flat" ? null : await folderNames(db, event.id, latest);
	const usedPaths = new Set<string>();
	const entries = latest.map((f) => ({
		fileId: f.id,
		r2Key: f.r2_key,
		path: uniquePath(
			usedPaths,
			grouping === "flat"
				? "Files"
				: (folders?.get(
						f.submission_id ?? (f.contact_id ? `c:${f.contact_id}` : ""),
					) ?? "Unassigned"),
			sanitizeFileName(f.file_name),
		),
	}));

	const eventId = event.id;
	track("file.zip_export", {
		eventId,
		files: entries.length,
		totalBytes: check.totalBytes,
		scope: all ? "all" : "selection",
		grouping,
	});

	async function* sources() {
		try {
			for (const entry of entries) {
				const object = await env.BLOBS.get(entry.r2Key);
				// A row without its blob is corrupt state — surface it, never ship
				// a silently incomplete archive.
				if (!object) {
					throw new Error(`missing blob for file ${entry.fileId}`);
				}
				yield { path: entry.path, body: object.body };
			}
		} catch (error) {
			// The 200 already went out — this is the only trace the failure leaves.
			track("file.zip_export_failed", {
				eventId,
				error: errorMessage(error),
			});
			throw error;
		}
	}

	const stamp = new Date().toISOString().slice(0, 10);
	return new Response(zipStream(sources()), {
		headers: {
			"Content-Type": "application/zip",
			"Content-Disposition": `attachment; filename="${sanitizeFileName(event.slug)}-files-${stamp}.zip"`,
			"Cache-Control": "private, no-store",
		},
	});
}

/** Folder per session (title, de-duplicated); contact-only files group under
 * the speaker's name; event-level files under "Event files". */
async function folderNames(
	db: ReturnType<typeof getDb>,
	eventId: string,
	rows: Array<{ submission_id: string | null; contact_id: string | null }>,
): Promise<Map<string, string>> {
	const folders = new Map<string, string>();
	const used = new Set<string>();
	const claim = (base: string) => {
		let name = base;
		for (let n = 2; used.has(name.toLowerCase()); n += 1)
			name = `${base} (${n})`;
		used.add(name.toLowerCase());
		return name;
	};

	const submissionIds = [
		...new Set(
			rows.map((r) => r.submission_id).filter((v): v is string => !!v),
		),
	];
	if (submissionIds.length > 0) {
		const subs = await db
			.select({ id: submissions.id, title: submissions.title })
			.from(submissions)
			.where(
				and(
					inArray(submissions.id, submissionIds),
					eq(submissions.eventId, eventId),
				),
			);
		for (const s of subs) {
			folders.set(s.id, claim(sanitizeFileName(s.title) || "Session"));
		}
	}
	const contactIds = [
		...new Set(
			rows
				.filter((r) => !r.submission_id && r.contact_id)
				.map((r) => r.contact_id as string),
		),
	];
	if (contactIds.length > 0) {
		const people = await db
			.select({
				id: contacts.id,
				firstName: contacts.firstName,
				lastName: contacts.lastName,
			})
			.from(contacts)
			.where(
				and(inArray(contacts.id, contactIds), eq(contacts.eventId, eventId)),
			);
		for (const c of people) {
			folders.set(
				`c:${c.id}`,
				claim(sanitizeFileName(`${c.firstName} ${c.lastName}`) || "Speaker"),
			);
		}
	}
	folders.set("", claim("Event files"));
	return folders;
}

function uniquePath(used: Set<string>, folder: string, name: string): string {
	const dot = name.lastIndexOf(".");
	const stem = dot > 0 ? name.slice(0, dot) : name;
	const ext = dot > 0 ? name.slice(dot) : "";
	let path = `${folder}/${name}`;
	for (let n = 2; used.has(path.toLowerCase()); n += 1) {
		path = `${folder}/${stem} (${n})${ext}`;
	}
	used.add(path.toLowerCase());
	return path;
}
