import { data, redirect } from "react-router";
import { FullPageEmptyState } from "~/components/full-page-empty-state";
import { getDb } from "~/db";
import { submitPath } from "~/domain/forms";
import { oldestOpenForm } from "~/lib/forms.server";
import { getEventBySlug } from "~/lib/program";
import { ButtonLink } from "~/ui";
import type { Route } from "./+types/cfp.$eventSlug";

// @public — no open form is an empty page, not a draft UUID and not a 500.

export async function loader({ context, params }: Route.LoaderArgs) {
	const db = getDb(context.cloudflare.env);
	const event = await getEventBySlug(db, params.eventSlug);
	if (!event) throw data("Event not found", { status: 404 });
	const form = await oldestOpenForm(db, event.id);
	if (form) return redirect(submitPath(event.slug, form.publicId));
	return { eventName: event.name };
}

export default function EventCfp({ loaderData }: Route.ComponentProps) {
	return (
		<FullPageEmptyState
			icon="mic"
			title="Submissions aren't open yet"
			body={`${loaderData.eventName} hasn't published a call for papers. Check back once the organizers open the form, or use the link they sent you.`}
			actions={
				<ButtonLink to="/" variant="ghost">
					Go to homepage
				</ButtonLink>
			}
		/>
	);
}
