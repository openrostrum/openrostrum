// @public — Airtable webhook pings authenticate by HMAC signature
// (X-Airtable-Content-MAC over the raw body, keyed by the webhook's MAC
// secret), not by session: Airtable's servers are the caller.
import { track } from "~/lib/track";
import { getDb } from "~/db";
import { readSyncState, runAirtableSync, writeSyncState } from "~/sync/runner";
import type { Route } from "./+types/hooks.airtable";

const MAC_HEADER = "X-Airtable-Content-MAC";

function hexToBytes(hex: string): Uint8Array | null {
	if (hex.length % 2 !== 0 || /[^0-9a-f]/i.test(hex)) return null;
	const bytes = new Uint8Array(hex.length / 2);
	for (let i = 0; i < bytes.length; i += 1) {
		bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
	}
	return bytes;
}

function base64ToBytes(value: string): Uint8Array | null {
	try {
		const binary = atob(value);
		const bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
		return bytes;
	} catch {
		return null;
	}
}

async function verifyMac(
	secretBase64: string,
	body: string,
	header: string | null,
): Promise<boolean> {
	// Header shape: "hmac-sha256=<hex digest>".
	const presented = header?.startsWith("hmac-sha256=")
		? hexToBytes(header.slice("hmac-sha256=".length))
		: null;
	const secret = base64ToBytes(secretBase64);
	if (!presented || !secret) return false;
	const key = await crypto.subtle.importKey(
		"raw",
		secret as unknown as BufferSource,
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const expected = new Uint8Array(
		await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)),
	);
	if (presented.length !== expected.length) return false;
	let diff = 0;
	for (let i = 0; i < expected.length; i += 1) {
		diff |= (presented[i] ?? 0) ^ (expected[i] ?? 0);
	}
	return diff === 0;
}

export async function loader() {
	return new Response("Method Not Allowed", { status: 405 });
}

export async function action({ context, request }: Route.ActionArgs) {
	const env = context.cloudflare.env;
	const secret = env.AIRTABLE_WEBHOOK_SECRET;
	if (!secret || !env.AIRTABLE_BASE_ID) {
		track("sync.webhook_rejected", { reason: "not_configured" });
		return new Response("Airtable webhook is not configured", { status: 503 });
	}

	const body = await request.text();
	if (!(await verifyMac(secret, body, request.headers.get(MAC_HEADER)))) {
		track("sync.webhook_rejected", { reason: "bad_mac" });
		return new Response("Invalid signature", { status: 401 });
	}

	let ping: {
		base?: { id?: string };
		webhook?: { id?: string };
		timestamp?: string;
	};
	try {
		ping = JSON.parse(body) as typeof ping;
	} catch {
		track("sync.webhook_rejected", { reason: "bad_payload" });
		return new Response("Invalid payload", { status: 400 });
	}
	if (ping.base?.id !== env.AIRTABLE_BASE_ID) {
		track("sync.webhook_rejected", { reason: "base_mismatch" });
		return new Response("Unknown base", { status: 401 });
	}

	// At-least-once delivery: a replay (timestamp not newer than the last seen
	// ping) is tracked as such, and re-running the tick is a no-op by design.
	const db = getDb(env);
	const state = await readSyncState(db);
	const replayed = Boolean(
		ping.timestamp &&
			state.lastWebhookAt &&
			ping.timestamp <= state.lastWebhookAt,
	);
	track("sync.webhook_ping", {
		webhookId: ping.webhook?.id ?? null,
		replayed,
	});
	if (!replayed && ping.timestamp) {
		await writeSyncState(db, { ...state, lastWebhookAt: ping.timestamp });
	}

	// Respond immediately (Airtable disables webhooks after repeated slow/failed
	// deliveries); the reconcile tick runs out-of-band on this invocation.
	context.cloudflare.ctx.waitUntil(
		runAirtableSync(env, { trigger: "webhook" }),
	);
	return Response.json({ ok: true });
}
