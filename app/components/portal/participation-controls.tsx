import { useFetcher } from "react-router";
import { ConfirmButton, StatusBadge } from "~/ui";

import { Muted } from "./bits";
import type { ParticipationView } from "./types";

/**
 * Per-PERSON Confirm/Withdraw on an Accepted session. Drives ONLY the
 * caller's own participants row — the action re-verifies ownership.
 */
export function ParticipationControls({
	action,
	participation,
}: {
	/** URL of the owning submission's action. */
	action: string;
	participation: ParticipationView;
}) {
	const fetcher = useFetcher<{ formError?: string }>();
	if (!participation.confirmable) return null;
	return (
		<fetcher.Form
			method="post"
			action={action}
			className="flex flex-wrap items-center gap-2"
		>
			<input type="hidden" name="participantId" value={participation.id} />
			<Muted>Your participation:</Muted>
			<StatusBadge tone={participation.status.tone}>
				{participation.status.label}
			</StatusBadge>
			{participation.raw !== "accepted" && (
				<ConfirmButton
					label="Confirm participation"
					prompt="Confirm you will participate in this session?"
					confirmLabel="Yes, confirm"
					name="intent"
					value="confirm-participation"
					variant="primary"
				/>
			)}
			{participation.raw !== "declined" && (
				<ConfirmButton
					label="Withdraw"
					prompt="Withdraw your participation? The event team will see this."
					confirmLabel="Yes, withdraw"
					name="intent"
					value="withdraw-participation"
				/>
			)}
			{fetcher.data?.formError && (
				<Muted tone="danger">{fetcher.data.formError}</Muted>
			)}
		</fetcher.Form>
	);
}
