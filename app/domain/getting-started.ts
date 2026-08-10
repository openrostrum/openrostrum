/**
 * The dashboard's first-run checklist. Every step's done-state is DERIVED from
 * live data on each load — nothing is stored per step, so work done outside
 * the checklist (or undone: a form deleted, the location cleared) is always
 * reflected honestly. The only stored bit is the explicit dismissal
 * (app/lib/getting-started-dismissal.ts).
 */

export const GETTING_STARTED_STEPS = [
	"basics",
	"program",
	"cfp",
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
	/** Non-draft submissions. */
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
