import { PIPELINE_STAGE } from "~/db/constants";
import type { BadgeTone } from "~/ui";

export type PipelineStage = (typeof PIPELINE_STAGE)[number];

export const PIPELINE_STAGE_LABEL: Record<PipelineStage, string> = {
	researching: "Researching",
	identified: "Identified",
	approved: "Approved",
	contacted: "Contacted",
	interested: "Interested",
	confirmed: "Confirmed",
	future_fit: "Future fit",
	declined: "Declined",
};

export const PIPELINE_STAGE_TONE: Record<PipelineStage, BadgeTone> = {
	researching: "faint",
	identified: "neutral",
	approved: "info",
	contacted: "warning",
	interested: "caution",
	confirmed: "success",
	future_fit: "info",
	declined: "danger",
};
