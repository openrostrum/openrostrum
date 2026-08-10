import { z } from "zod";

/**
 * Wire shape for wizard mutations (draft save + submit). Values are bounded so
 * a forged POST can't stuff megabytes into D1; real caps (required fields,
 * max lengths, role counts) are enforced against the form definition.
 */

const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const ParticipantPayload = z.object({
	key: z.string().min(1).max(120),
	role: z.enum(["speaker", "chairperson", "moderator", "secondary"]),
	firstName: z.string().max(255).default(""),
	lastName: z.string().max(255).default(""),
	email: z.string().max(320).default(""),
	mobilePhone: z.string().max(60).default(""),
	bio: z.string().max(30000).default(""),
	self: z.boolean().optional(),
});

export const WizardPayload = z.object({
	wizardId: z.string().regex(UUID_RE, "invalid wizard id"),
	sid: z.string().max(120).optional(),
	values: z.record(z.string().max(120), z.string().max(60000)),
	participants: z.array(ParticipantPayload).max(30),
});

export type WizardPayloadData = z.infer<typeof WizardPayload>;

/** Keep at most one self row — the server maps it to the signed-in account. */
export function normalizeSelfRows(
	participants: WizardPayloadData["participants"],
): WizardPayloadData["participants"] {
	let seenSelf = false;
	return participants.map((p) => {
		if (!p.self) return p;
		if (seenSelf) return { ...p, self: undefined };
		seenSelf = true;
		return p;
	});
}
