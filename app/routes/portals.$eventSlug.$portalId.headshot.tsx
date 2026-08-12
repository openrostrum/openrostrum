import { data } from "react-router";
import { serveBlob } from "~/domain/files";
import { getPortalContext, visibleHeadshotKey } from "~/domain/portal";
import { requireUser } from "~/lib/auth";
import type { Route } from "./+types/portals.$eventSlug.$portalId.headshot";

/**
 * Serves headshot bytes to a portal user — their own by default, or a named
 * co-speaker's via `?contact=`. The r2 key never leaves the server, and an
 * unauthorized id is a 404, never a silent fall back to the caller's own face.
 */
export async function loader({ context, request, params }: Route.LoaderArgs) {
	const env = context.cloudflare.env;
	const user = await requireUser(env, request);
	const ctx = await getPortalContext(env, user, params, request);
	const requested = new URL(request.url).searchParams.get("contact");
	const key = await visibleHeadshotKey(env, ctx, requested);
	if (!key) throw data(null, { status: 404 });
	return serveBlob(env, key);
}
