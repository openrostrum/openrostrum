// The one cookie codec — every cookie the app reads or sets goes through
// here (session auth, theme). Pass `secure` from `isSecureRequest(request)`:
// a `Secure` cookie set over local http is silently dropped by browsers
// (Safari, LAN hosts).

export function readCookie(request: Request, name: string): string | null {
	const header = request.headers.get("Cookie");
	if (!header) return null;
	for (const part of header.split(";")) {
		const [key, ...rest] = part.trim().split("=");
		if (key === name) return rest.join("=");
	}
	return null;
}

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
