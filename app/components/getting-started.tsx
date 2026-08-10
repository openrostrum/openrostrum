import { Form, useNavigation } from "react-router";
import type {
	GettingStartedState,
	GettingStartedStepId,
} from "~/domain/getting-started";
import { Button, Icon, Panel, TextLink } from "~/ui";
import { cn } from "~/ui/cn";
import { CopyButton } from "./copy-button";
import { SectionHeading } from "./section-heading";

const STEP_COPY: Record<
	GettingStartedStepId,
	{ title: string; why: string; to: string; action: string }
> = {
	basics: {
		title: "Confirm your event basics",
		why: "Dates and location appear on every public page — speakers plan around them.",
		to: "/admin/settings",
		action: "Open settings",
	},
	program: {
		title: "Set up tracks and formats",
		why: "They drive the dropdowns on your form, reviewer routing, and the agenda.",
		to: "/admin/settings/library",
		action: "Open library",
	},
	cfp: {
		title: "Build and publish your submission form",
		why: "Publishing creates the public link speakers use to send proposals.",
		to: "/admin/forms",
		action: "Open forms",
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

function StepMarker({
	index,
	done,
	active,
}: {
	index: number;
	done: boolean;
	active: boolean;
}) {
	if (done) {
		return (
			<span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center text-fg-faint">
				<Icon name="check-square" size={16} />
			</span>
		);
	}
	return (
		<span
			className={cn(
				"flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full font-mono text-[11px] font-medium tabular-nums",
				active
					? "bg-petrol-wash text-petrol"
					: "text-fg-faint shadow-[inset_0_0_0_1px_var(--color-hair-strong)]",
			)}
		>
			{index + 1}
		</span>
	);
}

/**
 * First-run checklist for an event still in setup. Step states arrive fully
 * derived (app/domain/getting-started.ts); this card only renders them and
 * hosts the dismiss form, which posts back to the dashboard's own action.
 */
export function GettingStartedCard({
	state,
	cfpUrl,
}: {
	state: GettingStartedState;
	cfpUrl: string | null;
}) {
	const busy = useNavigation().state !== "idle";
	return (
		<Panel>
			<div className="flex flex-col gap-1">
				<div className="flex flex-wrap items-center gap-x-4 gap-y-2">
					<div className="flex flex-col gap-1">
						<SectionHeading>Getting started</SectionHeading>
						<p className="text-[12.5px] text-fg-muted">
							Five steps from an empty event to your first submission. This card
							disappears once everything is done.
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
