import { redirect } from "react-router";
import { isSecureRequest } from "~/lib/auth";
import { parseTheme, themeCookie } from "~/lib/theme";
import { track } from "~/lib/track";
import type { Route } from "./+types/theme";

// @public — the theme preference is per-browser, not per-account: the login
// page needs it before any session exists. Resource route (no UI): POST
// { theme } persists the tri-state choice; the fetcher revalidation re-runs
// the root loader, which re-reads the cookie onto <html>.

// A bare GET (typed URL) has nothing to show — send it home.
export async function loader() {
	return redirect("/");
}

export async function action({ request }: Route.ActionArgs) {
	const form = await request.formData();
	const theme = parseTheme(form.get("theme"));
	if (!theme) {
		return Response.json(
			{ error: "theme must be system, light, or dark." },
			{ status: 400 },
		);
	}
	track("theme.set", { theme });
	return Response.json(
		{ theme },
		{ headers: { "Set-Cookie": themeCookie(theme, isSecureRequest(request)) } },
	);
}
