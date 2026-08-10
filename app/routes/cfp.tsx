import { and, asc, eq } from "drizzle-orm";
import { redirect } from "react-router";
import { getDb } from "~/db";
import { forms } from "~/db/schema";
import { getDefaultEvent } from "~/lib/program";
import type { Route } from "./+types/cfp";

// @public — bare /cfp lands on the default event's oldest OPEN submission
// form. The homepage's "Call for speakers" link needs a stable URL: the real
// form path carries a per-form uuid (`/submit/<slug>/<uuid>`) nobody should
// have to know up front. No open form (or no event) → back to the homepage.
export async function loader({ context }: Route.LoaderArgs) {
	const db = getDb(context.cloudflare.env);
	const event = await getDefaultEvent(db);
	if (!event) return redirect("/");
	const [form] = await db
		.select({ publicId: forms.publicId })
		.from(forms)
		.where(and(eq(forms.eventId, event.id), eq(forms.status, "open")))
		.orderBy(asc(forms.createdAt))
		.limit(1);
	return redirect(form ? `/submit/${event.slug}/${form.publicId}` : "/");
}
