const X_HANDLE = /^[A-Za-z0-9_]{1,15}$/;

/**
 * One canonicalizer for every X (Twitter) write path: `@handle`/`handle` →
 * `https://x.com/<handle>`, scheme-less URLs gain `https://`, and
 * unrecognizable input returns null so each caller decides what to do.
 */
export function normalizeXUrl(raw: string): string | null {
	const value = raw.trim();
	if (!value) return "";
	const handle = value.startsWith("@") ? value.slice(1) : value;
	if (X_HANDLE.test(handle)) return `https://x.com/${handle}`;
	const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
	try {
		if (new URL(withScheme).hostname.includes(".")) return withScheme;
	} catch {
		// not URL-shaped either — fall through to null
	}
	return null;
}
