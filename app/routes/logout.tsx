// @public — logout must work regardless of session validity.
import { redirect } from "react-router";
import { destroySession } from "~/lib/auth";
import type { Route } from "./+types/logout";

export async function action({ context, request }: Route.ActionArgs) {
	const cookie = await destroySession(context.cloudflare.env, request);
	return redirect("/login", { headers: { "Set-Cookie": cookie } });
}

export function loader() {
	return redirect("/login");
}
