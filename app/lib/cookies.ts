// The one codec for the app's first-party state cookies (session id, theme).
// The contract is deliberately narrow: token-safe values (no `;`/`=`) and a
// fixed HttpOnly/SameSite=Lax/Path=/ attribute set — a cookie needing more
// widens this signature, it doesn't fork the codec.

export function readCookie(request: Request, name: string): string | null {
	const header = request.headers.get("Cookie");
	if (!header) return null;
	for (const part of header.split(";")) {
		const [key, ...rest] = part.trim().split("=");
		if (key === name) return rest.join("=");
	}
	return null;
}

/** Pass `secure` from `isSecureRequest(request)`: browsers silently drop a
 * `Secure` cookie set over local http (Safari, LAN hosts). */
export function serializeCookie(
	name: string,
	value: string,
	maxAgeSeconds: number,
	secure: boolean,
): string {
	const attrs = [
		`${name}=${value}`,
		"Path=/",
		"HttpOnly",
		"SameSite=Lax",
		`Max-Age=${maxAgeSeconds}`,
	];
	if (secure) attrs.push("Secure");
	return attrs.join("; ");
}
