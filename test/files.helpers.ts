import { env } from "cloudflare:test";
import { getDb } from "../app/db";
import {
	events,
	organizationMembers,
	organizations,
	submissions,
	taskAssignments,
	users,
} from "../app/db/schema";
import { createSession, hashPassword } from "../app/lib/auth";
import { seedTasksBaseline } from "./tasks-fixtures";

export const CONTEXT = { cloudflare: { env, ctx: {} } };

/**
 * The tasks baseline (org1/e1, Priya/Bob/Carol, the slides file-request task,
 * accepted submissions s1/s2) PLUS a second tenant (org2/e2 with submission
 * s_e2) so cross-tenant probes fail against something real, and Priya's
 * slides assignment — the portal upload loop's anchor.
 */
export async function seedFilesWorld() {
	const db = await seedTasksBaseline();
	await db.insert(organizations).values({ id: "org2", name: "Other Org" });
	await db.insert(events).values({
		id: "e2",
		organizationId: "org2",
		name: "OtherConf",
		slug: "otherconf",
	});
	await db.insert(submissions).values({
		id: "s_e2",
		eventId: "e2",
		title: "Foreign talk",
		status: "accepted",
	});
	await db.insert(taskAssignments).values({
		id: "ta_priya_slides",
		taskId: "t_slides",
		contactId: "c_priya",
		submissionId: "s1",
		status: "incomplete",
	});
	return db;
}

export async function makeUser(
	id: string,
	email: string,
	role: "admin" | "speaker" | "reviewer" = "speaker",
	opts: { activeEventId?: string | null; memberOfOrg?: string } = {},
) {
	const db = getDb(env);
	await db.insert(users).values({
		id,
		email,
		passwordHash: await hashPassword("pw"),
		role,
		activeEventId: opts.activeEventId ?? null,
	});
	if (opts.memberOfOrg) {
		await db.insert(organizationMembers).values({
			id: `om_${id}`,
			organizationId: opts.memberOfOrg,
			userId: id,
		});
	}
}

export async function requestAs(
	userId: string,
	url: string,
	init?: RequestInit,
): Promise<Request> {
	const setCookie = await createSession(env, userId);
	const headers = new Headers(init?.headers);
	headers.set("Cookie", setCookie.split(";")[0] ?? "");
	return new Request(url, { ...init, headers });
}

/** Multipart body for the upload action. */
export function uploadForm(
	file: { name: string; content: string | Uint8Array; type?: string },
	fields: Record<string, string> = {},
): FormData {
	const form = new FormData();
	form.set(
		"file",
		new File([file.content], file.name, {
			type: file.type ?? "application/pdf",
		}),
	);
	for (const [key, value] of Object.entries(fields)) form.set(key, value);
	return form;
}

/** Unwraps a loader/action data() result. */
export function unwrap<T>(result: unknown): T {
	const maybe = result as { data?: T };
	return maybe && typeof maybe === "object" && "data" in maybe && maybe.data
		? maybe.data
		: (result as T);
}

/** Runs fn and returns the thrown value (fails the test if nothing throws). */
export async function catchThrown(
	fn: () => Promise<unknown>,
): Promise<unknown> {
	try {
		await fn();
	} catch (thrown) {
		return thrown;
	}
	throw new Error("expected the call to throw, but it returned");
}

export function thrownStatus(thrown: unknown): number | undefined {
	if (thrown instanceof Response) return thrown.status;
	return (thrown as { init?: { status?: number } }).init?.status;
}

/**
 * Minimal ZIP reader driven by the APPNOTE layout (EOCD → central directory →
 * local headers) — the independent oracle the writer is checked against.
 */
export function parseZip(
	buf: Uint8Array,
): Array<{ path: string; crc: number; data: Uint8Array }> {
	const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
	let eocd = -1;
	for (let i = buf.length - 22; i >= 0; i -= 1) {
		if (view.getUint32(i, true) === 0x06054b50) {
			eocd = i;
			break;
		}
	}
	if (eocd < 0) throw new Error("no end-of-central-directory record");
	const count = view.getUint16(eocd + 10, true);
	let offset = view.getUint32(eocd + 16, true);
	const decoder = new TextDecoder();
	const entries: Array<{ path: string; crc: number; data: Uint8Array }> = [];
	for (let n = 0; n < count; n += 1) {
		if (view.getUint32(offset, true) !== 0x02014b50) {
			throw new Error("bad central directory signature");
		}
		const crc = view.getUint32(offset + 16, true);
		const compressedSize = view.getUint32(offset + 20, true);
		const nameLen = view.getUint16(offset + 28, true);
		const extraLen = view.getUint16(offset + 30, true);
		const commentLen = view.getUint16(offset + 32, true);
		const localOffset = view.getUint32(offset + 42, true);
		const path = decoder.decode(buf.slice(offset + 46, offset + 46 + nameLen));
		const localNameLen = view.getUint16(localOffset + 26, true);
		const localExtraLen = view.getUint16(localOffset + 28, true);
		const dataStart = localOffset + 30 + localNameLen + localExtraLen;
		entries.push({
			path,
			crc,
			data: buf.slice(dataStart, dataStart + compressedSize),
		});
		offset += 46 + nameLen + extraLen + commentLen;
	}
	return entries;
}
