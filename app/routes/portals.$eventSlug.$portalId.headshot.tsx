import { data } from "react-router";
import { getPortalContext } from "~/domain/portal";
import { requireUser } from "~/lib/auth";
import type { Route } from "./+types/portals.$eventSlug.$portalId.headshot";

/** Serves the CALLER's own headshot bytes — the r2 key never leaves the server. */
export async function loader({ context, request, params }: Route.LoaderArgs) {
	const env = context.cloudflare.env;
	const user = await requireUser(env, request);
	const ctx = await getPortalContext(env, user, params);
	const key = ctx.contact?.headshotKey;
	if (!key) throw data(null, { status: 404 });
	const object = await env.BLOBS.get(key);
	if (!object) throw data(null, { status: 404 });
	return new Response(object.body, {
		headers: {
			"Content-Type":
				object.httpMetadata?.contentType ?? "application/octet-stream",
			"Cache-Control": "private, max-age=3600",
		},
	});
}
