import { and, eq, inArray, sql } from "drizzle-orm";
import { data } from "react-router";
import { getDb } from "~/db";
import { contacts, files, submissions } from "~/db/schema";
import { GROUP_KEY_SQL, groupKeyOf, sanitizeFileName } from "~/domain/files";
import { getActiveEvent, requireAdmin } from "~/lib/auth";
import { track } from "~/lib/track";
import { zipStream } from "~/lib/zip";
import type { Route } from "./+types/admin.files.export[.zip]";

// No zip64 support in the writer; cap what one archive may carry.
const MAX_TOTAL_BYTES = 3.5 * 1024 * 1024 * 1024;
const MAX_ENTRIES = 10_000;

/**
 * Bulk download: ONE folder per session, LATEST version of each selected
 * chain only (Sessionboard parity — older versions stay on the file detail).
 * `fileIds` narrows to the selected chains (any version's id selects its whole
 * chain); `all=1` exports every chain in the event. The archive streams —
 * download starts immediately, no "generating" wait state, no email hop.
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
	if (!all && fileIds.length === 0) {
		throw data("Select at least one file to export.", { status: 400 });
	}

	// Selected ids (whatever version they point at) resolve to chain keys, and
	// every resolution is scoped to the ACTIVE event — foreign ids drop out.
	let selectedKeys: string[] | null = null;
	if (!all) {
		const selected = await db
			.select()
			.from(files)
			.where(and(inArray(files.id, fileIds), eq(files.eventId, event.id)));
		selectedKeys = [...new Set(selected.map(groupKeyOf))];
		if (selectedKeys.length === 0) throw data(null, { status: 404 });
	}

	const latest = await db.all<{
		id: string;
		r2_key: string;
		file_name: string;
		size_bytes: number | null;
		submission_id: string | null;
		contact_id: string | null;
	}>(sql`
		select id, r2_key, file_name, size_bytes, submission_id, contact_id
		from (
			select ${files}.*,
				${GROUP_KEY_SQL} as grp,
				row_number() over (
					partition by ${GROUP_KEY_SQL}
					order by ${files.version} desc, ${files.createdAt} desc, ${files.id} desc
				) as rn
			from ${files}
			where ${files.eventId} = ${event.id}
		) r
		where r.rn = 1${
			selectedKeys
				? sql` and r.grp in (${sql.join(
						selectedKeys.map((k) => sql`${k}`),
						sql`, `,
					)})`
				: sql``
		}
		order by r.submission_id, r.file_name`);
	if (latest.length === 0) {
		throw data("Nothing to export yet — no files match.", { status: 404 });
	}
	if (latest.length > MAX_ENTRIES) {
		throw data("Too many files for one archive — narrow the selection.", {
			status: 400,
		});
	}
	const totalBytes = latest.reduce((sum, f) => sum + (f.size_bytes ?? 0), 0);
	if (totalBytes > MAX_TOTAL_BYTES) {
		throw data(
			"This selection exceeds the 3.5 GB archive limit — narrow the selection.",
			{ status: 400 },
		);
	}

	const folders = await folderNames(db, event.id, latest);
	const usedPaths = new Set<string>();
	const entries = latest.map((f) => ({
		fileId: f.id,
		r2Key: f.r2_key,
		path: uniquePath(
			usedPaths,
			folders.get(
				f.submission_id ?? (f.contact_id ? `c:${f.contact_id}` : ""),
			) ?? "Unassigned",
			sanitizeFileName(f.file_name),
		),
	}));

	track("file.zip_export", {
		eventId: event.id,
		files: entries.length,
		totalBytes,
		scope: all ? "all" : "selection",
	});

	async function* sources() {
		for (const entry of entries) {
			const object = await env.BLOBS.get(entry.r2Key);
			// A row without its blob is corrupt state — surface it, never ship a
			// silently incomplete archive.
			if (!object) {
				throw new Error(`missing blob for file ${entry.fileId}`);
			}
			yield { path: entry.path, body: object.body };
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
