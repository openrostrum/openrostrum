import { eq } from "drizzle-orm";
import { redirect } from "react-router";
import { z } from "zod";
import { getDb } from "~/db";
import { users } from "~/db/schema";
import { requireAdmin, safeRedirect, userCanAccessEvent } from "~/lib/auth";
import { createTimings, track } from "~/lib/track";
import type { Route } from "./+types/admin.events.switch";

// Resource route (no UI): POST { eventId, redirectTo? } sets the caller's
// current event. The membership check is the tenancy guard — activeEventId can
// only ever point at an event of an org the caller belongs to.

const SwitchRequest = z.object({
	eventId: z.string().min(1),
	// A missing or non-text redirectTo is not a bad request — it means "home".
	redirectTo: z.string().nullish().catch(null),
});

// A bare GET (typed URL, stale link) has nothing to show — send it home.
export async function loader({ context, request }: Route.LoaderArgs) {
	await requireAdmin(context.cloudflare.env, request);
	return redirect("/admin");
}

export async function action({ context, request }: Route.ActionArgs) {
	const env = context.cloudflare.env;
	// Actions MUST self-authenticate — a POST does not run any layout loader.
	const user = await requireAdmin(env, request);
	const form = await request.formData();
	const parsed = SwitchRequest.safeParse({
		eventId: form.get("eventId"),
		redirectTo: form.get("redirectTo"),
	});
	if (!parsed.success) {
		return Response.json({ error: "eventId is required." }, { status: 400 });
	}
	const { eventId, redirectTo } = parsed.data;

	// One 403 for both "another org's event" and "no such event" — a different
	// answer per case would disclose which event ids exist across tenants.
	if (!(await userCanAccessEvent(env, user.id, eventId))) {
		track("event.switch_denied", { eventId, userId: user.id });
		return Response.json(
			{ error: "You don't have access to that event." },
			{ status: 403 },
		);
	}

	const timings = createTimings();
	await timings.time("db", () =>
		getDb(env)
			.update(users)
			.set({ activeEventId: eventId })
			.where(eq(users.id, user.id)),
	);
	track("event.switched", { eventId, userId: user.id });

	const dest = safeRedirect(redirectTo ?? "") ?? "/admin";
	return redirect(dest, { headers: { "Server-Timing": timings.header() } });
}
