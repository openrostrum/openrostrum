// @public — the Sessionboard-compat API authenticates every request itself
// via the org-scoped x-access-token guard inside the Hono app (no session).
import { apiV1 } from "~/api/v1/app";
import type { Route } from "./+types/api.v1.$";

export async function loader({ request, context }: Route.LoaderArgs) {
	return apiV1.fetch(request, context.cloudflare.env, context.cloudflare.ctx);
}

export async function action({ request, context }: Route.ActionArgs) {
	return apiV1.fetch(request, context.cloudflare.env, context.cloudflare.ctx);
}
