/**
 * The dashboard's first-run checklist. Done-states are DERIVED from live
 * rows on every load — never stored — so work done or undone outside the
 * checklist (a deleted form, a cleared location) always reflects honestly.
 */

export const GETTING_STARTED_STEPS = [
	"basics",
	"cfp",
	"program",
	"reviewers",
	"first_submission",
] as const;

export type GettingStartedStepId = (typeof GETTING_STARTED_STEPS)[number];

export type GettingStartedFacts = {
	hasDates: boolean;
	hasLocation: boolean;
	trackCount: number;
	formatCount: number;
	/** Forms whose status left `draft` — a closed form was still published. */
	publishedFormCount: number;
	reviewerCount: number;
	submissionCount: number;
};

export type GettingStartedState = {
	steps: Array<{ id: GettingStartedStepId; done: boolean }>;
	doneCount: number;
	complete: boolean;
	/** First incomplete step in journey order — the one the card highlights. */
	activeStepId: GettingStartedStepId | null;
};

export function deriveGettingStarted(
	facts: GettingStartedFacts,
): GettingStartedState {
	const done: Record<GettingStartedStepId, boolean> = {
		basics: facts.hasDates && facts.hasLocation,
		program: facts.trackCount > 0 && facts.formatCount > 0,
		cfp: facts.publishedFormCount > 0,
		reviewers: facts.reviewerCount > 0,
		first_submission: facts.submissionCount > 0,
	};
	const steps = GETTING_STARTED_STEPS.map((id) => ({ id, done: done[id] }));
	const doneCount = steps.reduce((n, s) => n + (s.done ? 1 : 0), 0);
	return {
		steps,
		doneCount,
		complete: doneCount === steps.length,
		activeStepId: steps.find((s) => !s.done)?.id ?? null,
	};
}
