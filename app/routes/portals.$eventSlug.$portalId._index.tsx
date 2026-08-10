// @public — pure param-derived redirect: no data is read or written here; the
// destination's own loader authenticates.
import { redirect } from "react-router";
import type { Route } from "./+types/portals.$eventSlug.$portalId._index";

export function loader({ params }: Route.LoaderArgs) {
	return redirect(`/portals/${params.eventSlug}/${params.portalId}/home`);
}
