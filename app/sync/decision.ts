import type { Db } from "~/db";
import { DECISION_STATUS } from "~/db/constants";
import type { Submission } from "~/db/schema";
import { transitionSubmissions } from "~/domain/accept";

/**
 * Inbound decision edits (the team flips Status in Airtable) run through the
 * shared accept spine — the same transition + auto-provisioning path the
 * admin UI uses — never raw column writes, or acceptance side effects
 * (speaker linking, onboarding-task provisioning) would silently not fire.
 * This module is the sync engine's single binding point to that spine; the
 * runner hands it rows already loaded and Demo-org-filtered, matching the
 * spine's caller contract.
 */

export type DecisionTarget = (typeof DECISION_STATUS)[number];

export interface DecisionOutcome {
	submissionId: string;
	ok: boolean;
	reason?: string;
}

export async function applyDecision(
	db: Db,
	rows: Submission[],
	to: DecisionTarget,
): Promise<DecisionOutcome[]> {
	const results = await transitionSubmissions(db, rows, to);
	return results.map((r) => ({
		submissionId: r.submissionId,
		ok: r.ok,
		reason: r.reason,
	}));
}
