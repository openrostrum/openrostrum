import { Form } from "react-router";
import type {
	GettingStartedState,
	GettingStartedStepId,
} from "~/domain/getting-started";
import { useBusy } from "~/lib/use-busy";
import { Button, Panel, TextLink } from "~/ui";
import { cn } from "~/ui/cn";
import { CopyButton } from "./copy-button";
import { SectionHeading } from "./section-heading";
import { StepMarker } from "./step-marker";

export const STEP_COPY: Record<
	GettingStartedStepId,
	{ title: string; why: string; to: string; action: string }
> = {
	basics: {
		title: "Confirm your event basics",
		why: "Dates and location appear on every public page — speakers plan around them.",
		to: "/admin/settings",
		action: "Open settings",
	},
	cfp: {
		title: "Build and publish your submission form",
		why: "Publishing creates the public link speakers use to send proposals.",
		to: "/admin/forms",
		action: "Open forms",
	},
	program: {
		title: "Set up tracks and formats",
		why: "They drive the dropdowns on your form, reviewer routing, and the agenda.",
		to: "/admin/settings/library",
		action: "Open library",
	},
	reviewers: {
		title: "Invite reviewers",
		why: "Reviewers cover tracks, and submissions route to them for a decision.",
		to: "/admin/reviewers",
		action: "Invite reviewers",
	},
	first_submission: {
		title: "Receive your first submission",
		why: "Checks itself off when the first proposal lands — share your CFP link to get it moving.",
		to: "/admin/submissions",
		action: "View submissions",
	},
};

const NO_LINK_YET_WHY =
	"Checks itself off when the first proposal lands — publish your form first to get a shareable link.";

export function GettingStartedCard({
	state,
	cfpUrl,
}: {
	state: GettingStartedState;
	cfpUrl: string | null;
}) {
	const busy = useBusy();
	const firstTalkLanded =
		state.steps.find((s) => s.id === "first_submission")?.done === true;
	const cfpPublished = state.steps.find((s) => s.id === "cfp")?.done === true;
	return (
		<Panel>
			<div className="flex flex-col gap-1">
				<div className="flex flex-wrap items-center gap-x-4 gap-y-2">
					<div className="flex flex-col gap-1">
						<SectionHeading>
							{firstTalkLanded
								? "Finish setup — tracks, reviewers, …"
								: "Getting started"}
						</SectionHeading>
						<p className="text-[12.5px] text-fg-muted">
							{firstTalkLanded
								? cfpPublished
									? "Your CFP is live. This card disappears once everything is done."
									: "A talk has landed. This card disappears once everything is done."
								: "Five steps from an empty event to your first submission. This card disappears once everything is done."}
						</p>
					</div>
					<div className="ml-auto flex items-center gap-3">
						<span className="font-mono text-[12px] font-medium tabular-nums text-fg-muted">
							{state.doneCount} of {state.steps.length} done
						</span>
						<Form method="post">
							<input
								type="hidden"
								name="intent"
								value="dismiss-getting-started"
							/>
							<Button type="submit" variant="ghost" disabled={busy}>
								Don&rsquo;t show again
							</Button>
						</Form>
					</div>
				</div>
				<ol className="mt-2 flex flex-col">
					{state.steps.map((step, index) => {
						const copy = STEP_COPY[step.id];
						const active = step.id === state.activeStepId;
						const why =
							step.id === "first_submission" && !step.done && cfpUrl === null
								? NO_LINK_YET_WHY
								: copy.why;
						return (
							<li
								key={step.id}
								className="flex items-start gap-[10px] border-t border-hair py-[10px] first:border-t-0"
							>
								<StepMarker index={index} done={step.done} active={active} />
								<div className="flex min-w-0 flex-1 flex-col gap-[2px] pt-[2px]">
									<span
										className={cn(
											"text-[13px] font-medium",
											step.done ? "text-fg-muted" : "text-fg",
										)}
									>
										{copy.title}
									</span>
									<span
										className={cn(
											"text-[12.5px]",
											step.done ? "text-fg-faint" : "text-fg-muted",
										)}
									>
										{why}
									</span>
									{step.id === "cfp" && step.done && cfpUrl !== null && (
										<span className="truncate font-mono text-[12px] text-fg-muted">
											{cfpUrl}
										</span>
									)}
								</div>
								{!step.done && (
									<div className="flex shrink-0 items-center pt-[3px]">
										{step.id === "first_submission" ? (
											cfpUrl !== null && (
												<CopyButton
													value={cfpUrl}
													label="Copy CFP link"
													failedLabel="Copy failed — open forms for the link"
												/>
											)
										) : (
											<TextLink to={copy.to}>{copy.action} →</TextLink>
										)}
									</div>
								)}
							</li>
						);
					})}
				</ol>
			</div>
		</Panel>
	);
}
