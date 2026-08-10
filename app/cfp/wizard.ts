import type { Dispatch, SetStateAction } from "react";
import type { WizardParticipant, WizardState } from "./definition";

/**
 * Client-side wizard carrier: values live in React state owned by the wizard
 * layout and shared with the step routes via outlet context, so stepping
 * never persists anything server-side. The server sees data only on explicit
 * "Save as draft" and on Submit — a failed validation or an abandoned tab
 * leaves zero rows behind.
 */
export type WizardCtx = {
	state: WizardState | null;
	setState: Dispatch<SetStateAction<WizardState | null>>;
	reset: () => void;
};

export type SelfPrefill = {
	firstName: string;
	lastName: string;
	email: string;
	mobilePhone: string;
	bio: string;
};

export function selfParticipant(prefill: SelfPrefill): WizardParticipant {
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

export function newWizardState(prefill: SelfPrefill): WizardState {
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

export function submitBasePath(eventSlug: string, formId: string): string {
	return `/submit/${eventSlug}/${formId}`;
}

export function stepPath(
	base: string,
	step: "account" | "session" | "participant" | "review" | "success",
	sid?: string,
): string {
	return `${base}/step/${step}${sid ? `?sid=${sid}` : ""}`;
}
