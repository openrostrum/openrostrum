import { and, eq, gt, inArray, isNotNull, lte } from "drizzle-orm";
import { stepPath } from "~/cfp/wizard";
import { getDb } from "~/db";
import { emailTemplates, events, forms, submissions, users } from "~/db/schema";
import { submitPath } from "~/domain/forms";
import { formatInTimeZone } from "~/lib/dates";
import {
	type MergeContext,
	renderBody,
	renderSubject,
} from "~/lib/email-render";
import { errorMessage } from "~/lib/errors";
import { calendarDaysUntil, DAY_MS, resolveTimezone } from "~/lib/event-time";
import { escapeHtml } from "~/lib/html";
import { emailOrigin, firstPortalsByEvent, portalUrl } from "~/lib/portal-url";
import { track } from "~/lib/track";
import { type Clock, systemClock } from "~/ports/clock";
import { type EmailSender, getEmailSender } from "~/ports/email";
import { DAILY_CRON } from "./cadence";
import type { ScheduledJob } from "./registry";

/** Furthest-out close date any occurrence can match from this tick: 5 event-tz
 * calendar days ahead is at most ~6 absolute days; 7 keeps the query cheap
 * without ever clipping a due form. */
const CLOSE_HORIZON_MS = 7 * DAY_MS;

type ReminderWindow = "reminder_5day" | "reminder_1day";

/**
 * Which reminder occurrence this tick owes for a form closing at `closeAt`.
 * "Days before close" counts CALENDAR days in the EVENT's timezone — a form
 * closing Sep 15 23:59 PDT is 5 days out on Sep 10 anywhere in that day, even
 * while UTC already reads Sep 16 at the close instant. Windows are ranges,
 * not exact matches, so a missed tick (or a late toggle-on) sends the still-
 * truthful reminder instead of silently skipping the occurrence; once inside
 * the final day only the 1-day occurrence is owed.
 */
export function reminderWindow(
	now: Date,
	closeAt: Date,
	timeZone: string,
): ReminderWindow | null {
	if (now.getTime() >= closeAt.getTime()) return null;
	const days = calendarDaysUntil(now, closeAt, timeZone);
	if (days <= 1) return "reminder_1day";
	if (days <= 5) return "reminder_5day";
	return null;
}

function resumeDraftHtml(row: {
	formTitle: string;
	closeDate: string;
	drafts: Array<{ title: string }>;
	resumeUrl: string | null;
}): string {
	const [latest] = row.drafts;
	const what =
		row.drafts.length === 1 && latest
			? `Your draft <strong>${escapeHtml(latest.title)}</strong>`
			: `Your ${row.drafts.length} drafts`;
	const cta = row.resumeUrl
		? `<p><a href="${row.resumeUrl}">Resume your draft</a> to finish and submit before the deadline.</p>`
		: "<p>Return to the submission form to finish and submit before the deadline.</p>";
	return `<hr><p>${what} for <strong>${escapeHtml(row.formTitle)}</strong> ${
		row.drafts.length === 1 ? "has" : "have"
	} not been submitted — the form closes ${escapeHtml(row.closeDate)}.</p>${cta}`;
}

/**
 * Draft-close reminders: 5 days and 1 day before an open form's close date,
 * every account holding a draft on that form gets one email per occurrence,
 * rendered from the event's `reminder_5day`/`reminder_1day` templates. The
 * outbox `dedupeKey` is the persisted send marker — it names the occurrence
 * AND the close instant, so replaying a tick delivers nothing new while an
 * extended deadline re-arms both occurrences (the task-reminder precedent).
 * Reminders are transactional: they concern the recipient's own draft, so an
 * unsubscribe never silences them.
 */
export async function runDraftCloseReminders(
	env: Env,
	clock: Clock,
	injectedSender?: EmailSender,
): Promise<{ sent: number; deduped: number; failed: number }> {
	const db = getDb(env);
	// Resolved up front: a prod deployment missing APP_ORIGIN must fail loudly
	// before any link-less email goes out.
	const origin = emailOrigin(env);
	const now = clock.now();

	const candidateForms = await db
		.select({
			formId: forms.id,
			publicId: forms.publicId,
			externalTitle: forms.externalTitle,
			internalName: forms.internalName,
			closeAt: forms.closeAt,
			eventId: events.id,
			eventName: events.name,
			eventSlug: events.slug,
			timezone: events.timezone,
		})
		.from(forms)
		.innerJoin(events, eq(events.id, forms.eventId))
		.where(
			and(
				eq(forms.sendReminders, true),
				eq(forms.status, "open"),
				isNotNull(forms.closeAt),
				gt(forms.closeAt, now),
				lte(forms.closeAt, new Date(now.getTime() + CLOSE_HORIZON_MS)),
			),
		);

	// resolveTimezone: a malformed event timezone degrades that form's day math
	// to UTC (the repo-wide policy) instead of throwing and starving the tick.
	const dueForms = candidateForms.flatMap((form) => {
		if (!form.closeAt) return [];
		const timezone = resolveTimezone(form.timezone);
		const window = reminderWindow(now, form.closeAt, timezone);
		return window ? [{ ...form, closeAt: form.closeAt, timezone, window }] : [];
	});
	if (dueForms.length === 0) return { sent: 0, deduped: 0, failed: 0 };

	const draftRows = await db
		.select({
			formId: submissions.formId,
			submissionId: submissions.id,
			title: submissions.title,
			updatedAt: submissions.updatedAt,
			userId: users.id,
			email: users.email,
			name: users.name,
		})
		.from(submissions)
		.innerJoin(users, eq(users.id, submissions.submitterId))
		.where(
			and(
				inArray(
					submissions.formId,
					dueForms.map((f) => f.formId),
				),
				eq(submissions.status, "draft"),
			),
		);
	if (draftRows.length === 0) return { sent: 0, deduped: 0, failed: 0 };

	const eventIds = [...new Set(dueForms.map((f) => f.eventId))];
	const templates = await db
		.select({
			id: emailTemplates.id,
			eventId: emailTemplates.eventId,
			key: emailTemplates.key,
			subject: emailTemplates.subject,
			bodyHtml: emailTemplates.bodyHtml,
			replyTo: emailTemplates.replyTo,
		})
		.from(emailTemplates)
		.where(
			and(
				inArray(emailTemplates.eventId, eventIds),
				inArray(emailTemplates.key, ["reminder_5day", "reminder_1day"]),
			),
		);
	const templateByEventKey = new Map(
		templates.map((t) => [`${t.eventId}:${t.key}`, t]),
	);
	const portalByEvent = await firstPortalsByEvent(db);

	const sender = injectedSender ?? getEmailSender(env);
	let sent = 0;
	let deduped = 0;
	let failed = 0;
	for (const form of dueForms) {
		// Newest draft first — it carries the deep link and the session_title tag.
		const formDrafts = draftRows
			.filter((d) => d.formId === form.formId)
			.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
		if (formDrafts.length === 0) continue;

		const template = templateByEventKey.get(`${form.eventId}:${form.window}`);
		if (!template) {
			// One event's missing template must not starve other tenants' sends;
			// the skip event is the loud record (provisioning makes this rare).
			track("cfp.draft_reminder_skipped", {
				eventId: form.eventId,
				formId: form.formId,
				window: form.window,
				reason: "missing_template",
			});
			continue;
		}

		const formTitle = form.externalTitle || form.internalName;
		const closeDate = formatInTimeZone(form.closeAt, form.timezone);
		const portalId = portalByEvent.get(form.eventId);
		const portalLink =
			origin && portalId ? portalUrl(origin, form.eventSlug, portalId) : null;

		const byUser = new Map<string, typeof formDrafts>();
		for (const draft of formDrafts) {
			const list = byUser.get(draft.userId) ?? [];
			list.push(draft);
			byUser.set(draft.userId, list);
		}

		for (const [userId, drafts] of byUser) {
			const latest = drafts[0];
			if (!latest) continue;
			const fullName = (latest.name ?? "").trim();
			const [firstName = "", ...rest] = fullName.split(/\s+/);
			const ctx: MergeContext = {
				first_name: firstName,
				last_name: rest.join(" "),
				full_name: fullName,
				email: latest.email,
				event_name: form.eventName,
				session_title: latest.title,
				session_date_time: null,
				starts_at: null,
				ends_at: null,
				session_room: null,
				location: null,
				portal_link: portalLink,
				form_title: formTitle,
				form_close_date: closeDate,
			};
			// The wizard's own URL builders: a single draft deep-links via ?sid=,
			// several land on the wizard's resume list.
			const resumeUrl = origin
				? origin +
					stepPath(
						submitPath(form.eventSlug, form.publicId),
						"session",
						drafts.length === 1 ? latest.submissionId : undefined,
					)
				: null;
			const html =
				renderBody(template.bodyHtml, ctx) +
				resumeDraftHtml({
					formTitle,
					closeDate,
					drafts: drafts.map((d) => ({ title: d.title })),
					resumeUrl,
				});
			try {
				const result = await sender.send({
					to: latest.email,
					replyTo: template.replyTo ?? undefined,
					subject: renderSubject(template.subject, ctx),
					html,
					kind: "transactional",
					dedupeKey: `${form.window}:${form.formId}:${userId}:${Math.floor(
						form.closeAt.getTime() / 1000,
					)}`,
					eventId: form.eventId,
					templateId: template.id,
				});
				if (result.deduped) deduped += 1;
				else sent += 1;
				track("cfp.draft_reminder_sent", {
					eventId: form.eventId,
					formId: form.formId,
					userId,
					window: form.window,
					deduped: result.deduped,
				});
			} catch (error) {
				// No marker on failure — the next tick retries this recipient.
				failed += 1;
				track("cfp.draft_reminder_send_failed", {
					eventId: form.eventId,
					formId: form.formId,
					userId,
					window: form.window,
					error: errorMessage(error),
				});
			}
		}
	}
	if (failed > 0) {
		throw new Error(
			`Draft close reminders failed: ${failed} ${failed === 1 ? "recipient" : "recipients"}.`,
		);
	}
	return { sent, deduped, failed };
}

const job: ScheduledJob = {
	name: "draft-close-reminders",
	cron: DAILY_CRON,
	async run(env) {
		await runDraftCloseReminders(env, systemClock);
	},
};

export default job;
