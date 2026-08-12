import type { Dispatch, SetStateAction } from "react";
import type { SelfContact, WizardParticipant, WizardState } from "./definition";

/**
 * Client-side wizard carrier: values live in React state owned by the wizard
 * layout and reach the step routes via outlet context, so stepping persists
 * nothing server-side. The server sees data only on explicit "Save as draft"
 * and Submit — a failed validation or an abandoned tab leaves zero rows behind.
 */
export type WizardCtx = {
	state: WizardState | null;
	setState: Dispatch<SetStateAction<WizardState | null>>;
	reset: () => void;
};

export function selfParticipant(prefill: SelfContact): WizardParticipant {
	return {
		key: "self",
		role: "speaker",
		firstName: prefill.firstName,
		lastName: prefill.lastName,
		email: prefill.email,
		mobilePhone: prefill.mobilePhone,
		bio: prefill.bio,
		self: true,
	};
}

export function newWizardState(prefill: SelfContact): WizardState {
	return {
		wizardId: crypto.randomUUID(),
		values: {},
		participants: [selfParticipant(prefill)],
	};
}

/**
 * Serializable mutation body for fetcher/submit JSON posts. The JSON
 * round-trip strips `undefined` members so the value satisfies the router's
 * JsonValue constraint.
 */
export function wizardPayload(
	intent: "save-draft" | "submit",
	state: WizardState,
) {
	return JSON.parse(
		JSON.stringify({
			intent,
			wizardId: state.wizardId,
			sid: state.sid,
			values: state.values,
			participants: state.participants,
		}),
	);
}

export function stepPath(
	base: string,
	step: "account" | "session" | "participant" | "review" | "success",
	sid?: string,
): string {
	return `${base}/step/${step}${sid ? `?sid=${sid}` : ""}`;
}
