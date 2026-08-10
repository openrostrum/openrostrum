import type { BadgeTone } from "~/ui";

/** Loader-serialized status projection (label + tone, never a raw enum). */
export type StatusView = { label: string; tone: BadgeTone };

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
