import { relations, sql } from "drizzle-orm";
import {
	type AnySQLiteColumn,
	index,
	integer,
	primaryKey,
	real,
	sqliteTable,
	text,
	unique,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import {
	PIPELINE_STAGE,
	SUBMISSION_STATUS,
	SUBMISSION_TYPE,
} from "./constants";

/**
 * Integration-owned: feature worktrees import from here and must not edit this
 * file or mint migrations (lefthook + CI enforce it) — request columns from the
 * integration owner instead.
 *
 * Conventions:
 *   - text UUID primary keys via crypto.randomUUID()
 *   - timestamps as unix epoch (integer, mode: "timestamp")
 *   - enums as text with a checked { enum: [...] } union (exported as const tuples)
 *   - every event-scoped row cascades from its event; person identity lives on
 *     `contacts`, NOT on `participants` (a participant is a role on a submission).
 */

const id = () =>
	text("id")
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID());
const createdAt = () =>
	integer("created_at", { mode: "timestamp" })
		.notNull()
		.$defaultFn(() => new Date());
const updatedAt = () =>
	integer("updated_at", { mode: "timestamp" })
		.notNull()
		.$defaultFn(() => new Date())
		.$onUpdate(() => new Date());

/* ------------------------------------------------------------------ auth --- */

export const USER_ROLE = ["admin", "speaker", "reviewer"] as const;

export const users = sqliteTable("users", {
	id: id(),
	email: text("email").notNull().unique(), // ALWAYS stored lowercased — see normalizeEmail()
	passwordHash: text("password_hash").notNull(),
	name: text("name"),
	role: text("role", { enum: USER_ROLE }).notNull().default("speaker"),
	/** The event this admin is currently operating on (the "current event"). */
	activeEventId: text("active_event_id").references(() => events.id, {
		onDelete: "set null",
	}),
	createdAt: createdAt(),
});

/** Server-side sessions (cookie holds the id). See app/lib/auth.ts. */
export const authSessions = sqliteTable(
	"auth_sessions",
	{
		id: id(),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
		createdAt: createdAt(),
	},
	(t) => [index("auth_sessions_user_idx").on(t.userId)],
);

/**
 * Also backs invites: a sentinel-hash user + one of these tokens = set-password
 * onboarding. `organizationId` is the mint-time intent discriminator: set = an
 * org-member invite (the accept flow creates the membership); NULL = speaker /
 * reviewer / plain password reset — the accept flow must derive what a token
 * grants from this column, never from which route redeems it.
 */
export const passwordResets = sqliteTable("password_resets", {
	id: id(),
	userId: text("user_id")
		.notNull()
		.references(() => users.id, { onDelete: "cascade" }),
	organizationId: text("organization_id").references(
		(): AnySQLiteColumn => organizations.id,
		{ onDelete: "cascade" },
	),
	token: text("token").notNull().unique(),
	expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
	usedAt: integer("used_at", { mode: "timestamp" }),
	createdAt: createdAt(),
});

/* ---------------------------------------------------------- organizations --- */

/**
 * The tenant (docs/multi-tenancy-design.md). Events, api tokens, and org-wide
 * fields hang off an organization; every admin surface resolves access through
 * organization_members. No owner/role column — members are equal admins
 * (verified Sessionboard parity, docs/data-model.md → Organization & Event
 * Team); the one invariant is that an org never loses its last member
 * (enforced at the member-remove action, Wave D).
 */
export const organizations = sqliteTable("organizations", {
	id: id(),
	name: text("name").notNull(),
	createdAt: createdAt(),
});

export const organizationMembers = sqliteTable(
	"organization_members",
	{
		id: id(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organizations.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		createdAt: createdAt(),
	},
	(t) => [
		unique("organization_members_org_user_uq").on(t.organizationId, t.userId),
		index("organization_members_user_idx").on(t.userId),
	],
);

/* ----------------------------------------------------------------- event --- */

export const events = sqliteTable("events", {
	id: id(),
	organizationId: text("organization_id")
		.notNull()
		.references(() => organizations.id, { onDelete: "cascade" }),
	name: text("name").notNull(),
	slug: text("slug").notNull().unique(),
	type: text("type").notNull().default("Conference"),
	websiteUrl: text("website_url"),
	location: text("location"),
	timezone: text("timezone").notNull().default("America/Los_Angeles"),
	theme: text("theme"),
	logoKey: text("logo_key"), // R2 object key
	backgroundKey: text("background_key"), // R2 object key
	startsAt: integer("starts_at", { mode: "timestamp" }),
	endsAt: integer("ends_at", { mode: "timestamp" }),
	/** Event-wide default cap; applies when a form sets no `submissionLimit`. */
	submissionLimit: integer("submission_limit"),
	// Agenda settings: schedule window + which statuses are schedulable.
	agendaDayStartMin: integer("agenda_day_start_min").notNull().default(480), // 08:00
	agendaDayEndMin: integer("agenda_day_end_min").notNull().default(1080), // 18:00
	schedulableStatuses: text("schedulable_statuses", { mode: "json" })
		.$type<string[]>()
		.$defaultFn(() => ["accepted"]),
	/**
	 * Gates ONLY the public agenda + itinerary; sessions/speakers/gallery are
	 * public as soon as approved content exists.
	 */
	agendaPublishedAt: integer("agenda_published_at", { mode: "timestamp" }),
	createdAt: createdAt(),
});

/* ------------------------------------------------------- event taxonomies --- */

export const tracks = sqliteTable(
	"tracks",
	{
		id: id(),
		eventId: text("event_id")
			.notNull()
			.references(() => events.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		color: text("color").notNull().default("#6366f1"),
		createdAt: createdAt(),
	},
	(t) => [index("tracks_event_idx").on(t.eventId)],
);

// Sessionboard carries TWO status fields on a session: a fixed core enum
// (SUBMISSION_STATUS — the 5-stage decision pipeline) AND an organizer-created
// custom status ("Offered", "Pending Contract", …). This table holds the custom
// ones per event; `submissions.customStatusId` points at the active one. Both
// coexist exactly as the Sessionboard API does (`status` + `custom_status_id`).
export const sessionStatuses = sqliteTable(
	"session_statuses",
	{
		id: id(),
		eventId: text("event_id")
			.notNull()
			.references(() => events.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		color: text("color").notNull().default("#71717a"),
		position: integer("position").notNull().default(0),
		createdAt: createdAt(),
	},
	(t) => [index("session_statuses_event_idx").on(t.eventId)],
);

export const tags = sqliteTable(
	"tags",
	{
		id: id(),
		eventId: text("event_id")
			.notNull()
			.references(() => events.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		color: text("color").notNull().default("#71717a"),
		createdAt: createdAt(),
	},
	(t) => [index("tags_event_idx").on(t.eventId)],
);

/** Formats carry the per-format Default Duration the agenda uses to auto-fill end time. */
export const formats = sqliteTable(
	"formats",
	{
		id: id(),
		eventId: text("event_id")
			.notNull()
			.references(() => events.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		defaultDurationMins: integer("default_duration_mins").notNull().default(30),
		position: integer("position").notNull().default(0),
		createdAt: createdAt(),
	},
	(t) => [index("formats_event_idx").on(t.eventId)],
);

export const levels = sqliteTable(
	"levels",
	{
		id: id(),
		eventId: text("event_id")
			.notNull()
			.references(() => events.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		position: integer("position").notNull().default(0),
		createdAt: createdAt(),
	},
	(t) => [index("levels_event_idx").on(t.eventId)],
);

export const rooms = sqliteTable(
	"rooms",
	{
		id: id(),
		eventId: text("event_id")
			.notNull()
			.references(() => events.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		capacity: integer("capacity"),
		displayOrder: integer("display_order").notNull().default(0),
		visible: integer("visible", { mode: "boolean" }).notNull().default(true),
		createdAt: createdAt(),
	},
	(t) => [index("rooms_event_idx").on(t.eventId)],
);

/** Library-managed language pick-list (feeds the form Language dropdown). */
export const languages = sqliteTable(
	"languages",
	{
		id: id(),
		eventId: text("event_id")
			.notNull()
			.references(() => events.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		position: integer("position").notNull().default(0),
		createdAt: createdAt(),
	},
	(t) => [index("languages_event_idx").on(t.eventId)],
);

/**
 * Speaker/audience portal — the `/portals/<event-slug>/<portal-uuid>` target.
 * One default speaker portal per event is provisioned at event creation; the
 * CFP success redirect and every emailed portal link resolve to its publicId.
 */
export const portals = sqliteTable(
	"portals",
	{
		id: id(),
		eventId: text("event_id")
			.notNull()
			.references(() => events.id, { onDelete: "cascade" }),
		publicId: text("public_id")
			.notNull()
			.unique()
			.$defaultFn(() => crypto.randomUUID()),
		name: text("name").notNull().default("Speaker Portal"),
		// Appearance/theming (Sessionboard portals are branded per event).
		welcomeMessage: text("welcome_message"),
		accentColor: text("accent_color"),
		logoKey: text("logo_key"), // R2 object key
		backgroundKey: text("background_key"), // R2 object key
		createdAt: createdAt(),
	},
	(t) => [index("portals_event_idx").on(t.eventId)],
);

/* ------------------------------------------------------- forms + fields --- */

export const FORM_TYPE = ["abstract", "session"] as const;
export const FORM_STATUS = ["draft", "open", "closed"] as const;
export const PORTAL_FORM_TARGET = ["contact", "group", "submission"] as const;

/**
 * Submission forms ONLY — portal forms live in `portalForms`. `publicId` is
 * the `/submit/<event-slug>/<form-uuid>` path segment.
 */
export const forms = sqliteTable(
	"forms",
	{
		id: id(),
		eventId: text("event_id")
			.notNull()
			.references(() => events.id, { onDelete: "cascade" }),
		publicId: text("public_id")
			.notNull()
			.unique()
			.$defaultFn(() => crypto.randomUUID()),
		type: text("type", { enum: FORM_TYPE }).notNull().default("session"),
		status: text("status", { enum: FORM_STATUS }).notNull().default("draft"),
		// Step 2 — Welcome
		internalName: text("internal_name").notNull(),
		externalTitle: text("external_title").notNull().default(""),
		pageHeading: text("page_heading").notNull().default(""),
		welcomeHtml: text("welcome_html"),
		showWelcome: integer("show_welcome", { mode: "boolean" })
			.notNull()
			.default(true),
		// Step 3/4 — section copy + participants toggle
		participantsStep: integer("participants_step", { mode: "boolean" })
			.notNull()
			.default(true),
		sessionSectionTitle: text("session_section_title"),
		sessionSectionHtml: text("session_section_html"),
		participantSectionTitle: text("participant_section_title"),
		participantSectionHtml: text("participant_section_html"),
		roleSpeakerMin: integer("role_speaker_min").notNull().default(1),
		roleSpeakerMax: integer("role_speaker_max"),
		allowChairperson: integer("allow_chairperson", { mode: "boolean" })
			.notNull()
			.default(false),
		roleChairpersonMin: integer("role_chairperson_min").notNull().default(0),
		roleChairpersonMax: integer("role_chairperson_max"),
		allowModerator: integer("allow_moderator", { mode: "boolean" })
			.notNull()
			.default(false),
		roleModeratorMin: integer("role_moderator_min").notNull().default(0),
		roleModeratorMax: integer("role_moderator_max"),
		notifyExistingContacts: integer("notify_existing_contacts", {
			mode: "boolean",
		})
			.notNull()
			.default(true),
		// Step 6 — Form Settings
		closeAt: integer("close_at", { mode: "timestamp" }),
		sendReminders: integer("send_reminders", { mode: "boolean" })
			.notNull()
			.default(false),
		submissionLimit: integer("submission_limit"),
		allowMultipleDrafts: integer("allow_multiple_drafts", { mode: "boolean" })
			.notNull()
			.default(false),
		autoRedirect: integer("auto_redirect", { mode: "boolean" })
			.notNull()
			.default(true),
		successHtml: text("success_html"),
		sendConfirmationEmail: integer("send_confirmation_email", {
			mode: "boolean",
		})
			.notNull()
			.default(true),
		// Overflow for validation rules, admin-notify pickers, etc.
		config: text("config", { mode: "json" }).$type<Record<string, unknown>>(),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(t) => [index("forms_event_idx").on(t.eventId)],
);

export const FIELD_TYPE = [
	"text",
	"textarea",
	"wysiwyg",
	"dropdown",
	"checkbox",
	"number",
	"email",
	"phone",
	"date",
	"section_header",
	"divider",
] as const;
export const FORM_FIELD_SECTION = ["session", "participant"] as const;

/**
 * Reusable field library (Create New Field / Add Question). Scope is an XOR
 * (the formFields fieldId/builtinRef precedent): an org-wide field sets
 * `organizationId` (eventId null); an event field sets `eventId`
 * (organizationId null — the org is derived via the event, never stored where
 * derivable, so the two can never disagree).
 */
export const fields = sqliteTable(
	"fields",
	{
		id: id(),
		organizationId: text("organization_id").references(() => organizations.id, {
			onDelete: "cascade",
		}),
		eventId: text("event_id").references(() => events.id, {
			onDelete: "cascade",
		}),
		name: text("name").notNull(),
		type: text("type", { enum: FIELD_TYPE }).notNull().default("text"),
		description: text("description"),
		maxLength: integer("max_length"),
		options: text("options", { mode: "json" }).$type<string[]>(),
		createdAt: createdAt(),
	},
	(t) => [
		index("fields_event_idx").on(t.eventId),
		index("fields_org_idx").on(t.organizationId),
	],
);

/**
 * Built-in questions that exist on every form independent of the field library
 * (Title/Description/Format/…). A form_fields row references EITHER a library
 * `fieldId` OR a `builtinRef` (never both) — so built-ins get the same per-form
 * position/required/locked config as custom fields, and a conditional rule can
 * trigger on a built-in dropdown.
 */
export const BUILTIN_FIELD = [
	"title",
	"description",
	"format",
	"tags",
	"track",
	"level",
	"language",
	"first_name",
	"last_name",
	"email",
	"mobile_phone",
	"home_phone",
	"biography",
	"company_name",
	"job_title",
	"headshot",
	"zip",
] as const;

/**
 * A conditional show-rule: reveal this question when the trigger question
 * matches `value`. The trigger can be a library field OR a built-in (Format,
 * Track, …) — that union is the whole point. Null = always shown.
 */
export type QuestionRule = {
	trigger:
		| { kind: "field"; fieldId: string }
		| { kind: "builtin"; ref: (typeof BUILTIN_FIELD)[number] };
	operator: "equals" | "not_equals" | "gt" | "lt";
	value: string;
} | null;

/** Placement of a field on a form + per-form overrides + conditional "question rule". */
export const formFields = sqliteTable(
	"form_fields",
	{
		id: id(),
		formId: text("form_id")
			.notNull()
			.references(() => forms.id, { onDelete: "cascade" }),
		// Exactly ONE of fieldId / builtinRef is set (XOR, app-enforced).
		fieldId: text("field_id").references(() => fields.id, {
			onDelete: "cascade",
		}),
		builtinRef: text("builtin_ref", { enum: BUILTIN_FIELD }),
		section: text("section", { enum: FORM_FIELD_SECTION })
			.notNull()
			.default("session"),
		position: integer("position").notNull().default(0),
		required: integer("required", { mode: "boolean" }).notNull().default(false),
		locked: integer("locked", { mode: "boolean" }).notNull().default(false),
		questionRule: text("question_rule", { mode: "json" }).$type<QuestionRule>(),
		createdAt: createdAt(),
	},
	(t) => [
		index("form_fields_form_idx").on(t.formId),
		unique("form_fields_form_field_uq").on(t.formId, t.fieldId),
		unique("form_fields_form_builtin_uq").on(t.formId, t.builtinRef),
	],
);

/* ------------------------------------------------------- people (contacts) --- */

/**
 * A PERSON within an event — the single home for profile data (bio, headshot,
 * links). Distinct from `users` (auth identity) and `participants` (a role on a
 * submission). Editing "your own bio" edits the contact, so co-speaker reuse
 * across submissions stays consistent.
 */
/** Independent of per-submission `participants.acceptanceStatus`. */
export const CONTACT_STATUS = [
	"pending",
	"invited",
	"confirmed",
	"declined",
] as const;

export const contacts = sqliteTable(
	"contacts",
	{
		id: id(),
		eventId: text("event_id")
			.notNull()
			.references(() => events.id, { onDelete: "cascade" }),
		userId: text("user_id").references(() => users.id, {
			onDelete: "set null",
		}),
		email: text("email").notNull(),
		firstName: text("first_name").notNull(),
		lastName: text("last_name").notNull(),
		salutation: text("salutation"),
		honorific: text("honorific"),
		pronouns: text("pronouns"),
		gender: text("gender"),
		jobTitle: text("job_title"),
		companyName: text("company_name"),
		mobilePhone: text("mobile_phone"),
		homePhone: text("home_phone"),
		zip: text("zip"),
		bio: text("bio"),
		headshotKey: text("headshot_key"), // R2 object key
		linkedinUrl: text("linkedin_url"),
		twitterUrl: text("twitter_url"),
		facebookUrl: text("facebook_url"),
		websiteUrl: text("website_url"),
		status: text("status", { enum: CONTACT_STATUS })
			.notNull()
			.default("pending"),
		// Per-speaker public/hidden toggle. Hidden speakers must never appear in
		// public embeds or the program site (Sessionboard's public/private boundary).
		publicVisible: integer("public_visible", { mode: "boolean" })
			.notNull()
			.default(true),
		/** Travel/logistics free-text ("Arrival May 11, aisle seat; dietary: Vegetarian"). */
		logisticsNotes: text("logistics_notes"),
		createdAt: createdAt(),
	},
	(t) => [
		index("contacts_event_idx").on(t.eventId),
		index("contacts_user_idx").on(t.userId),
		unique("contacts_event_email_uq").on(t.eventId, t.email),
	],
);

export type ContactMergeAuditSummary = {
	eventContactsCreated: number;
	contactsRetired: number;
	profileFieldsFilled: number;
	participantLinksMoved: number;
	participantLinksConsolidated: number;
	taskAssignmentsMoved: number;
	taskAssignmentsConsolidated: number;
	filesMoved: number;
	customValuesMoved: number;
	customValuesConsolidated: number;
	notesMoved: number;
	pipelineCardsMoved: number;
	pipelineCardsConsolidated: number;
	pipelineHistoryMoved: number;
	portalIdentitiesAliased: number;
	submissionsReassigned: number;
	airtableLinksMoved: number;
	airtableLinksConsolidated: number;
};

/** Event-contact values for custom fields from the shared field library. */
export const contactFieldValues = sqliteTable(
	"contact_field_values",
	{
		id: id(),
		contactId: text("contact_id")
			.notNull()
			.references(() => contacts.id, { onDelete: "cascade" }),
		fieldId: text("field_id")
			.notNull()
			.references(() => fields.id, { onDelete: "restrict" }),
		value: text("value"),
		createdAt: createdAt(),
	},
	(t) => [
		unique("contact_field_values_contact_field_uq").on(t.contactId, t.fieldId),
		index("contact_field_values_contact_idx").on(t.contactId),
	],
);

/** Append-only proof of a completed organization-person merge. */
export const contactMerges = sqliteTable(
	"contact_merges",
	{
		id: id(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organizations.id, { onDelete: "cascade" }),
		sourceEmail: text("source_email").notNull(),
		survivorEmail: text("survivor_email").notNull(),
		actorId: text("actor_id").references(() => users.id, {
			onDelete: "set null",
		}),
		actorName: text("actor_name").notNull(),
		idempotencyKey: text("idempotency_key").notNull(),
		summary: text("summary", { mode: "json" })
			.$type<ContactMergeAuditSummary>()
			.notNull(),
		retiredContacts: text("retired_contacts", { mode: "json" })
			.$type<Array<typeof contacts.$inferSelect>>()
			.notNull(),
		createdAt: createdAt(),
	},
	(t) => [
		unique("contact_merges_org_key_uq").on(t.organizationId, t.idempotencyKey),
		index("contact_merges_survivor_idx").on(t.organizationId, t.survivorEmail),
	],
);

/** Old portal accounts keep resolving to the chosen organization identity. */
export const contactIdentityAliases = sqliteTable(
	"contact_identity_aliases",
	{
		id: id(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organizations.id, { onDelete: "cascade" }),
		sourceUserId: text("source_user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		survivorUserId: text("survivor_user_id").references(() => users.id, {
			onDelete: "set null",
		}),
		survivorEmail: text("survivor_email").notNull(),
		mergeId: text("merge_id")
			.notNull()
			.references(() => contactMerges.id, { onDelete: "cascade" }),
		createdAt: createdAt(),
	},
	(t) => [
		unique("contact_identity_aliases_org_user_uq").on(
			t.organizationId,
			t.sourceUserId,
		),
		index("contact_identity_aliases_survivor_idx").on(
			t.organizationId,
			t.survivorEmail,
		),
	],
);

/* ------------------------------------------------------------ submissions --- */

// Submission status/type tuples live in ./constants (pure, client-safe); we
// re-export them so server code can still import them from ~/db/schema.
export { SUBMISSION_STATUS, SUBMISSION_TYPE } from "./constants";

/**
 * SEPARATE from the decision `status`: an accepted session's content still
 * needs organizer approval before it renders on any public widget. Public
 * surfaces filter on `contentStatus = 'approved'`.
 */
export const CONTENT_STATUS = ["draft", "in_review", "approved"] as const;

export const submissions = sqliteTable(
	"submissions",
	{
		id: id(),
		eventId: text("event_id")
			.notNull()
			.references(() => events.id, { onDelete: "cascade" }),
		formId: text("form_id").references(() => forms.id, {
			onDelete: "set null",
		}),
		type: text("type", { enum: SUBMISSION_TYPE }).notNull().default("session"),
		title: text("title").notNull(),
		description: text("description").notNull().default(""),
		status: text("status", { enum: SUBMISSION_STATUS })
			.notNull()
			.default("pending"),
		// Organizer-created status layered on top of the core `status` pipeline
		// (Sessionboard parity — a session has both). Null = core status only.
		customStatusId: text("custom_status_id").references(
			() => sessionStatuses.id,
			{ onDelete: "set null" },
		),
		// Subsessions: a session nested under a parent (e.g. a workshop's slots).
		parentId: text("parent_id").references(
			(): AnySQLiteColumn => submissions.id,
			{ onDelete: "cascade" },
		),
		contentStatus: text("content_status", { enum: CONTENT_STATUS })
			.notNull()
			.default("draft"),
		submitterId: text("submitter_id").references(() => users.id, {
			onDelete: "set null",
		}),
		formatId: text("format_id").references(() => formats.id, {
			onDelete: "set null",
		}),
		levelId: text("level_id").references(() => levels.id, {
			onDelete: "set null",
		}),
		language: text("language").notNull().default("English"),
		// Data-model-only columns — deliberately no dedicated UX
		capacity: integer("capacity"),
		ceuCredits: real("ceu_credits"),
		clientSessionId: text("client_session_id"),
		location: text("location"),
		// Scheduling (agenda) — an accepted submission IS the session
		startsAt: integer("starts_at", { mode: "timestamp" }),
		endsAt: integer("ends_at", { mode: "timestamp" }),
		roomId: text("room_id").references(() => rooms.id, {
			onDelete: "set null",
		}),
		// Lifecycle metadata
		notifiedAt: integer("notified_at", { mode: "timestamp" }),
		statusChangedAt: integer("status_changed_at", { mode: "timestamp" }),
		withdrawnAt: integer("withdrawn_at", { mode: "timestamp" }),
		// A withdrawal can be initiated by the speaker or an admin — both are users.
		withdrawnById: text("withdrawn_by_id").references(() => users.id, {
			onDelete: "set null",
		}),
		withdrawnReason: text("withdrawn_reason"),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(t) => [
		index("submissions_event_status_idx").on(t.eventId, t.status),
		index("submissions_created_idx").on(t.createdAt),
		index("submissions_form_idx").on(t.formId),
		index("submissions_room_idx").on(t.roomId),
		index("submissions_submitter_idx").on(t.submitterId),
		index("submissions_parent_idx").on(t.parentId),
	],
);

/** Submissions ↔ tracks m2m (a submission carries ≥1 track; drives reviewer routing). */
export const submissionTracks = sqliteTable(
	"submission_tracks",
	{
		submissionId: text("submission_id")
			.notNull()
			.references(() => submissions.id, { onDelete: "cascade" }),
		trackId: text("track_id")
			.notNull()
			.references(() => tracks.id, { onDelete: "cascade" }),
	},
	(t) => [
		primaryKey({ columns: [t.submissionId, t.trackId] }),
		index("submission_tracks_track_idx").on(t.trackId),
	],
);

export const submissionTags = sqliteTable(
	"submission_tags",
	{
		submissionId: text("submission_id")
			.notNull()
			.references(() => submissions.id, { onDelete: "cascade" }),
		tagId: text("tag_id")
			.notNull()
			.references(() => tags.id, { onDelete: "cascade" }),
	},
	(t) => [
		primaryKey({ columns: [t.submissionId, t.tagId] }),
		index("submission_tags_tag_idx").on(t.tagId),
	],
);

/** Answers to custom/library fields on a submission. */
export const submissionAnswers = sqliteTable(
	"submission_answers",
	{
		id: id(),
		submissionId: text("submission_id")
			.notNull()
			.references(() => submissions.id, { onDelete: "cascade" }),
		// RESTRICT, not cascade: deleting a field must not silently destroy the
		// historical answers submitted against it.
		fieldId: text("field_id")
			.notNull()
			.references(() => fields.id, { onDelete: "restrict" }),
		value: text("value"),
	},
	(t) => [
		index("submission_answers_submission_idx").on(t.submissionId),
		unique("submission_answers_uq").on(t.submissionId, t.fieldId),
	],
);

/**
 * One snapshot row is appended AFTER every save of the submission's content
 * (title/description), attributed to the editor. Restore = write a chosen
 * snapshot back onto `submissions` and append a new revision row — history is
 * append-only, never rewritten.
 */
export const submissionRevisions = sqliteTable(
	"submission_revisions",
	{
		id: id(),
		submissionId: text("submission_id")
			.notNull()
			.references(() => submissions.id, { onDelete: "cascade" }),
		title: text("title").notNull(),
		description: text("description").notNull().default(""),
		editedById: text("edited_by_id").references(() => users.id, {
			onDelete: "set null",
		}),
		createdAt: createdAt(),
	},
	(t) => [index("submission_revisions_submission_idx").on(t.submissionId)],
);

export const PARTICIPANT_ROLE = [
	"speaker",
	"chairperson",
	"moderator",
	"secondary", // secondary contact: assists with tasks and communication
] as const;
export const PARTICIPANT_ACCEPTANCE = [
	"pending",
	"accepted",
	"declined",
] as const;

/** A person's role on one submission (thin join — identity lives on `contacts`). */
export const participants = sqliteTable(
	"participants",
	{
		id: id(),
		submissionId: text("submission_id")
			.notNull()
			.references(() => submissions.id, { onDelete: "cascade" }),
		contactId: text("contact_id")
			.notNull()
			.references(() => contacts.id, { onDelete: "cascade" }),
		role: text("role", { enum: PARTICIPANT_ROLE }).notNull().default("speaker"),
		isPrimary: integer("is_primary", { mode: "boolean" })
			.notNull()
			.default(false),
		position: integer("position").notNull().default(0),
		acceptanceStatus: text("acceptance_status", {
			enum: PARTICIPANT_ACCEPTANCE,
		})
			.notNull()
			.default("pending"),
		createdAt: createdAt(),
	},
	(t) => [
		index("participants_submission_idx").on(t.submissionId),
		index("participants_contact_idx").on(t.contactId),
		unique("participants_submission_contact_role_uq").on(
			t.submissionId,
			t.contactId,
			t.role,
		),
	],
);

/* ------------------------------------------------------------- evaluation --- */

export const REVIEW_DECISION = ["approve", "maybe", "deny"] as const;

/** Per-reviewer 3-state decision — the lightweight path; scorecard depth lives in the evaluation tables below. */
export const reviews = sqliteTable(
	"reviews",
	{
		id: id(),
		submissionId: text("submission_id")
			.notNull()
			.references(() => submissions.id, { onDelete: "cascade" }),
		reviewerId: text("reviewer_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		decision: text("decision", { enum: REVIEW_DECISION }).notNull(),
		comment: text("comment"),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(t) => [
		index("reviews_submission_idx").on(t.submissionId),
		unique("reviews_submission_reviewer_uq").on(t.submissionId, t.reviewerId),
	],
);

/** Reviewer ↔ track routing: a reviewer sees submissions whose tracks overlap. */
export const reviewerTracks = sqliteTable(
	"reviewer_tracks",
	{
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		trackId: text("track_id")
			.notNull()
			.references(() => tracks.id, { onDelete: "cascade" }),
	},
	(t) => [
		primaryKey({ columns: [t.userId, t.trackId] }),
		index("reviewer_tracks_track_idx").on(t.trackId),
	],
);

/* ----------------------------------------------------- evaluation (rounds) --- */
// Round-based review depth, coexisting with the 3-state `reviews` fast path:
// plans → rounds (own dates/scorecard/pool/anonymization) → per-evaluator
// evaluations → per-question answers. Behavior: docs/flows/05-evaluations.md.

export const PLAN_STATUS = ["open", "closed"] as const;
export const QUESTION_TYPE = ["rating", "dropdown", "text"] as const;
export const EVALUATION_STATUS = ["pending", "completed", "abstained"] as const;

export const evaluationPlans = sqliteTable(
	"evaluation_plans",
	{
		id: id(),
		eventId: text("event_id")
			.notNull()
			.references(() => events.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		instructions: text("instructions").notNull().default(""),
		status: text("status", { enum: PLAN_STATUS }).notNull().default("open"),
		createdAt: createdAt(),
	},
	(t) => [index("evaluation_plans_event_idx").on(t.eventId)],
);

export const evaluationRounds = sqliteTable(
	"evaluation_rounds",
	{
		id: id(),
		planId: text("plan_id")
			.notNull()
			.references(() => evaluationPlans.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		position: integer("position").notNull().default(0),
		opensAt: integer("opens_at", { mode: "timestamp" }),
		closesAt: integer("closes_at", { mode: "timestamp" }),
		/** Blind review: hides participant identity from reviewers only — organizers always see it. */
		anonymized: integer("anonymized", { mode: "boolean" })
			.notNull()
			.default(false),
		/** Whether evaluators see other reviewers' scores while reviewing. */
		showOtherScores: integer("show_other_scores", { mode: "boolean" })
			.notNull()
			.default(false),
		createdAt: createdAt(),
	},
	(t) => [index("evaluation_rounds_plan_idx").on(t.planId)],
);

/** Per-ROUND reviewer pool — membership in round 1 ≠ round 2. */
export const roundEvaluators = sqliteTable(
	"round_evaluators",
	{
		roundId: text("round_id")
			.notNull()
			.references(() => evaluationRounds.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
	},
	(t) => [
		primaryKey({ columns: [t.roundId, t.userId] }),
		index("round_evaluators_user_idx").on(t.userId),
	],
);

/** Scorecard questions per round: rating (min/max), dropdown (options), text. */
export const roundQuestions = sqliteTable(
	"round_questions",
	{
		id: id(),
		roundId: text("round_id")
			.notNull()
			.references(() => evaluationRounds.id, { onDelete: "cascade" }),
		label: text("label").notNull(),
		type: text("type", { enum: QUESTION_TYPE }).notNull(),
		config: text("config", { mode: "json" }).$type<{
			min?: number;
			max?: number;
			options?: string[];
		}>(),
		/** Aggregate = Σ(value×weight)/Σ(weight) over rating questions — weight 2 counts a rating twice. */
		weight: real("weight").notNull().default(1),
		required: integer("required", { mode: "boolean" }).notNull().default(true),
		position: integer("position").notNull().default(0),
	},
	(t) => [index("round_questions_round_idx").on(t.roundId)],
);

/**
 * One evaluator's evaluation of one submission in one round. The row is
 * CREATED AT ASSIGNMENT TIME with status "pending", so the reviewer queue is
 * exactly `evaluations WHERE evaluatorId = me AND status = 'pending'` — the
 * queue can never contain anything that wasn't assigned. Caps, auto-distribute,
 * and track-filtered assignment are just strategies that mint these rows.
 * "abstained" = conflict-of-interest recusal.
 */
export const evaluations = sqliteTable(
	"evaluations",
	{
		id: id(),
		roundId: text("round_id")
			.notNull()
			.references(() => evaluationRounds.id, { onDelete: "cascade" }),
		submissionId: text("submission_id")
			.notNull()
			.references(() => submissions.id, { onDelete: "cascade" }),
		evaluatorId: text("evaluator_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		status: text("status", { enum: EVALUATION_STATUS })
			.notNull()
			.default("pending"),
		abstainReason: text("abstain_reason"),
		submittedAt: integer("submitted_at", { mode: "timestamp" }),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(t) => [
		unique("evaluations_round_submission_evaluator_uq").on(
			t.roundId,
			t.submissionId,
			t.evaluatorId,
		),
		index("evaluations_evaluator_status_idx").on(t.evaluatorId, t.status),
		index("evaluations_submission_idx").on(t.submissionId),
	],
);

/** Submitted scorecard values; rating/dropdown in valueNumber/valueText per type. */
export const evaluationAnswers = sqliteTable(
	"evaluation_answers",
	{
		id: id(),
		evaluationId: text("evaluation_id")
			.notNull()
			.references(() => evaluations.id, { onDelete: "cascade" }),
		// RESTRICT: deleting a scorecard question must not destroy recorded scores.
		questionId: text("question_id")
			.notNull()
			.references(() => roundQuestions.id, { onDelete: "restrict" }),
		valueNumber: real("value_number"),
		valueText: text("value_text"),
	},
	(t) => [
		index("evaluation_answers_evaluation_idx").on(t.evaluationId),
		unique("evaluation_answers_uq").on(t.evaluationId, t.questionId),
	],
);

/**
 * The AI first-pass review of a submission — at most one row per submission
 * (re-running replaces it in place). `overrideScore` is an organizer's
 * correction: when set it is the effective score, with the AI's original kept
 * visible. AI scores never enter human evaluation aggregates.
 */
export const aiReviews = sqliteTable(
	"ai_reviews",
	{
		id: id(),
		submissionId: text("submission_id")
			.notNull()
			.references(() => submissions.id, { onDelete: "cascade" }),
		/** 0–10 first-pass score produced by the model. */
		score: real("score").notNull(),
		rationale: text("rationale").notNull(),
		model: text("model").notNull(),
		overrideScore: real("override_score"),
		overrideById: text("override_by_id").references(() => users.id, {
			onDelete: "set null",
		}),
		overrideAt: integer("override_at", { mode: "timestamp" }),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(t) => [unique("ai_reviews_submission_uq").on(t.submissionId)],
);

/* ----------------------------------------------------------- portals/tasks --- */

export const TASK_TYPE = ["contact", "group", "submission"] as const;
export const TASK_STATUS = [
	"incomplete",
	"complete",
	"pending_feedback",
] as const;

/**
 * Portal forms (≠ submission forms) — Contacts/Groups/Submissions. The must-have
 * onboarding tasks (hotel-stay, flight-reimbursement) attach one of these.
 */
export const portalForms = sqliteTable(
	"portal_forms",
	{
		id: id(),
		eventId: text("event_id")
			.notNull()
			.references(() => events.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		title: text("title").notNull().default(""),
		targetType: text("target_type", { enum: PORTAL_FORM_TARGET })
			.notNull()
			.default("contact"),
		/** Ordered field definitions (portal forms are simpler than the builder). */
		schema: text("schema", { mode: "json" }).$type<
			Array<{
				name: string;
				type: string;
				required: boolean;
				options?: string[]; // for dropdown fields
			}>
		>(),
		sendConfirmationEmail: integer("send_confirmation_email", {
			mode: "boolean",
		})
			.notNull()
			.default(false),
		confirmationHtml: text("confirmation_html"),
		createdAt: createdAt(),
	},
	(t) => [index("portal_forms_event_idx").on(t.eventId)],
);

/** Task definitions (auto-assigned on accept for onboarding). */
export const tasks = sqliteTable(
	"tasks",
	{
		id: id(),
		eventId: text("event_id")
			.notNull()
			.references(() => events.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		type: text("type", { enum: TASK_TYPE }).notNull().default("contact"),
		description: text("description"),
		linkUrl: text("link_url"),
		portalFormId: text("portal_form_id").references(() => portalForms.id, {
			onDelete: "set null",
		}),
		isFileRequest: integer("is_file_request", { mode: "boolean" })
			.notNull()
			.default(false),
		required: integer("required", { mode: "boolean" }).notNull().default(true),
		/** Days after acceptance the assignment is due (assignment.dueAt = acceptedAt + this). */
		dueInDays: integer("due_in_days"),
		/** Part of the set auto-assigned when a submission is accepted. */
		isOnboardingDefault: integer("is_onboarding_default", { mode: "boolean" })
			.notNull()
			.default(false),
		createdAt: createdAt(),
	},
	(t) => [index("tasks_event_idx").on(t.eventId)],
);

/** A task assigned to a speaker (contact) and/or their submission + completion state. */
export const taskAssignments = sqliteTable(
	"task_assignments",
	{
		id: id(),
		taskId: text("task_id")
			.notNull()
			.references(() => tasks.id, { onDelete: "cascade" }),
		contactId: text("contact_id").references(() => contacts.id, {
			onDelete: "cascade",
		}),
		submissionId: text("submission_id").references(() => submissions.id, {
			onDelete: "cascade",
		}),
		status: text("status", { enum: TASK_STATUS })
			.notNull()
			.default("incomplete"),
		/** Filled portal-form answers or notes. */
		response: text("response", { mode: "json" }).$type<
			Record<string, unknown>
		>(),
		fileKey: text("file_key"), // R2 key for file-request tasks
		dueAt: integer("due_at", { mode: "timestamp" }),
		completedAt: integer("completed_at", { mode: "timestamp" }),
		/** Stamped by the task-due reminder cron so it never double-fires. */
		reminderSentAt: integer("reminder_sent_at", { mode: "timestamp" }),
		createdAt: createdAt(),
	},
	(t) => [
		index("task_assignments_task_idx").on(t.taskId),
		index("task_assignments_contact_status_idx").on(t.contactId, t.status),
		index("task_assignments_submission_idx").on(t.submissionId),
		// Idempotency for the accept spine: replaying an accept or bulk assign
		// must not double-assign — but a multi-talk speaker legitimately holds
		// one assignment PER submission for submission-scoped tasks, so the
		// uniqueness key splits on that scope. Submission-type assignments MUST
		// always carry contactId (NULLs are distinct under SQLite semantics).
		uniqueIndex("task_assignments_contact_scope_uq")
			.on(t.taskId, t.contactId)
			.where(sql`submission_id IS NULL`),
		uniqueIndex("task_assignments_submission_scope_uq")
			.on(t.taskId, t.contactId, t.submissionId)
			.where(sql`submission_id IS NOT NULL`),
	],
);

/* ------------------------------------------------------------------ files --- */

export const FILE_KIND = [
	"headshot",
	"slides",
	"handout",
	"poster",
	"doc",
	"other",
] as const;

/** File-request review states; "none" = not a reviewed file-request upload. */
export const FILE_REVIEW_STATUS = [
	"none",
	"pending",
	"approved",
	"denied",
] as const;

export const files = sqliteTable(
	"files",
	{
		id: id(),
		eventId: text("event_id")
			.notNull()
			.references(() => events.id, { onDelete: "cascade" }),
		submissionId: text("submission_id").references(() => submissions.id, {
			onDelete: "set null",
		}),
		contactId: text("contact_id").references(() => contacts.id, {
			onDelete: "set null",
		}),
		taskAssignmentId: text("task_assignment_id").references(
			() => taskAssignments.id,
			{ onDelete: "set null" },
		),
		r2Key: text("r2_key").notNull(),
		fileName: text("file_name").notNull(),
		kind: text("kind", { enum: FILE_KIND }).notNull().default("other"),
		contentType: text("content_type"),
		sizeBytes: integer("size_bytes"),
		version: integer("version").notNull().default(1),
		/** File-request review loop: pending → approved/denied; denied triggers re-upload. */
		reviewStatus: text("review_status", { enum: FILE_REVIEW_STATUS })
			.notNull()
			.default("none"),
		reviewNote: text("review_note"),
		/** True = organizer-shared FOR DOWNLOAD by portal users (speaker kits etc.). */
		sharedToPortal: integer("shared_to_portal", { mode: "boolean" })
			.notNull()
			.default(false),
		createdAt: createdAt(),
	},
	(t) => [
		index("files_submission_idx").on(t.submissionId),
		index("files_contact_idx").on(t.contactId),
		index("files_shared_idx").on(t.eventId, t.sharedToPortal),
	],
);

/**
 * Cross-role thread on an uploaded file — the speaker comments from the
 * portal, the organizer replies from admin. `authorName` keeps the thread
 * readable if the author's user row goes away.
 */
export const fileComments = sqliteTable(
	"file_comments",
	{
		id: id(),
		fileId: text("file_id")
			.notNull()
			.references(() => files.id, { onDelete: "cascade" }),
		authorId: text("author_id").references(() => users.id, {
			onDelete: "set null",
		}),
		authorName: text("author_name").notNull(),
		body: text("body").notNull(),
		createdAt: createdAt(),
	},
	(t) => [index("file_comments_file_idx").on(t.fileId)],
);

/* ----------------------------------------------------------- public embeds --- */

export const EMBED_TYPE = [
	"sessions",
	"speakers",
	"agenda",
	"itinerary",
	"gallery",
] as const;

/**
 * The five public widget routes exist regardless of this table; an embed row
 * is a configured, shareable instance (`/embed/:publicId` + snippet).
 * `config` narrows content and branding.
 */
export const embeds = sqliteTable(
	"embeds",
	{
		id: id(),
		eventId: text("event_id")
			.notNull()
			.references(() => events.id, { onDelete: "cascade" }),
		publicId: text("public_id")
			.notNull()
			.unique()
			.$defaultFn(() => crypto.randomUUID()),
		name: text("name").notNull(),
		type: text("type", { enum: EMBED_TYPE }).notNull(),
		enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
		config: text("config", { mode: "json" }).$type<{
			trackIds?: string[];
			formatIds?: string[];
			hiddenFields?: string[];
			accentColor?: string;
		}>(),
		createdAt: createdAt(),
	},
	(t) => [index("embeds_event_idx").on(t.eventId)],
);

/* -------------------------------------------------- compat API + Airtable --- */

/**
 * Bearer tokens for the Sessionboard-compatible read API (`x-access-token`).
 * Organization-scoped (Sessionboard parity: tokens mint at Organization
 * Settings); `eventId` set = restricted to that one event (flows/09 rule p),
 * null = all the org's events. Never readable across organizations.
 */
export const apiTokens = sqliteTable(
	"api_tokens",
	{
		id: id(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organizations.id, { onDelete: "cascade" }),
		eventId: text("event_id").references(() => events.id, {
			onDelete: "cascade",
		}),
		name: text("name").notNull(),
		/** SHA-256 of the token — raw value is shown once at mint time, never stored. */
		tokenHash: text("token_hash").notNull().unique(),
		createdAt: createdAt(),
		lastUsedAt: integer("last_used_at", { mode: "timestamp" }),
	},
	(t) => [index("api_tokens_org_idx").on(t.organizationId)],
);

/**
 * One row per synced D1 record ⇄ Airtable record, holding the last-synced
 * field snapshot ("base") for three-way reconciliation (see
 * docs/airtable-sync-design.md). `baseSnapshot` only ever holds the
 * app-declared synced fields — team-private Airtable columns are never read
 * into it.
 */
export const airtableLinks = sqliteTable(
	"airtable_links",
	{
		id: id(),
		tableName: text("table_name").notNull(),
		recordId: text("record_id").notNull(),
		airtableId: text("airtable_id").notNull().unique(),
		baseSnapshot: text("base_snapshot", { mode: "json" }).$type<
			Record<string, unknown>
		>(),
		syncedAt: integer("synced_at", { mode: "timestamp" }),
		createdAt: createdAt(),
	},
	(t) => [unique("airtable_links_table_record_uq").on(t.tableName, t.recordId)],
);

/* ------------------------------------------------------------ speaker CRM --- */

/**
 * Org-level sourcing pipeline card (Speaker CRM). The CRM "person" is derived
 * — the union of the org's event contacts keyed by lowercased email — so a
 * card keys on (organizationId, email) and snapshots identity at enroll time;
 * the directory stays the live profile.
 */
export const pipelineCards = sqliteTable(
	"crm_pipeline_cards",
	{
		id: id(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organizations.id, { onDelete: "cascade" }),
		email: text("email").notNull(), // ALWAYS stored lowercased — see normalizeEmail()
		firstName: text("first_name").notNull(),
		lastName: text("last_name").notNull(),
		companyName: text("company_name"),
		stage: text("stage", { enum: PIPELINE_STAGE })
			.notNull()
			.default("researching"),
		/** Prospect score 0–100, optional at enrollment. */
		score: integer("score"),
		rationale: text("rationale"),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(t) => [
		unique("crm_pipeline_cards_org_email_uq").on(t.organizationId, t.email),
		index("crm_pipeline_cards_org_stage_idx").on(t.organizationId, t.stage),
	],
);

/** Append-only stage-transition history; a null fromStage = the enrollment. */
export const pipelineStageChanges = sqliteTable(
	"crm_stage_history",
	{
		id: id(),
		cardId: text("card_id")
			.notNull()
			.references(() => pipelineCards.id, { onDelete: "cascade" }),
		fromStage: text("from_stage", { enum: PIPELINE_STAGE }),
		toStage: text("to_stage", { enum: PIPELINE_STAGE }).notNull(),
		changedById: text("changed_by_id").references(() => users.id, {
			onDelete: "set null",
		}),
		/** Keeps the history readable if the actor's user row goes away. */
		changedByName: text("changed_by_name").notNull(),
		createdAt: createdAt(),
	},
	(t) => [index("crm_stage_history_card_idx").on(t.cardId)],
);

/**
 * Internal notes on a PERSON (organizationId + lowercased email) — one thread
 * shared by the directory profile and that person's pipeline card, and keyed
 * to the person so removing a card never destroys the org's knowledge.
 */
export const crmNotes = sqliteTable(
	"person_notes",
	{
		id: id(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organizations.id, { onDelete: "cascade" }),
		email: text("email").notNull(),
		authorId: text("author_id").references(() => users.id, {
			onDelete: "set null",
		}),
		authorName: text("author_name").notNull(),
		body: text("body").notNull(),
		createdAt: createdAt(),
	},
	(t) => [index("person_notes_org_email_idx").on(t.organizationId, t.email)],
);

/**
 * A saved directory filter set — a dynamic segment: reopening re-runs the
 * filters, so membership always reflects the current directory.
 */
export const crmSegments = sqliteTable(
	"crm_segments",
	{
		id: id(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organizations.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		filters: text("filters", { mode: "json" })
			.$type<{
				q?: string;
				company?: string;
				title?: string;
				eventId?: string;
				status?: string;
			}>()
			.notNull(),
		createdById: text("created_by_id").references(() => users.id, {
			onDelete: "set null",
		}),
		createdAt: createdAt(),
	},
	(t) => [unique("crm_segments_org_name_uq").on(t.organizationId, t.name)],
);

/* ------------------------------------------------------------------ email --- */

export const EMAIL_CATEGORY = ["lifecycle", "custom"] as const;
export const EMAIL_TRIGGER = ["manual", "auto"] as const;
export const EMAIL_STATUS = ["queued", "sent", "failed", "bounced"] as const;

/** Event-level editable templates (Accept/Decline/Reminders/Confirmation…). */
export const emailTemplates = sqliteTable(
	"email_templates",
	{
		id: id(),
		eventId: text("event_id")
			.notNull()
			.references(() => events.id, { onDelete: "cascade" }),
		/** Stable machine key, e.g. "submission_confirmation", "accept". */
		key: text("key").notNull(),
		name: text("name").notNull(),
		subject: text("subject").notNull().default(""),
		bodyHtml: text("body_html").notNull().default(""),
		/** Replies from speakers land here (organizer inbox), not at the sender. */
		replyTo: text("reply_to"),
		category: text("category", { enum: EMAIL_CATEGORY })
			.notNull()
			.default("lifecycle"),
		trigger: text("trigger", { enum: EMAIL_TRIGGER })
			.notNull()
			.default("manual"),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(t) => [
		index("email_templates_event_idx").on(t.eventId),
		unique("email_templates_event_key_uq").on(t.eventId, t.key),
	],
);

/**
 * Unsubscribed addresses — checked by the EmailSender port for announcement
 * ("bulk") sends only; emails about the recipient's own submissions always
 * deliver. Populated by the unsubscribe footer link.
 */
export const emailSuppressions = sqliteTable("email_suppressions", {
	id: id(),
	email: text("email").notNull().unique(),
	reason: text("reason"),
	createdAt: createdAt(),
});

/**
 * Email send log + local inbox behind the EmailSender port. In dev/worktrees
 * this table IS the readable inbox (agents query it to verify sends). `dedupeKey`
 * (template+recipient+occurrence) enforces idempotency so cron reminders can't
 * double-fire; `status` tracks queued→sent/failed/bounced.
 */
export const emailOutbox = sqliteTable(
	"email_outbox",
	{
		id: id(),
		eventId: text("event_id").references(() => events.id, {
			onDelete: "set null",
		}),
		templateId: text("template_id").references(() => emailTemplates.id, {
			onDelete: "set null",
		}),
		dedupeKey: text("dedupe_key").unique(),
		to: text("to").notNull(),
		replyTo: text("reply_to"),
		subject: text("subject").notNull(),
		html: text("html").notNull(),
		icsAttachment: text("ics_attachment"),
		status: text("status", { enum: EMAIL_STATUS }).notNull().default("queued"),
		error: text("error"),
		providerId: text("provider_id"), // Resend id once really sent (prod)
		createdAt: createdAt(),
		sentAt: integer("sent_at", { mode: "timestamp" }),
	},
	(t) => [
		index("email_outbox_event_idx").on(t.eventId),
		index("email_outbox_status_idx").on(t.status),
	],
);

/* -------------------------------------------------------------- relations --- */

export const usersRelations = relations(users, ({ many }) => ({
	contacts: many(contacts),
	reviews: many(reviews),
	reviewerTracks: many(reviewerTracks),
	organizationMemberships: many(organizationMembers),
	contactMergeAliasesAsSource: many(contactIdentityAliases, {
		relationName: "contactMergeSourceUser",
	}),
	contactMergeAliasesAsSurvivor: many(contactIdentityAliases, {
		relationName: "contactMergeSurvivorUser",
	}),
}));

export const organizationsRelations = relations(organizations, ({ many }) => ({
	events: many(events),
	members: many(organizationMembers),
	apiTokens: many(apiTokens),
	fields: many(fields),
	contactMerges: many(contactMerges),
	contactIdentityAliases: many(contactIdentityAliases),
}));

export const organizationMembersRelations = relations(
	organizationMembers,
	({ one }) => ({
		organization: one(organizations, {
			fields: [organizationMembers.organizationId],
			references: [organizations.id],
		}),
		user: one(users, {
			fields: [organizationMembers.userId],
			references: [users.id],
		}),
	}),
);

export const eventsRelations = relations(events, ({ one, many }) => ({
	organization: one(organizations, {
		fields: [events.organizationId],
		references: [organizations.id],
	}),
	submissions: many(submissions),
	tracks: many(tracks),
	sessionStatuses: many(sessionStatuses),
	tags: many(tags),
	formats: many(formats),
	levels: many(levels),
	rooms: many(rooms),
	forms: many(forms),
	contacts: many(contacts),
	tasks: many(tasks),
	emailTemplates: many(emailTemplates),
	evaluationPlans: many(evaluationPlans),
	embeds: many(embeds),
}));

export const sessionStatusesRelations = relations(
	sessionStatuses,
	({ one, many }) => ({
		event: one(events, {
			fields: [sessionStatuses.eventId],
			references: [events.id],
		}),
		submissions: many(submissions),
	}),
);

export const formsRelations = relations(forms, ({ one, many }) => ({
	event: one(events, { fields: [forms.eventId], references: [events.id] }),
	formFields: many(formFields),
	submissions: many(submissions),
}));

export const fieldsRelations = relations(fields, ({ one, many }) => ({
	organization: one(organizations, {
		fields: [fields.organizationId],
		references: [organizations.id],
	}),
	event: one(events, { fields: [fields.eventId], references: [events.id] }),
	formFields: many(formFields),
}));

export const apiTokensRelations = relations(apiTokens, ({ one }) => ({
	organization: one(organizations, {
		fields: [apiTokens.organizationId],
		references: [organizations.id],
	}),
	event: one(events, { fields: [apiTokens.eventId], references: [events.id] }),
}));

export const formFieldsRelations = relations(formFields, ({ one }) => ({
	form: one(forms, { fields: [formFields.formId], references: [forms.id] }),
	field: one(fields, { fields: [formFields.fieldId], references: [fields.id] }),
}));

export const contactsRelations = relations(contacts, ({ one, many }) => ({
	event: one(events, { fields: [contacts.eventId], references: [events.id] }),
	user: one(users, { fields: [contacts.userId], references: [users.id] }),
	participants: many(participants),
	customValues: many(contactFieldValues),
}));

export const contactFieldValuesRelations = relations(
	contactFieldValues,
	({ one }) => ({
		contact: one(contacts, {
			fields: [contactFieldValues.contactId],
			references: [contacts.id],
		}),
		field: one(fields, {
			fields: [contactFieldValues.fieldId],
			references: [fields.id],
		}),
	}),
);

export const contactMergesRelations = relations(
	contactMerges,
	({ one, many }) => ({
		organization: one(organizations, {
			fields: [contactMerges.organizationId],
			references: [organizations.id],
		}),
		actor: one(users, {
			fields: [contactMerges.actorId],
			references: [users.id],
		}),
		identityAliases: many(contactIdentityAliases),
	}),
);

export const contactIdentityAliasesRelations = relations(
	contactIdentityAliases,
	({ one }) => ({
		organization: one(organizations, {
			fields: [contactIdentityAliases.organizationId],
			references: [organizations.id],
		}),
		sourceUser: one(users, {
			fields: [contactIdentityAliases.sourceUserId],
			references: [users.id],
			relationName: "contactMergeSourceUser",
		}),
		survivorUser: one(users, {
			fields: [contactIdentityAliases.survivorUserId],
			references: [users.id],
			relationName: "contactMergeSurvivorUser",
		}),
		merge: one(contactMerges, {
			fields: [contactIdentityAliases.mergeId],
			references: [contactMerges.id],
		}),
	}),
);

export const submissionsRelations = relations(submissions, ({ one, many }) => ({
	event: one(events, {
		fields: [submissions.eventId],
		references: [events.id],
	}),
	form: one(forms, { fields: [submissions.formId], references: [forms.id] }),
	submitter: one(users, {
		fields: [submissions.submitterId],
		references: [users.id],
	}),
	format: one(formats, {
		fields: [submissions.formatId],
		references: [formats.id],
	}),
	level: one(levels, {
		fields: [submissions.levelId],
		references: [levels.id],
	}),
	room: one(rooms, { fields: [submissions.roomId], references: [rooms.id] }),
	customStatus: one(sessionStatuses, {
		fields: [submissions.customStatusId],
		references: [sessionStatuses.id],
	}),
	parent: one(submissions, {
		fields: [submissions.parentId],
		references: [submissions.id],
		relationName: "subsessions",
	}),
	subsessions: many(submissions, { relationName: "subsessions" }),
	participants: many(participants),
	submissionTracks: many(submissionTracks),
	submissionTags: many(submissionTags),
	submissionAnswers: many(submissionAnswers),
	reviews: many(reviews),
	revisions: many(submissionRevisions),
	evaluations: many(evaluations),
}));

export const submissionRevisionsRelations = relations(
	submissionRevisions,
	({ one }) => ({
		submission: one(submissions, {
			fields: [submissionRevisions.submissionId],
			references: [submissions.id],
		}),
		editedBy: one(users, {
			fields: [submissionRevisions.editedById],
			references: [users.id],
		}),
	}),
);

export const evaluationPlansRelations = relations(
	evaluationPlans,
	({ one, many }) => ({
		event: one(events, {
			fields: [evaluationPlans.eventId],
			references: [events.id],
		}),
		rounds: many(evaluationRounds),
	}),
);

export const evaluationRoundsRelations = relations(
	evaluationRounds,
	({ one, many }) => ({
		plan: one(evaluationPlans, {
			fields: [evaluationRounds.planId],
			references: [evaluationPlans.id],
		}),
		evaluators: many(roundEvaluators),
		questions: many(roundQuestions),
		evaluations: many(evaluations),
	}),
);

export const roundEvaluatorsRelations = relations(
	roundEvaluators,
	({ one }) => ({
		round: one(evaluationRounds, {
			fields: [roundEvaluators.roundId],
			references: [evaluationRounds.id],
		}),
		user: one(users, {
			fields: [roundEvaluators.userId],
			references: [users.id],
		}),
	}),
);

export const roundQuestionsRelations = relations(
	roundQuestions,
	({ one, many }) => ({
		round: one(evaluationRounds, {
			fields: [roundQuestions.roundId],
			references: [evaluationRounds.id],
		}),
		answers: many(evaluationAnswers),
	}),
);

export const evaluationsRelations = relations(evaluations, ({ one, many }) => ({
	round: one(evaluationRounds, {
		fields: [evaluations.roundId],
		references: [evaluationRounds.id],
	}),
	submission: one(submissions, {
		fields: [evaluations.submissionId],
		references: [submissions.id],
	}),
	evaluator: one(users, {
		fields: [evaluations.evaluatorId],
		references: [users.id],
	}),
	answers: many(evaluationAnswers),
}));

export const evaluationAnswersRelations = relations(
	evaluationAnswers,
	({ one }) => ({
		evaluation: one(evaluations, {
			fields: [evaluationAnswers.evaluationId],
			references: [evaluations.id],
		}),
		question: one(roundQuestions, {
			fields: [evaluationAnswers.questionId],
			references: [roundQuestions.id],
		}),
	}),
);

export const fileCommentsRelations = relations(fileComments, ({ one }) => ({
	file: one(files, {
		fields: [fileComments.fileId],
		references: [files.id],
	}),
	author: one(users, {
		fields: [fileComments.authorId],
		references: [users.id],
	}),
}));

export const filesRelations = relations(files, ({ one, many }) => ({
	event: one(events, { fields: [files.eventId], references: [events.id] }),
	submission: one(submissions, {
		fields: [files.submissionId],
		references: [submissions.id],
	}),
	contact: one(contacts, {
		fields: [files.contactId],
		references: [contacts.id],
	}),
	comments: many(fileComments),
}));

export const embedsRelations = relations(embeds, ({ one }) => ({
	event: one(events, { fields: [embeds.eventId], references: [events.id] }),
}));

export const submissionTracksRelations = relations(
	submissionTracks,
	({ one }) => ({
		submission: one(submissions, {
			fields: [submissionTracks.submissionId],
			references: [submissions.id],
		}),
		track: one(tracks, {
			fields: [submissionTracks.trackId],
			references: [tracks.id],
		}),
	}),
);

export const submissionTagsRelations = relations(submissionTags, ({ one }) => ({
	submission: one(submissions, {
		fields: [submissionTags.submissionId],
		references: [submissions.id],
	}),
	tag: one(tags, { fields: [submissionTags.tagId], references: [tags.id] }),
}));

export const submissionAnswersRelations = relations(
	submissionAnswers,
	({ one }) => ({
		submission: one(submissions, {
			fields: [submissionAnswers.submissionId],
			references: [submissions.id],
		}),
		field: one(fields, {
			fields: [submissionAnswers.fieldId],
			references: [fields.id],
		}),
	}),
);

export const participantsRelations = relations(participants, ({ one }) => ({
	submission: one(submissions, {
		fields: [participants.submissionId],
		references: [submissions.id],
	}),
	contact: one(contacts, {
		fields: [participants.contactId],
		references: [contacts.id],
	}),
}));

export const tracksRelations = relations(tracks, ({ one, many }) => ({
	event: one(events, { fields: [tracks.eventId], references: [events.id] }),
	submissionTracks: many(submissionTracks),
	reviewerTracks: many(reviewerTracks),
}));

export const tagsRelations = relations(tags, ({ one, many }) => ({
	event: one(events, { fields: [tags.eventId], references: [events.id] }),
	submissionTags: many(submissionTags),
}));

export const reviewsRelations = relations(reviews, ({ one }) => ({
	submission: one(submissions, {
		fields: [reviews.submissionId],
		references: [submissions.id],
	}),
	reviewer: one(users, {
		fields: [reviews.reviewerId],
		references: [users.id],
	}),
}));

export const aiReviewsRelations = relations(aiReviews, ({ one }) => ({
	submission: one(submissions, {
		fields: [aiReviews.submissionId],
		references: [submissions.id],
	}),
	overrideBy: one(users, {
		fields: [aiReviews.overrideById],
		references: [users.id],
	}),
}));

export const reviewerTracksRelations = relations(reviewerTracks, ({ one }) => ({
	user: one(users, {
		fields: [reviewerTracks.userId],
		references: [users.id],
	}),
	track: one(tracks, {
		fields: [reviewerTracks.trackId],
		references: [tracks.id],
	}),
}));

export const tasksRelations = relations(tasks, ({ one, many }) => ({
	event: one(events, { fields: [tasks.eventId], references: [events.id] }),
	portalForm: one(portalForms, {
		fields: [tasks.portalFormId],
		references: [portalForms.id],
	}),
	assignments: many(taskAssignments),
}));

export const taskAssignmentsRelations = relations(
	taskAssignments,
	({ one }) => ({
		task: one(tasks, {
			fields: [taskAssignments.taskId],
			references: [tasks.id],
		}),
		contact: one(contacts, {
			fields: [taskAssignments.contactId],
			references: [contacts.id],
		}),
		submission: one(submissions, {
			fields: [taskAssignments.submissionId],
			references: [submissions.id],
		}),
	}),
);

export const pipelineCardsRelations = relations(
	pipelineCards,
	({ one, many }) => ({
		organization: one(organizations, {
			fields: [pipelineCards.organizationId],
			references: [organizations.id],
		}),
		stageChanges: many(pipelineStageChanges),
	}),
);

export const pipelineStageChangesRelations = relations(
	pipelineStageChanges,
	({ one }) => ({
		card: one(pipelineCards, {
			fields: [pipelineStageChanges.cardId],
			references: [pipelineCards.id],
		}),
		changedBy: one(users, {
			fields: [pipelineStageChanges.changedById],
			references: [users.id],
		}),
	}),
);

export const crmNotesRelations = relations(crmNotes, ({ one }) => ({
	organization: one(organizations, {
		fields: [crmNotes.organizationId],
		references: [organizations.id],
	}),
	author: one(users, {
		fields: [crmNotes.authorId],
		references: [users.id],
	}),
}));

export const crmSegmentsRelations = relations(crmSegments, ({ one }) => ({
	organization: one(organizations, {
		fields: [crmSegments.organizationId],
		references: [organizations.id],
	}),
}));

/* --------------------------------------------------------------- contracts --- */

// drizzle-zod: DB shape → Zod, so form/API/loader contracts share one source
// of truth.
export const insertSubmissionSchema = createInsertSchema(submissions);
export const selectSubmissionSchema = createSelectSchema(submissions);
export const insertContactSchema = createInsertSchema(contacts);
export const insertFormSchema = createInsertSchema(forms);
export const insertReviewSchema = createInsertSchema(reviews);
export const insertTaskSchema = createInsertSchema(tasks);

export type Submission = typeof submissions.$inferSelect;
export type NewSubmission = typeof submissions.$inferInsert;
export type Contact = typeof contacts.$inferSelect;
export type ContactMerge = typeof contactMerges.$inferSelect;
export type ContactIdentityAlias = typeof contactIdentityAliases.$inferSelect;
export type Form = typeof forms.$inferSelect;
export type PipelineCard = typeof pipelineCards.$inferSelect;
export type CrmSegment = typeof crmSegments.$inferSelect;
