/**
 * THE home for cookie serialization/parsing. Security-relevant attributes
 * (HttpOnly, SameSite, Secure) must never fork between the session cookie and
 * any other cookie — change policy here and every cookie follows.
 */

export function cookieHeader(
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

export function readCookie(request: Request, name: string): string | null {
	const header = request.headers.get("Cookie");
	if (!header) return null;
	for (const part of header.split(";")) {
		const [partName, ...rest] = part.trim().split("=");
		if (partName === name) return rest.join("=");
	}
	return null;
}
