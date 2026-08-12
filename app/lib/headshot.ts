// Client-safe headshot rules shared by the portal and admin upload surfaces —
// schema-free on purpose so components can import the accept/constraint copy
// without pulling drizzle into the client bundle.
export const HEADSHOT_TYPES: Record<string, string> = {
	"image/png": "png",
	"image/jpeg": "jpg",
	"image/webp": "webp",
};

export const HEADSHOT_MAX_BYTES = 5 * 1024 * 1024;

export const HEADSHOT_ACCEPT = Object.keys(HEADSHOT_TYPES).join(",");

export const HEADSHOT_CONSTRAINTS =
	"PNG, JPEG, or WebP — square works best (300×300), up to 5 MB.";

/** Cache-busts on the key's random suffix — a new upload mints a new key. */
export function headshotUrl(path: string, key: string | null): string | null {
	if (!key) return null;
	return `${path}${path.includes("?") ? "&" : "?"}v=${key.slice(-20)}`;
}
