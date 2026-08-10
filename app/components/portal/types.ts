import type { PortalStatus } from "~/domain/portal";

/** Loader-serialized status projection (label + tone, never a raw enum).
 * Type-only re-export of the domain projection — erased at build, so the
 * server module never enters the client bundle. */
export type StatusView = PortalStatus;

export type ParticipationView = {
	id: string;
	status: StatusView;
	raw: string;
	confirmable: boolean;
};

export type SubmissionRowView = {
	id: string;
	title: string;
	status: StatusView;
	format: string | null;
	participation: ParticipationView | null;
};

export type TaskRowView = {
	id: string;
	name: string;
	required: boolean;
	type: string;
	status: StatusView;
	open: boolean;
	overdue: boolean;
	due: string | null;
	submissionTitle?: string | null;
};
