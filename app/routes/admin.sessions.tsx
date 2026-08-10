import { getActiveEvent, requireAdmin } from "~/lib/auth";
import { SubmissionListPage } from "~/lib/submission-list";
import {
	loadSubmissionList,
	submissionListAction,
} from "~/lib/submission-list.server";
import { PageHeader } from "~/ui";
import type { Route } from "./+types/admin.sessions";

// Sessions = the session-side view (type "session"): schedule info, content
// approval, and the one-click "Approve all accepted" gate opener. Shares one
// implementation with the Abstracts tab.

export function headers({ actionHeaders, loaderHeaders }: Route.HeadersArgs) {
	return actionHeaders.has("Server-Timing") ? actionHeaders : loaderHeaders;
}

export async function loader({ context, request }: Route.LoaderArgs) {
	const env = context.cloudflare.env;
	// Self-authenticate — single-fetch can run this loader alone via `?_routes=`.
	const user = await requireAdmin(env, request);
	const event = await getActiveEvent(env, user);
	return loadSubmissionList(env, event, request, "session");
}

export async function action({ context, request }: Route.ActionArgs) {
	const env = context.cloudflare.env;
	const user = await requireAdmin(env, request);
	const event = await getActiveEvent(env, user);
	if (!event) return { formError: "No event is configured yet." };
	return submissionListAction(env, event, request);
}

export default function Sessions({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	return (
		<SubmissionListPage
			kind="session"
			title="Sessions"
			data={loaderData}
			actionData={actionData ?? undefined}
		/>
	);
}

export function ErrorBoundary() {
	// Generic copy only — raw errors can carry SQL/row values.
	return (
		<div className="mx-auto max-w-6xl px-7 py-6">
			<PageHeader
				title="Failed to load sessions"
				tone="danger"
				subtitle="Something went wrong. Please refresh or try again."
			/>
		</div>
	);
}
