// @public — the denial page must render for every role, and for signed-out
// visitors who followed a stale link.
import { Form } from "react-router";
import { getUser, homePathForRole } from "~/lib/auth";
import { Button, ButtonLink, EmptyState } from "~/ui";
import type { Route } from "./+types/403";

const HOME_LABELS: Record<string, string> = {
	"/admin": "Go to your dashboard",
	"/reviews": "Go to your reviews",
	"/portal": "Go to your portal",
};

export function meta(_: Route.MetaArgs) {
	return [{ title: "No access — OpenRostrum" }];
}

export async function loader({ context, request }: Route.LoaderArgs) {
	const user = await getUser(context.cloudflare.env, request);
	if (!user) return { viewer: null };
	const homePath = homePathForRole(user.role);
	return {
		viewer: {
			email: user.email,
			homePath,
			homeLabel: HOME_LABELS[homePath] ?? "Go to your home page",
		},
	};
}

export default function Forbidden({ loaderData }: Route.ComponentProps) {
	const { viewer } = loaderData;
	return (
		<main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6">
			<EmptyState
				icon="users"
				title="You don't have access to this page"
				body={
					viewer
						? `You're signed in as ${viewer.email}, and this page belongs to a different role. Head to your own workspace, or sign in with another account.`
						: "This page needs a signed-in account with the right role. Sign in to continue."
				}
				action={
					viewer ? (
						<div className="flex flex-wrap items-center justify-center gap-2">
							<ButtonLink to={viewer.homePath}>{viewer.homeLabel}</ButtonLink>
							<Form method="post" action="/logout">
								<Button type="submit" variant="ghost">
									Sign out
								</Button>
							</Form>
						</div>
					) : (
						<ButtonLink to="/login">Sign in</ButtonLink>
					)
				}
			/>
		</main>
	);
}
