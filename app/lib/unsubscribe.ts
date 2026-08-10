/**
 * Signed unsubscribe tokens. The token embeds the address and an HMAC so the
 * footer link works logged-out without letting anyone unsubscribe an
 * arbitrary address. Tokens never expire — links in already-sent emails must
 * keep resolving.
 *
 * Suppression is deliberately person-global: one address, one list, across
 * organizations — over-suppressing is the safe failure mode.
 */

// Fallback for local dev/tests only. Any DEPLOYED instance (APP_ENV
// production, or a real mail provider configured) must set its own secret:
// this constant is published in the open-source repo, and a token signed
// with a public key would let anyone permanently suppress any address.
const DEV_SECRET = "openrostrum-local-dev-unsubscribe-secret";

function secretFor(env: Env): string {
	if (env.UNSUBSCRIBE_SECRET) return env.UNSUBSCRIBE_SECRET;
	if (env.APP_ENV === "production" || env.RESEND_API_KEY) {
		throw new Error(
			"UNSUBSCRIBE_SECRET is not configured — unsubscribe links on a deployed instance must not be forgeable; set the secret.",
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

function hmacKey(env: Env): Promise<CryptoKey> {
	return crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secretFor(env)),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign", "verify"],
	);
}

export async function mintUnsubscribeToken(
	env: Env,
	email: string,
): Promise<string> {
	const addr = email.trim().toLowerCase();
	const message = new TextEncoder().encode(addr);
	const sig = await crypto.subtle.sign("HMAC", await hmacKey(env), message);
	return `${toBase64Url(message)}.${toBase64Url(new Uint8Array(sig))}`;
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
	// subtle.verify is the platform's constant-time HMAC check.
	const ok = await crypto.subtle.verify(
		"HMAC",
		await hmacKey(env),
		sigBytes as BufferSource,
		emailBytes as BufferSource,
	);
	return ok ? email : null;
}

export async function unsubscribeUrl(
	env: Env,
	origin: string,
	email: string,
): Promise<string> {
	return `${origin}/unsubscribe/${await mintUnsubscribeToken(env, email)}`;
}
