import { Outlet } from "react-router";
import { OnboardingSteps } from "~/components/onboarding-steps";
import { requireAdmin } from "~/lib/auth";
import { PageHeader, Wordmark } from "~/ui";
import type { Route } from "./+types/onboarding";

/**
 * First-run shell: wordmark, step rail, one step. Every step is its own URL so
 * refresh, the back button, and a re-opened tab all land where the server says
 * the organizer is, without a wizard state machine in the client.
 */
export async function loader({ context, request }: Route.LoaderArgs) {
	await requireAdmin(context.cloudflare.env, request);
	return null;
}

export default function OnboardingLayout() {
	return (
		<main className="mx-auto flex min-h-screen w-full max-w-[560px] flex-col justify-center gap-7 px-6 py-16">
			<div className="flex flex-col items-center gap-4">
				<Wordmark size={21} />
				<OnboardingSteps />
			</div>
			<Outlet />
		</main>
	);
}

export function ErrorBoundary() {
	return (
		<main className="mx-auto max-w-[560px] px-6 py-16">
			<PageHeader
				title="Setup failed to load"
				tone="danger"
				subtitle="Something went wrong. Please refresh or try again."
			/>
		</main>
	);
}
