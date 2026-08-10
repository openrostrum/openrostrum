import type { CONTACT_STATUS } from "~/db/constants";
import type { BadgeTone } from "~/ui";

export const CONTACT_STATUS_TONE: Record<
	(typeof CONTACT_STATUS)[number],
	BadgeTone
> = {
	pending: "warning",
	invited: "info",
	confirmed: "success",
	declined: "danger",
};
