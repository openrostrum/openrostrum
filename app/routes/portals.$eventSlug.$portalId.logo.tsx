import { data } from "react-router";
import { getPortalContext, serveBlob } from "~/domain/portal";
import { requireUser } from "~/lib/auth";
import type { Route } from "./+types/portals.$eventSlug.$portalId.logo";

/** Serves the portal's configured logo (per-portal appearance) to portal users. */
export async function loader({ context, request, params }: Route.LoaderArgs) {
	const env = context.cloudflare.env;
	const user = await requireUser(env, request);
	const ctx = await getPortalContext(env, user, params);
	if (!ctx.portal.logoKey) throw data(null, { status: 404 });
	return serveBlob(env, ctx.portal.logoKey);
}
