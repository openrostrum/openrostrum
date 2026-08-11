import { isRouteErrorResponse } from "react-router";
import { toError } from "~/lib/errors";

export type ErrorPageContent = {
	title: string;
	body: string;
	/** Dev-only diagnostics — must stay undefined outside dev builds. */
	detail?: string;
};

/**
 * The one mapping from a thrown error to user-facing copy for the root
 * boundary. Raw errors can carry SQL, row values, or file paths, so outside
 * dev builds the message/stack never reaches the response — only the copy
 * below does.
 */
export function describeRouteError(
	error: unknown,
	isDev: boolean,
): ErrorPageContent {
	if (isRouteErrorResponse(error)) {
		if (error.status === 404) {
			return {
				title: "Page not found",
				body: "There's nothing at this address — the link may be outdated or mistyped. Check the URL, or start over from the homepage.",
			};
		}
		return {
			title: "Something went wrong",
			body: `The server couldn't complete this request (HTTP ${error.status}). Try again in a moment — if it keeps happening, let the event organizers know.`,
		};
	}
	let detail: string | undefined;
	if (isDev) {
		const err = toError(error);
		detail = err.stack ?? err.message;
	}
	return {
		title: "Something went wrong",
		body: "An unexpected error interrupted this page. Refresh to try again, or head back to the homepage.",
		detail,
	};
}
