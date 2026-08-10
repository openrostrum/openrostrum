/**
 * Signed unsubscribe tokens + the announcement send path. The token embeds
 * the address and an HMAC so the footer link works logged-out without letting
 * anyone unsubscribe an arbitrary address. Tokens never expire — links in
 * already-sent emails must keep resolving.
 *
 * Suppression is deliberately person-global: one address, one list, across
 * organizations — over-suppressing is the safe failure mode.
 */
import {
	type EmailMessage,
	type EmailResult,
	getEmailSender,
} from "~/ports/email";

// Local-only fallback: with no real mail provider configured, tokens never
// leave the machine. When RESEND_API_KEY is set, a real secret is REQUIRED —
// forgeable production tokens would let anyone suppress any address.
const DEV_SECRET = "openrostrum-local-dev-unsubscribe-secret";

function secretFor(env: Env): string {
	if (env.UNSUBSCRIBE_SECRET) return env.UNSUBSCRIBE_SECRET;
	if (env.RESEND_API_KEY) {
		throw new Error(
			"UNSUBSCRIBE_SECRET is not configured — real mail carries unsubscribe links; set the secret so tokens can't be forged.",
		);
	}
	return DEV_SECRET;
}

function toBase64Url(bytes: Uint8Array): string {
	let binary = "";
	for (const b of bytes) binary += String.fromCharCode(b);
	return btoa(binary)
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array | null {
	const b64 = value.replaceAll("-", "+").replaceAll("_", "/");
	try {
		const binary = atob(b64);
		const bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
		return bytes;
	} catch {
		return null;
	}
}

async function hmac(env: Env, message: string): Promise<Uint8Array> {
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secretFor(env)),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const sig = await crypto.subtle.sign(
		"HMAC",
		key,
		new TextEncoder().encode(message),
	);
	return new Uint8Array(sig);
}

export async function mintUnsubscribeToken(
	env: Env,
	email: string,
): Promise<string> {
	const addr = email.trim().toLowerCase();
	const sig = await hmac(env, addr);
	return `${toBase64Url(new TextEncoder().encode(addr))}.${toBase64Url(sig)}`;
}

/** Returns the (normalized) address the token was minted for, or null. */
export async function verifyUnsubscribeToken(
	env: Env,
	token: string,
): Promise<string | null> {
	const [emailPart, sigPart] = token.split(".");
	if (!emailPart || !sigPart) return null;
	const emailBytes = fromBase64Url(emailPart);
	const sigBytes = fromBase64Url(sigPart);
	if (!emailBytes || !sigBytes) return null;
	const email = new TextDecoder().decode(emailBytes);
	if (!email.includes("@")) return null;
	const expected = await hmac(env, email);
	if (sigBytes.length !== expected.length) return null;
	let diff = 0;
	for (let i = 0; i < expected.length; i += 1)
		diff |= (expected[i] ?? 0) ^ (sigBytes[i] ?? 0);
	return diff === 0 ? email : null;
}

export async function unsubscribeUrl(
	env: Env,
	origin: string,
	email: string,
): Promise<string> {
	return `${origin}/unsubscribe/${await mintUnsubscribeToken(env, email)}`;
}

async function appendUnsubscribeFooter(
	env: Env,
	html: string,
	origin: string,
	email: string,
): Promise<string> {
	const url = await unsubscribeUrl(env, origin, email);
	return `${html}<hr style="margin-top:24px;border:none;border-top:1px solid #ddd" /><p style="font-size:12px;color:#777">You received this announcement from an event organizer. <a href="${url}">Unsubscribe</a> from announcements — you'll still receive emails about your own submissions.</p>`;
}

/**
 * THE way to send an announcement. Couples the two halves no bulk send may
 * separate — the unsubscribe footer and `kind: "bulk"` (suppression check) —
 * into one call, so a compliant send is the only send a caller can write.
 * Transactional mail (about the recipient's own submissions/account) goes
 * through the EmailSender port directly and never carries the footer.
 */
export async function sendAnnouncement(
	env: Env,
	origin: string,
	msg: Omit<EmailMessage, "kind">,
): Promise<EmailResult> {
	const html = await appendUnsubscribeFooter(env, msg.html, origin, msg.to);
	return getEmailSender(env).send({ ...msg, html, kind: "bulk" });
}
