import { requireOnboardingEvent } from "~/domain/onboarding";
import { requireAdmin } from "~/lib/auth";
import type { Route } from "./+types/onboarding.place";

export async function loader({ context, request }: Route.LoaderArgs) {
	const env = context.cloudflare.env;
	const user = await requireAdmin(env, request);
	await requireOnboardingEvent(env, user);
}

export async function action({ context, request }: Route.ActionArgs) {
	const env = context.cloudflare.env;
	const user = await requireAdmin(env, request);
	await requireOnboardingEvent(env, user);
}
