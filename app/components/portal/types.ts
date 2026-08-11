import type { PortalStatus, PortalTaskRow } from "~/domain/portal";

/** Loader-serialized projections. Type-only re-exports of the domain shapes —
 * erased at build, so the server module never enters the client bundle. */
export type StatusView = PortalStatus;
export type TaskRowView = PortalTaskRow;

/** My Tasks vs Submission Tasks — the ONE classification both pages share. */
export const isSubmissionTask = (t: { type: string }) =>
	t.type === "submission";

export type ParticipationView = {
	id: string;
	status: StatusView;
	raw: string;
	confirmable: boolean;
	roleLabel?: string;
};

export type SubmissionRowView = {
	id: string;
	title: string;
	status: StatusView;
	format: string | null;
	participation: ParticipationView | null;
};
