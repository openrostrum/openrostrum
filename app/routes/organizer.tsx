import { redirect } from "react-router";

// @public — conventional-path alias; /admin authenticates itself.
export function loader() {
	return redirect("/admin");
}
