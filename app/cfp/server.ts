import { and, count, eq, inArray, isNull, ne } from "drizzle-orm";
import { getDb } from "~/db";
import {
	contacts,
	emailTemplates,
	events,
	formats,
	formFields,
	forms,
	languages,
	levels,
	participants,
	portals,
	submissionAnswers,
	submissionRevisions,
	submissions,
	submissionTags,
	submissionTracks,
	tags,
	tracks,
	fields as fieldsTable,
} from "~/db/schema";
import type { AddedParticipant } from "~/domain/participant-notifications";
import { normalizeEmail } from "~/lib/auth";
import { getEmailSender } from "~/ports/email";
import {
	BUILTIN_META,
	builtinKey,
	type BuiltinRef,
	DEFAULT_PARTICIPANT_BUILTINS,
	DEFAULT_SESSION_BUILTINS,
	fieldKey,
	isFieldVisible,
	isUnanswerableSelect,
	joinMultiValue,
	participantExtraFields,
	type RoleConfig,
	type SelfContact,
	splitMultiValue,
	type WizardField,
	type WizardParticipant,
	type WizardRule,
	type WizardValues,
} from "./definition";

type Db = ReturnType<typeof getDb>;
export type PublicForm = typeof forms.$inferSelect;
export type PublicEvent = typeof events.$inferSelect;

/* ------------------------------------------------------------- form load --- */

export async function loadPublicForm(
	env: Env,
	eventSlug: string,
	formPublicId: string,
): Promise<{ form: PublicForm; event: PublicEvent } | null> {
	const db = getDb(env);
	const [row] = await db
		.select({ form: forms, event: events })
		.from(forms)
		.innerJoin(events, eq(events.id, forms.eventId))
		.where(and(eq(forms.publicId, formPublicId), eq(events.slug, eventSlug)))
		.limit(1);
	return row ?? null;
}

/**
 * One closed-ness rule for every consumer (loaders, actions, banner): a form
 * accepts submissions only while its status is "open" AND its close date (if
 * any) is in the future. Reopening = clearing/raising the close date.
 */
export function isFormClosed(
	form: Pick<PublicForm, "status" | "closeAt">,
	now: Date,
): boolean {
	if (form.status !== "open") return true;
	return form.closeAt !== null && form.closeAt.getTime() <= now.getTime();
}

export function closeBannerText(
	form: Pick<PublicForm, "closeAt">,
	timezone: string,
): string | null {
	if (!form.closeAt) return null;
	const date = new Intl.DateTimeFormat("en-US", {
		timeZone: timezone,
		month: "long",
		day: "numeric",
		year: "numeric",
	}).format(form.closeAt);
	const time = new Intl.DateTimeFormat("en-US", {
		timeZone: timezone,
		hour: "numeric",
		minute: "2-digit",
		timeZoneName: "short",
	}).format(form.closeAt);
	return `Form submissions will be accepted until ${date} at ${time}.`;
}

export function effectiveSubmissionLimit(
	form: Pick<PublicForm, "submissionLimit">,
	event: Pick<PublicEvent, "submissionLimit">,
): number | null {
	return form.submissionLimit ?? event.submissionLimit ?? null;
}

/**
 * Submissions counted against the per-user limit: everything the user created
 * on this form except withdrawn ones (withdrawing frees the slot; drafts and
 * decided submissions keep consuming it).
 */
export async function countSubmissionsUsed(
	db: Db,
	formId: string,
	userId: string,
): Promise<number> {
	const [row] = await db
		.select({ used: count() })
		.from(submissions)
		.where(
			and(
				eq(submissions.formId, formId),
				eq(submissions.submitterId, userId),
				ne(submissions.status, "withdrawn"),
			),
		);
	return row?.used ?? 0;
}

/* --------------------------------------------------------- form definition --- */

export type FormDefinition = {
	session: WizardField[];
	participant: WizardField[];
	roles: RoleConfig;
};

async function eventTaxonomies(db: Db, eventId: string) {
	const [formatRows, tagRows, trackRows, levelRows, languageRows] =
		await db.batch([
			db
				.select({ id: formats.id, name: formats.name })
				.from(formats)
				.where(eq(formats.eventId, eventId))
				.orderBy(formats.position, formats.name),
			db
				.select({ id: tags.id, name: tags.name })
				.from(tags)
				.where(eq(tags.eventId, eventId))
				.orderBy(tags.name),
			db
				.select({ id: tracks.id, name: tracks.name })
				.from(tracks)
				.where(eq(tracks.eventId, eventId))
				.orderBy(tracks.name),
			db
				.select({ id: levels.id, name: levels.name })
				.from(levels)
				.where(eq(levels.eventId, eventId))
				.orderBy(levels.position, levels.name),
			db
				.select({ id: languages.id, name: languages.name })
				.from(languages)
				.where(eq(languages.eventId, eventId))
				.orderBy(languages.position, languages.name),
		]);
	return {
		format: formatRows.map((r) => ({ value: r.id, label: r.name })),
		tags: tagRows.map((r) => ({ value: r.id, label: r.name })),
		track: trackRows.map((r) => ({ value: r.id, label: r.name })),
		level: levelRows.map((r) => ({ value: r.id, label: r.name })),
		// Language is stored as a name on the submission, so the option VALUE is
		// the name itself.
		language: languageRows.map((r) => ({ value: r.name, label: r.name })),
	};
}

const TAXONOMY_BUILTINS = new Set([
	"format",
	"tags",
	"track",
	"level",
	"language",
]);

function builtinField(
	ref: BuiltinRef,
	required: boolean,
	locked: boolean,
	rule: WizardRule,
	taxonomies: Awaited<ReturnType<typeof eventTaxonomies>>,
): WizardField {
	const meta = BUILTIN_META[ref];
	return {
		key: builtinKey(ref),
		builtinRef: ref,
		label: meta.label,
		type: meta.type,
		required,
		locked,
		maxLength: meta.maxLength,
		description: meta.note,
		options: TAXONOMY_BUILTINS.has(ref)
			? taxonomies[ref as keyof Awaited<ReturnType<typeof eventTaxonomies>>]
			: undefined,
		rule,
	};
}

/**
 * Resolve what the wizard renders for a form: built-ins + library fields per
 * their form_fields placements (position, required, locked, question rule).
 * A form with no built-in placements in a section gets the canonical default
 * built-in set for that section, with library fields appended after.
 */
export async function resolveFormDefinition(
	db: Db,
	form: PublicForm,
): Promise<FormDefinition> {
	const taxonomies = await eventTaxonomies(db, form.eventId);
	const placements = await db
		.select({
			section: formFields.section,
			position: formFields.position,
			required: formFields.required,
			locked: formFields.locked,
			builtinRef: formFields.builtinRef,
			questionRule: formFields.questionRule,
			fieldId: fieldsTable.id,
			fieldName: fieldsTable.name,
			fieldType: fieldsTable.type,
			fieldDescription: fieldsTable.description,
			fieldMaxLength: fieldsTable.maxLength,
			fieldOptions: fieldsTable.options,
		})
		.from(formFields)
		.leftJoin(fieldsTable, eq(fieldsTable.id, formFields.fieldId))
		.where(eq(formFields.formId, form.id))
		.orderBy(formFields.position, formFields.createdAt);

	const bySection = (section: "session" | "participant") => {
		const rows = placements.filter((p) => p.section === section);
		const resolved: WizardField[] = [];
		for (const row of rows) {
			if (row.builtinRef) {
				resolved.push(
					builtinField(
						row.builtinRef,
						row.required,
						row.locked,
						row.questionRule as WizardRule,
						taxonomies,
					),
				);
			} else if (row.fieldId && row.fieldType) {
				resolved.push({
					key: fieldKey(row.fieldId),
					fieldId: row.fieldId,
					label: row.fieldName ?? "Question",
					type: row.fieldType,
					required: row.required,
					locked: row.locked,
					maxLength: row.fieldMaxLength ?? undefined,
					description: row.fieldDescription ?? undefined,
					options: (row.fieldOptions ?? undefined)?.map((o) => ({
						value: o,
						label: o,
					})),
					rule: row.questionRule as WizardRule,
				});
			}
		}
		const hasBuiltins = rows.some((r) => r.builtinRef);
		if (!hasBuiltins) {
			const defaults =
				section === "session"
					? DEFAULT_SESSION_BUILTINS
					: DEFAULT_PARTICIPANT_BUILTINS;
			const defaultFields = defaults.map((d) =>
				builtinField(d.ref, d.required, d.locked, null, taxonomies),
			);
			resolved.unshift(...defaultFields);
		}
		// A select with zero configured options (unconfigured taxonomy on a fresh
		// event) is unanswerable — omitting it here keeps the renderer, both
		// validators, the review summary, and the write path in agreement, so a
		// required-but-empty dropdown can never dead-end the speaker.
		return resolved.filter((f) => !isUnanswerableSelect(f));
	};

	const roles: RoleConfig = {
		speaker: { min: form.roleSpeakerMin, max: form.roleSpeakerMax },
	};
	if (form.allowChairperson)
		roles.chairperson = {
			min: form.roleChairpersonMin,
			max: form.roleChairpersonMax,
		};
	if (form.allowModerator)
		roles.moderator = {
			min: form.roleModeratorMin,
			max: form.roleModeratorMax,
		};

	return {
		session: bySection("session"),
		participant: bySection("participant"),
		roles,
	};
}

/* ------------------------------------------------------------- sanitizing --- */

const ALLOWED_TAGS = new Set([
	"p",
	"strong",
	"b",
	"em",
	"i",
	"u",
	"s",
	"ul",
	"ol",
	"li",
	"br",
	"a",
	"blockquote",
	"code",
	"pre",
	"h2",
	"h3",
]);

/**
 * Allowlist sanitizer for speaker-authored rich text — anything else stored
 * from a public POST would be an XSS onto every admin/portal/public surface
 * that renders it. Keeps formatting tags, strips every attribute except a
 * safe http(s) href, drops script-bearing elements with their content.
 */
const DROPPED_TAGS = [
	"script",
	"style",
	"iframe",
	"object",
	"embed",
	"noscript",
	"svg",
	"math",
	"template",
];

export async function sanitizeHtml(html: string): Promise<string> {
	if (!html) return "";
	let rewriter = new HTMLRewriter();
	for (const tag of DROPPED_TAGS) {
		rewriter = rewriter.on(tag, {
			element(el) {
				el.remove();
			},
		});
	}
	const response = rewriter
		.on("*", {
			element(el) {
				if (!ALLOWED_TAGS.has(el.tagName)) {
					el.removeAndKeepContent();
					return;
				}
				const names = [
					...(el.attributes as unknown as Iterable<[string, string]>),
				].map(([name]) => name);
				for (const name of names) {
					if (el.tagName === "a" && name === "href") {
						const href = el.getAttribute("href") ?? "";
						if (/^https?:\/\//i.test(href)) {
							el.setAttribute("rel", "noopener noreferrer nofollow");
							continue;
						}
					}
					el.removeAttribute(name);
				}
			},
		})
		.transform(new Response(html));
	return await response.text();
}

/* ------------------------------------------------------- contacts linking --- */

/**
 * Attach an authenticated user to THIS event's roster contact carrying their
 * email — a speaker whose address the organizer already imported must land in
 * that contact's portal, not a duplicate identity. Scoped to one event and to
 * unlinked contacts only: it never claims across events and never steals a
 * contact already linked to another user.
 */
export async function linkUserToContacts(
	db: Db,
	eventId: string,
	userId: string,
	email: string,
): Promise<void> {
	await db
		.update(contacts)
		.set({ userId })
		.where(
			and(
				eq(contacts.eventId, eventId),
				eq(contacts.email, normalizeEmail(email)),
				isNull(contacts.userId),
			),
		);
}

export type { SelfContact };

export async function loadSelfContact(
	db: Db,
	eventId: string,
	user: { id: string; email: string; name: string | null },
): Promise<SelfContact> {
	const [row] = await db
		.select()
		.from(contacts)
		.where(and(eq(contacts.eventId, eventId), eq(contacts.userId, user.id)))
		.limit(1);
	if (row) {
		return {
			firstName: row.firstName,
			lastName: row.lastName,
			email: row.email,
			mobilePhone: row.mobilePhone ?? "",
			bio: row.bio ?? "",
		};
	}
	const [first = "", ...rest] = (user.name ?? "").trim().split(/\s+/);
	return {
		firstName: first,
		lastName: rest.join(" "),
		email: user.email,
		mobilePhone: "",
		bio: "",
	};
}

/* --------------------------------------------------------------- writing --- */

type WriteInput = {
	form: PublicForm;
	definition: FormDefinition;
	user: { id: string; email: string; name: string | null };
	wizardId: string;
	sid?: string;
	values: WizardValues;
	participants: WizardParticipant[];
};

/**
 * The stored record must equal the record the speaker reviewed: values whose
 * question a rule currently hides are dropped at write time, exactly as the
 * validator and the review summary skip them.
 */
/** Every field whose value can be stored: session + once-per-submission participant extras. */
function answerableFields(definition: FormDefinition): WizardField[] {
	return [
		...definition.session,
		...participantExtraFields(definition.participant),
	];
}

function visibleAnswerKeys(
	definition: FormDefinition,
	values: WizardValues,
): Set<string> {
	const fields = answerableFields(definition);
	return new Set(
		fields.filter((f) => isFieldVisible(f, values, fields)).map((f) => f.key),
	);
}

/** Participant-section built-ins that live on the submitter's own contact. */
const SELF_CONTACT_BUILTINS = [
	["company_name", "companyName"],
	["job_title", "jobTitle"],
	["home_phone", "homePhone"],
	["zip", "zip"],
] as const;

function selfContactExtras(
	definition: FormDefinition,
	values: WizardValues,
	visibleKeys: Set<string>,
): Partial<Record<(typeof SELF_CONTACT_BUILTINS)[number][1], string | null>> {
	const extras: Record<string, string | null> = {};
	for (const [ref, column] of SELF_CONTACT_BUILTINS) {
		const key = builtinKey(ref);
		const placed = definition.participant.some((f) => f.key === key);
		if (!placed || !visibleKeys.has(key)) continue;
		extras[column] = (values[key] ?? "").trim() || null;
	}
	return extras;
}

function taxonomyValue(
	values: WizardValues,
	ref: string,
	definition: FormDefinition,
	visibleKeys: Set<string>,
): string | null {
	const key = builtinKey(ref);
	const field = definition.session.find((f) => f.key === key);
	// A built-in the form doesn't place at all has no descriptor and stays
	// storable (defaults like language); a placed-but-rule-hidden one drops.
	if (field && !visibleKeys.has(key)) return null;
	const raw = (values[key] ?? "").trim();
	if (!raw) return null;
	if (field?.options && !field.options.some((o) => o.value === raw)) {
		return null;
	}
	return raw;
}

type BatchStatement = Parameters<Db["batch"]>[0][number];

type ExistingParticipantLink = {
	id: string;
	contactId: string;
	role: WizardParticipant["role"];
	email: string;
};

async function loadExistingParticipantLinks(
	db: Db,
	submissionId: string,
): Promise<ExistingParticipantLink[]> {
	return db
		.select({
			id: participants.id,
			contactId: participants.contactId,
			role: participants.role,
			email: contacts.email,
		})
		.from(participants)
		.innerJoin(contacts, eq(contacts.id, participants.contactId))
		.where(eq(participants.submissionId, submissionId));
}

function persistedDuplicateKeys(
	rows: WizardParticipant[],
	existingLinks: ExistingParticipantLink[],
): Set<string> {
	const byId = new Map(existingLinks.map((link) => [link.id, link]));
	const groups = new Map<string, WizardParticipant[]>();
	for (const row of rows) {
		const email = normalizeEmail(row.email);
		if (!email) continue;
		const group = groups.get(email) ?? [];
		group.push(row);
		groups.set(email, group);
	}

	const allowed = new Set<string>();
	for (const [email, group] of groups) {
		if (group.length < 2) continue;
		const links = group.map((row) => byId.get(row.key));
		if (
			links.some((link) => !link || normalizeEmail(link.email) !== email) ||
			new Set(links.map((link) => link?.id)).size !== group.length ||
			new Set(links.map((link) => link?.contactId)).size !== 1
		) {
			continue;
		}
		for (const row of group) allowed.add(row.key);
	}
	return allowed;
}

function hasUnretainedDuplicateEmails(
	rows: WizardParticipant[],
	allowed: ReadonlySet<string>,
): boolean {
	const groups = new Map<string, WizardParticipant[]>();
	for (const row of rows) {
		const email = normalizeEmail(row.email);
		if (!email) continue;
		const group = groups.get(email) ?? [];
		group.push(row);
		groups.set(email, group);
	}
	return [...groups.values()].some(
		(group) => group.length > 1 && group.some((row) => !allowed.has(row.key)),
	);
}

export async function markPersistedParticipantRows(
	db: Db,
	input: {
		sid?: string;
		formId: string;
		submitterId: string;
		rows: WizardParticipant[];
	},
): Promise<WizardParticipant[]> {
	if (!input.sid) return input.rows;
	const [submission] = await db
		.select({ id: submissions.id })
		.from(submissions)
		.where(
			and(
				eq(submissions.id, input.sid),
				eq(submissions.formId, input.formId),
				eq(submissions.submitterId, input.submitterId),
			),
		)
		.limit(1);
	if (!submission) return input.rows;
	const existingLinks = await loadExistingParticipantLinks(db, submission.id);
	const allowed = persistedDuplicateKeys(input.rows, existingLinks);
	return input.rows.map((row) => ({
		...row,
		persisted: allowed.has(row.key) || undefined,
	}));
}

/**
 * Plan the contact writes for the wizard's participants: existing contacts
 * are matched by normalized email and NOT overwritten (the organizer's data
 * wins over what a co-speaker typed); the submitter's own contact is theirs,
 * so its fields update; missing contacts get insert statements. Statements
 * join the caller's batch so the whole submission write stays atomic.
 */
async function planParticipantContacts(
	db: Db,
	eventId: string,
	user: WriteInput["user"],
	rows: WizardParticipant[],
	selfExtras: Record<string, string | null>,
): Promise<{
	statements: BatchStatement[];
	contactIdByKey: Map<string, string>;
	wasExistingContactByKey: Map<string, boolean>;
}> {
	const statements: BatchStatement[] = [];
	const contactIdByKey = new Map<string, string>();
	const wasExistingContactByKey = new Map<string, boolean>();
	const plannedByEmail = new Map<
		string,
		{ contactId: string; wasExistingContact: boolean }
	>();
	for (const p of rows) {
		const email = normalizeEmail(p.self ? user.email : p.email);
		const alreadyPlanned = plannedByEmail.get(email);
		if (alreadyPlanned) {
			contactIdByKey.set(p.key, alreadyPlanned.contactId);
			wasExistingContactByKey.set(p.key, alreadyPlanned.wasExistingContact);
			continue;
		}
		const bio = (await sanitizeHtml(p.bio)) || null;
		const [existing] = await db
			.select({ id: contacts.id })
			.from(contacts)
			.where(and(eq(contacts.eventId, eventId), eq(contacts.email, email)))
			.limit(1);
		if (existing) {
			contactIdByKey.set(p.key, existing.id);
			wasExistingContactByKey.set(p.key, true);
			plannedByEmail.set(email, {
				contactId: existing.id,
				wasExistingContact: true,
			});
			if (p.self) {
				statements.push(
					db
						.update(contacts)
						.set({
							firstName: p.firstName.trim(),
							lastName: p.lastName.trim(),
							mobilePhone: p.mobilePhone.trim() || null,
							bio,
							userId: user.id,
							...selfExtras,
						})
						.where(eq(contacts.id, existing.id)) as unknown as BatchStatement,
				);
			}
			continue;
		}
		const id = crypto.randomUUID();
		statements.push(
			db.insert(contacts).values({
				id,
				eventId,
				userId: p.self ? user.id : null,
				email,
				firstName: p.firstName.trim(),
				lastName: p.lastName.trim(),
				mobilePhone: p.mobilePhone.trim() || null,
				bio,
				...(p.self ? selfExtras : {}),
			}) as unknown as BatchStatement,
		);
		contactIdByKey.set(p.key, id);
		wasExistingContactByKey.set(p.key, false);
		plannedByEmail.set(email, {
			contactId: id,
			wasExistingContact: false,
		});
	}
	return { statements, contactIdByKey, wasExistingContactByKey };
}

async function sanitizedAnswers(
	definition: FormDefinition,
	values: WizardValues,
	visibleKeys: Set<string>,
): Promise<Array<{ fieldId: string; value: string }>> {
	const out: Array<{ fieldId: string; value: string }> = [];
	for (const field of answerableFields(definition)) {
		if (!field.fieldId) continue;
		if (!visibleKeys.has(field.key)) continue;
		const raw = (values[field.key] ?? "").trim();
		if (!raw) continue;
		const value = field.type === "wysiwyg" ? await sanitizeHtml(raw) : raw;
		out.push({ fieldId: field.fieldId, value });
	}
	return out;
}

export type WriteResult =
	| {
			ok: true;
			submissionId: string;
			created: boolean;
			/** Status before this write; null when the row was just created. */
			previousStatus: string | null;
			addedParticipants: AddedParticipant[];
	  }
	| { ok: false; error: string; status?: number };

/**
 * Create or update the submission row + its answers/tracks/tags/participants
 * in one D1 batch. `status` decides draft vs pending; edits of an already
 * submitted row keep its status and append a content revision.
 */
export async function writeSubmission(
	db: Db,
	input: WriteInput,
	target: "draft" | "submit",
): Promise<WriteResult> {
	const { form, definition, user, values } = input;

	const [existing] = input.sid
		? await db
				.select({
					id: submissions.id,
					formId: submissions.formId,
					submitterId: submissions.submitterId,
					status: submissions.status,
					language: submissions.language,
				})
				.from(submissions)
				.where(
					and(
						eq(submissions.id, input.sid),
						eq(submissions.eventId, form.eventId),
					),
				)
				.limit(1)
		: [undefined];
	if (input.sid && !existing) {
		return {
			ok: false,
			error: "This submission no longer exists.",
			status: 404,
		};
	}
	if (existing) {
		if (existing.submitterId !== user.id || existing.formId !== form.id) {
			return {
				ok: false,
				error: "You can't edit this submission.",
				status: 403,
			};
		}
	}
	const editingSubmitted =
		existing !== undefined && existing.status !== "draft";
	if (editingSubmitted && target === "draft") {
		return {
			ok: false,
			error:
				"This proposal is already submitted — review your changes and use Save changes instead.",
			status: 400,
		};
	}

	const existingParticipantLinks = existing
		? await loadExistingParticipantLinks(db, existing.id)
		: [];
	const retainedDuplicateKeys = persistedDuplicateKeys(
		input.participants,
		existingParticipantLinks,
	);
	if (hasUnretainedDuplicateEmails(input.participants, retainedDuplicateKeys)) {
		return {
			ok: false,
			error: "Each participant must have a distinct email address.",
			status: 422,
		};
	}

	const visibleKeys = visibleAnswerKeys(definition, values);
	const title = (values[builtinKey("title")] ?? "").trim();
	const description = await sanitizeHtml(
		values[builtinKey("description")] ?? "",
	);
	const formatId = taxonomyValue(values, "format", definition, visibleKeys);
	const levelId = taxonomyValue(values, "level", definition, visibleKeys);
	const trackId = taxonomyValue(values, "track", definition, visibleKeys);
	// Tags are multi-valued: the wizard round-trips the FULL tag set (including
	// organizer-applied tags loaded on resume), so an edit never narrows it to
	// the one value a single dropdown could hold.
	const tagIds = (() => {
		const key = builtinKey("tags");
		const field = definition.session.find((f) => f.key === key);
		if (field && !visibleKeys.has(key)) return [];
		const chosen = splitMultiValue(values[key] ?? "");
		if (!field?.options) return chosen;
		const valid = new Set(field.options.map((o) => o.value));
		return chosen.filter((id) => valid.has(id));
	})();
	const language = taxonomyValue(values, "language", definition, visibleKeys);

	const submissionId = existing?.id ?? input.wizardId;
	const answers = await sanitizedAnswers(definition, values, visibleKeys);
	const contactPlan = await planParticipantContacts(
		db,
		form.eventId,
		user,
		input.participants,
		selfContactExtras(definition, values, visibleKeys),
	);
	const contactIdByKey = contactPlan.contactIdByKey;
	const wasExistingContactByKey = contactPlan.wasExistingContactByKey;

	const core = {
		title,
		description,
		formatId,
		levelId,
		language: language ?? existing?.language ?? "English",
	};

	const statements: BatchStatement[] = [...contactPlan.statements];
	if (!existing) {
		statements.push(
			db.insert(submissions).values({
				id: submissionId,
				eventId: form.eventId,
				formId: form.id,
				type: form.type,
				status: target === "submit" ? "pending" : "draft",
				submitterId: user.id,
				...core,
			}),
		);
	} else {
		statements.push(
			db
				.update(submissions)
				.set({
					...core,
					status:
						target === "submit" && existing.status === "draft"
							? "pending"
							: existing.status,
				})
				.where(eq(submissions.id, submissionId)),
		);
		statements.push(
			db
				.delete(submissionAnswers)
				.where(eq(submissionAnswers.submissionId, submissionId)),
		);
		statements.push(
			db
				.delete(submissionTags)
				.where(eq(submissionTags.submissionId, submissionId)),
		);
	}
	for (const answer of answers) {
		statements.push(
			db.insert(submissionAnswers).values({ submissionId, ...answer }),
		);
	}
	// Track is single-select: rewrite it only when the selection actually
	// changed, so an unrelated edit never strips tracks an organizer added for
	// reviewer routing.
	const existingTrackIds = existing
		? (
				await db
					.select({ trackId: submissionTracks.trackId })
					.from(submissionTracks)
					.where(eq(submissionTracks.submissionId, submissionId))
			).map((r) => r.trackId)
		: [];
	if (trackId && !existingTrackIds.includes(trackId)) {
		if (existing) {
			statements.push(
				db
					.delete(submissionTracks)
					.where(eq(submissionTracks.submissionId, submissionId)),
			);
		}
		statements.push(
			db.insert(submissionTracks).values({ submissionId, trackId }),
		);
	}
	for (const tagId of tagIds) {
		statements.push(db.insert(submissionTags).values({ submissionId, tagId }));
	}

	const nextByIdentity = new Map<
		string,
		{ participant: WizardParticipant; index: number; contactId: string }
	>();
	for (const [index, participant] of input.participants.entries()) {
		const contactId = contactIdByKey.get(participant.key);
		if (!contactId) continue;
		const identity = `${contactId}:${participant.role}`;
		if (nextByIdentity.has(identity)) {
			return {
				ok: false,
				error: "A contact can only be listed once in each participant role.",
				status: 422,
			};
		}
		nextByIdentity.set(identity, { participant, index, contactId });
	}

	for (const row of existingParticipantLinks) {
		const identity = `${row.contactId}:${row.role}`;
		const next = nextByIdentity.get(identity);
		if (!next) {
			statements.push(
				db.delete(participants).where(eq(participants.id, row.id)),
			);
			continue;
		}
		statements.push(
			db
				.update(participants)
				.set({
					position: next.index,
					isPrimary:
						next.participant.self === true &&
						next.participant.role === "speaker",
				})
				.where(eq(participants.id, row.id)),
		);
		nextByIdentity.delete(identity);
	}

	const plannedAdds: Array<Omit<AddedParticipant, "isSelf">> = [];
	for (const { participant, index, contactId } of nextByIdentity.values()) {
		const participantId = crypto.randomUUID();
		statements.push(
			db.insert(participants).values({
				id: participantId,
				submissionId,
				contactId,
				role: participant.role,
				position: index,
				isPrimary: participant.self === true && participant.role === "speaker",
			}),
		);
		plannedAdds.push({
			participantId,
			contactId,
			wasExistingContact: wasExistingContactByKey.get(participant.key) ?? false,
			role: participant.role,
		});
	}

	if (editingSubmitted && target === "submit") {
		statements.push(
			db.insert(submissionRevisions).values({
				submissionId,
				title,
				description,
				editedById: user.id,
			}),
		);
	}

	try {
		await db.batch(statements as unknown as Parameters<Db["batch"]>[0]);
	} catch (error) {
		// A replayed create (double-submit) trips the primary key — the batch is
		// atomic, so if the row already landed for this user the first request
		// succeeded and the replay reports success without re-writing.
		if (!existing) {
			const [row] = await db
				.select({ id: submissions.id, submitterId: submissions.submitterId })
				.from(submissions)
				.where(eq(submissions.id, submissionId))
				.limit(1);
			if (row && row.submitterId === user.id) {
				return {
					ok: true,
					submissionId,
					created: false,
					previousStatus: null,
					addedParticipants: [],
				};
			}
		}
		throw error;
	}

	const confirmedById = new Map<
		string,
		{
			contactId: string;
			role: WizardParticipant["role"];
			contactUserId: string | null;
			submitterId: string | null;
		}
	>();
	if (plannedAdds.length > 0) {
		const confirmed = await db
			.select({
				participantId: participants.id,
				contactId: participants.contactId,
				role: participants.role,
				contactUserId: contacts.userId,
				submitterId: submissions.submitterId,
			})
			.from(participants)
			.innerJoin(
				submissions,
				and(
					eq(submissions.id, participants.submissionId),
					eq(submissions.eventId, form.eventId),
				),
			)
			.innerJoin(
				contacts,
				and(
					eq(contacts.id, participants.contactId),
					eq(contacts.eventId, form.eventId),
				),
			)
			.where(
				and(
					eq(participants.submissionId, submissionId),
					inArray(
						participants.id,
						plannedAdds.map((added) => added.participantId),
					),
				),
			);
		for (const row of confirmed) {
			confirmedById.set(row.participantId, row);
		}
	}
	const addedParticipants = plannedAdds.flatMap((planned) => {
		const confirmed = confirmedById.get(planned.participantId);
		if (
			!confirmed ||
			confirmed.contactId !== planned.contactId ||
			confirmed.role !== planned.role
		) {
			return [];
		}
		return [
			{
				participantId: planned.participantId,
				contactId: planned.contactId,
				wasExistingContact: planned.wasExistingContact,
				isSelf:
					confirmed.contactUserId !== null &&
					confirmed.contactUserId === confirmed.submitterId,
				role: planned.role,
			} satisfies AddedParticipant,
		];
	});

	return {
		ok: true,
		submissionId,
		created: !existing,
		previousStatus: existing?.status ?? null,
		addedParticipants,
	};
}

/* ------------------------------------------------------------ wizard load --- */

export async function listDrafts(
	db: Db,
	formId: string,
	userId: string,
): Promise<Array<{ id: string; title: string; updatedAt: Date }>> {
	return db
		.select({
			id: submissions.id,
			title: submissions.title,
			updatedAt: submissions.updatedAt,
		})
		.from(submissions)
		.where(
			and(
				eq(submissions.formId, formId),
				eq(submissions.submitterId, userId),
				eq(submissions.status, "draft"),
			),
		)
		.orderBy(submissions.updatedAt);
}

export type WizardInitial = {
	sid: string;
	loadedStatus: string;
	updatedAt: number;
	values: WizardValues;
	participants: WizardParticipant[];
};

/**
 * Rehydrate a submission row (draft resume or edit-until-close) into the
 * wizard's value map + participant rows. Returns null unless the row exists
 * on this form and belongs to the requesting user.
 */
export async function loadWizardInitial(
	db: Db,
	form: PublicForm,
	userId: string,
	sid: string,
): Promise<WizardInitial | null> {
	const [row] = await db
		.select({
			formId: submissions.formId,
			submitterId: submissions.submitterId,
			status: submissions.status,
			updatedAt: submissions.updatedAt,
			title: submissions.title,
			description: submissions.description,
			formatId: submissions.formatId,
			levelId: submissions.levelId,
			language: submissions.language,
		})
		.from(submissions)
		.where(and(eq(submissions.id, sid), eq(submissions.eventId, form.eventId)))
		.limit(1);
	if (!row || row.formId !== form.id || row.submitterId !== userId) return null;

	const [answers, trackRows, tagRows, participantRows] = await db.batch([
		db
			.select({
				fieldId: submissionAnswers.fieldId,
				value: submissionAnswers.value,
			})
			.from(submissionAnswers)
			.where(eq(submissionAnswers.submissionId, sid)),
		db
			.select({ trackId: submissionTracks.trackId })
			.from(submissionTracks)
			.where(eq(submissionTracks.submissionId, sid)),
		db
			.select({ tagId: submissionTags.tagId })
			.from(submissionTags)
			.where(eq(submissionTags.submissionId, sid)),
		db
			.select({
				id: participants.id,
				role: participants.role,
				isPrimary: participants.isPrimary,
				position: participants.position,
				firstName: contacts.firstName,
				lastName: contacts.lastName,
				email: contacts.email,
				mobilePhone: contacts.mobilePhone,
				bio: contacts.bio,
				contactUserId: contacts.userId,
			})
			.from(participants)
			.innerJoin(contacts, eq(contacts.id, participants.contactId))
			.where(eq(participants.submissionId, sid))
			.orderBy(participants.position),
	]);

	const values: WizardValues = {
		[builtinKey("title")]: row.title,
		[builtinKey("description")]: row.description,
		[builtinKey("format")]: row.formatId ?? "",
		[builtinKey("level")]: row.levelId ?? "",
		[builtinKey("language")]: row.language,
		[builtinKey("track")]: trackRows[0]?.trackId ?? "",
		[builtinKey("tags")]: joinMultiValue(tagRows.map((r) => r.tagId)),
	};
	for (const answer of answers) {
		values[fieldKey(answer.fieldId)] = answer.value ?? "";
	}

	return {
		sid,
		loadedStatus: row.status,
		updatedAt: row.updatedAt.getTime(),
		values,
		participants: participantRows.map((p) => ({
			key: p.id,
			role: p.role,
			firstName: p.firstName,
			lastName: p.lastName,
			email: p.email,
			mobilePhone: p.mobilePhone ?? "",
			bio: p.bio ?? "",
			self: p.contactUserId === userId || undefined,
			persisted: true,
		})),
	};
}

/* ----------------------------------------------------------------- email --- */

/** Replace {{tag}} merge tags; unknown tags render as empty strings. */
export function renderTemplate(
	template: string,
	vars: Record<string, string>,
): string {
	return template.replace(
		/\{\{\s*(\w+)\s*\}\}/g,
		(_, tag: string) => vars[tag] ?? "",
	);
}

export async function loadPortalPath(
	db: Db,
	eventId: string,
	eventSlug: string,
): Promise<string | null> {
	const [portal] = await db
		.select({ publicId: portals.publicId })
		.from(portals)
		.where(eq(portals.eventId, eventId))
		.orderBy(portals.createdAt)
		.limit(1);
	return portal ? `/portals/${eventSlug}/${portal.publicId}` : null;
}

/**
 * The submission confirmation email: the event's editable
 * submission_confirmation template, rendered with merge tags, always carrying
 * a link to the speaker portal (appended when the template body doesn't place
 * one itself). Deduped per submission so a resend can't double-deliver.
 */
export async function sendConfirmationEmail(
	env: Env,
	args: {
		event: PublicEvent;
		form: PublicForm;
		submissionId: string;
		submissionTitle: string;
		to: string;
		firstName: string;
		portalUrl: string;
	},
): Promise<void> {
	const db = getDb(env);
	const [template] = await db
		.select()
		.from(emailTemplates)
		.where(
			and(
				eq(emailTemplates.eventId, args.event.id),
				eq(emailTemplates.key, "submission_confirmation"),
			),
		)
		.limit(1);

	const vars = {
		first_name: args.firstName,
		event_name: args.event.name,
		submission_title: args.submissionTitle,
		portal_link: args.portalUrl,
		portal_url: args.portalUrl,
	};
	const subject = renderTemplate(
		template?.subject || "We received your submission",
		vars,
	);
	let html = renderTemplate(
		template?.bodyHtml ||
			`<p>Hi ${args.firstName || "there"},</p><p>Thanks for submitting "${args.submissionTitle}" to ${args.event.name}. Our team will review it and let you know.</p>`,
		vars,
	);
	if (!/portal/i.test(html) || !html.includes(args.portalUrl)) {
		html += `<p><a href="${args.portalUrl}">Open your speaker portal</a> to track your submission's status and complete any tasks.</p>`;
	}

	await getEmailSender(env).send({
		to: args.to,
		subject,
		html,
		kind: "transactional",
		dedupeKey: `submission_confirmation:${args.submissionId}`,
		eventId: args.event.id,
		templateId: template?.id,
		replyTo: template?.replyTo ?? undefined,
	});
}
