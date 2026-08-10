const X_HANDLE = /^[A-Za-z0-9_]{1,15}$/;

/**
 * People hand over their X (Twitter) identity in every shape — `@handle`,
 * bare handle, `x.com/handle`, full URL — and imports/admin edits have
 * stored bare handles verbatim. One canonicalizer for every write path:
 * handles become `https://x.com/<handle>`, scheme-less URLs gain `https://`,
 * and unrecognizable input is null so each caller decides (reject fresh
 * input; keep an already-stored value so it never blocks an unrelated save).
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
