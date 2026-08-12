import { useLocation } from "react-router";
import { cn } from "~/ui/cn";
import { StepMarker } from "./step-marker";

export const ONBOARDING_STEPS = [
	{ path: "/onboarding", label: "Your conference" },
	{ path: "/onboarding/dates", label: "Dates" },
	{ path: "/onboarding/place", label: "Location" },
] as const;

/**
 * Reads the step off the URL rather than a prop: each step is its own route, so
 * the browser's back button and a refresh land on the same rail state the
 * server rendered.
 */
export function OnboardingSteps() {
	const { pathname } = useLocation();
	const normalized =
		pathname.length > 1 && pathname.endsWith("/")
			? pathname.slice(0, -1)
			: pathname;
	const current = ONBOARDING_STEPS.findIndex((s) => s.path === normalized);
	return (
		<ol className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
			{ONBOARDING_STEPS.map((step, index) => (
				<li key={step.path} className="flex items-center gap-[7px]">
					<StepMarker
						index={index}
						done={index < current}
						active={index === current}
					/>
					<span
						className={cn(
							"text-[12.5px]",
							index === current ? "font-medium text-fg" : "text-fg-muted",
						)}
					>
						{step.label}
					</span>
				</li>
			))}
		</ol>
	);
}
