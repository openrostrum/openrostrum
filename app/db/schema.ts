import { relations } from "drizzle-orm";
import {
	integer,
	primaryKey,
	sqliteTable,
	text,
} from "drizzle-orm/sqlite-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";

/**
 * STARTER domain schema — the shared contract every feature agent extends.
 *
 * This is the v1 spine (events → forms → submissions → participants → tasks +
 * auth + the email outbox). It is intentionally the *pattern*, not the whole
 * domain: add columns/tables here on the integration branch, never per-worktree
 * (see docs/tech-stack.md → migration protocol). Conventions:
 *   - text UUID primary keys via crypto.randomUUID() (available on Workers)
 *   - timestamps stored as unix epoch (integer, mode: "timestamp")
 *   - enums as text with a checked { enum: [...] } union
 */

const id = () =>
	text("id")
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID());
const createdAt = () =>
	integer("created_at", { mode: "timestamp" })
		.notNull()
		.$defaultFn(() => new Date());

export const users = sqliteTable("users", {
	id: id(),
	email: text("email").notNull().unique(),
	passwordHash: text("password_hash").notNull(),
	name: text("name"),
	role: text("role", { enum: ["admin", "speaker"] })
		.notNull()
		.default("speaker"),
	createdAt: createdAt(),
});

export const events = sqliteTable("events", {
	id: id(),
	name: text("name").notNull(),
	slug: text("slug").notNull().unique(),
	timezone: text("timezone").notNull().default("America/Los_Angeles"),
	startsAt: integer("starts_at", { mode: "timestamp" }),
	endsAt: integer("ends_at", { mode: "timestamp" }),
	createdAt: createdAt(),
});

export const tracks = sqliteTable("tracks", {
	id: id(),
	eventId: text("event_id")
		.notNull()
		.references(() => events.id, { onDelete: "cascade" }),
	name: text("name").notNull(),
	color: text("color").notNull().default("#6366f1"),
	createdAt: createdAt(),
});

/** The 5 assignable statuses + participant-driven `withdrawn` + pre-submit `draft`. */
export const SUBMISSION_STATUS = [
	"draft",
	"pending",
	"accept_queue",
	"accepted",
	"decline_queue",
	"declined",
	"withdrawn",
] as const;

export const submissions = sqliteTable("submissions", {
	id: id(),
	eventId: text("event_id")
		.notNull()
		.references(() => events.id, { onDelete: "cascade" }),
	title: text("title").notNull(),
	description: text("description").notNull().default(""),
	status: text("status", { enum: SUBMISSION_STATUS })
		.notNull()
		.default("pending"),
	submitterId: text("submitter_id").references(() => users.id, {
		onDelete: "set null",
	}),
	format: text("format"),
	level: text("level"),
	language: text("language").default("English"),
	createdAt: createdAt(),
	updatedAt: integer("updated_at", { mode: "timestamp" })
		.notNull()
		.$defaultFn(() => new Date()),
});

/** Submissions ↔ tracks is many-to-many (a submission carries ≥1 track). */
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
	(t) => [primaryKey({ columns: [t.submissionId, t.trackId] })],
);

export const participants = sqliteTable("participants", {
	id: id(),
	submissionId: text("submission_id")
		.notNull()
		.references(() => submissions.id, { onDelete: "cascade" }),
	userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
	firstName: text("first_name").notNull(),
	lastName: text("last_name").notNull(),
	email: text("email").notNull(),
	role: text("role", { enum: ["speaker", "chairperson", "moderator"] })
		.notNull()
		.default("speaker"),
	bio: text("bio"),
	headshotKey: text("headshot_key"), // R2 object key
	createdAt: createdAt(),
});

/**
 * Local-and-prod email sink behind the EmailSender port. In dev/worktrees this
 * table IS the readable inbox (agents query it to verify sends). `dedupeKey`
 * (template+recipient+occurrence) enforces idempotency so cron reminders can't
 * double-fire; `sentAt` null = queued, set = delivered.
 */
export const emailOutbox = sqliteTable("email_outbox", {
	id: id(),
	dedupeKey: text("dedupe_key").unique(),
	to: text("to").notNull(),
	subject: text("subject").notNull(),
	html: text("html").notNull(),
	icsAttachment: text("ics_attachment"),
	providerId: text("provider_id"), // Resend id once really sent (prod)
	createdAt: createdAt(),
	sentAt: integer("sent_at", { mode: "timestamp" }),
});

export const eventsRelations = relations(events, ({ many }) => ({
	submissions: many(submissions),
	tracks: many(tracks),
}));
export const submissionsRelations = relations(submissions, ({ one, many }) => ({
	event: one(events, {
		fields: [submissions.eventId],
		references: [events.id],
	}),
	submitter: one(users, {
		fields: [submissions.submitterId],
		references: [users.id],
	}),
	participants: many(participants),
	submissionTracks: many(submissionTracks),
}));
export const participantsRelations = relations(participants, ({ one }) => ({
	submission: one(submissions, {
		fields: [participants.submissionId],
		references: [submissions.id],
	}),
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

// drizzle-zod: DB shape → Zod, so form/API contracts share one source of truth.
// This is the pattern for every table (see docs/tech-stack.md).
export const insertSubmissionSchema = createInsertSchema(submissions);
export const selectSubmissionSchema = createSelectSchema(submissions);
export type Submission = typeof submissions.$inferSelect;
export type NewSubmission = typeof submissions.$inferInsert;
