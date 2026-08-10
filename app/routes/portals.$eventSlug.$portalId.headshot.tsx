import { data } from "react-router";
import { serveBlob } from "~/domain/files";
import { getPortalContext } from "~/domain/portal";
import { requireUser } from "~/lib/auth";
import type { Route } from "./+types/portals.$eventSlug.$portalId.headshot";

/** Serves the CALLER's own headshot bytes — the r2 key never leaves the server. */
export async function loader({ context, request, params }: Route.LoaderArgs) {
	const env = context.cloudflare.env;
	const user = await requireUser(env, request);
	const ctx = await getPortalContext(env, user, params, request);
	if (!ctx.contact?.headshotKey) throw data(null, { status: 404 });
	return serveBlob(env, ctx.contact.headshotKey);
}
