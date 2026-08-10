// @public route family — the loader gates with getUser and redirects to the
// account step; the action requires a signed-in speaker.
import { useEffect, useMemo, useState } from "react";
import {
	data,
	redirect,
	useFetcher,
	useNavigate,
	useOutletContext,
	useRouteLoaderData,
	useSearchParams,
} from "react-router";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { validateSection, type WizardState } from "~/cfp/definition";
import { SectionFields } from "~/cfp/fields";
import { normalizeSelfRows, WizardPayload } from "~/cfp/payload";
import {
	countSubmissionsUsed,
	effectiveSubmissionLimit,
	isFormClosed,
	listDrafts,
	loadPublicForm,
	loadSelfContact,
	loadWizardInitial,
	resolveFormDefinition,
	writeSubmission,
	type FormDefinition,
} from "~/cfp/server";
import {
	AnswersSummary,
	ParticipantsSummary,
	SummarySection,
} from "~/cfp/summary";
import {
	AnchorTextLink,
	ConfirmDialog,
	HtmlContent,
	InfoNotice,
	LeadText,
	MutedText,
	PageTitle,
	RowTitle,
} from "~/cfp/ui";
import {
	newWizardState,
	stepPath,
	submitBasePath,
	type WizardCtx,
	wizardPayload,
} from "~/cfp/wizard";
import { getDb } from "~/db";
import { submissions } from "~/db/schema";
import { getUser, requireUser } from "~/lib/auth";
import { errorMessage } from "~/lib/errors";
import { createTimings, track } from "~/lib/track";
import { systemClock } from "~/ports/clock";
import {
	Button,
	ButtonLink,
	EmptyState,
	ErrorText,
	Panel,
	StatusBadge,
} from "~/ui";
import type { Route } from "./+types/submit.$eventSlug.$formId.step.session";
import type { Route as LayoutRoute } from "./+types/submit.$eventSlug.$formId";

export function headers({ loaderHeaders }: Route.HeadersArgs) {
	return loaderHeaders;
}

export async function loader({ context, request, params }: Route.LoaderArgs) {
	const env = context.cloudflare.env;
	const url = new URL(request.url);
	const base = submitBasePath(params.eventSlug, params.formId);
	const user = await getUser(env, request);
	if (!user) {
		throw redirect(`${base}/step/account${url.search}`);
	}
	const bundle = await loadPublicForm(env, params.eventSlug, params.formId);
	if (!bundle) throw data("Form not found", { status: 404 });
	const { form, event } = bundle;
	const db = getDb(env);
	const closed = isFormClosed(form, systemClock.now());
	const timings = createTimings();

	const definition = await timings.time("definition", () =>
		resolveFormDefinition(db, form),
	);
	const selfContact = await loadSelfContact(db, event.id, user);
	const sectionTitle =
		form.sessionSectionTitle || "Tell us about your submission";
	const sectionHtml = form.sessionSectionHtml;

	const sid = url.searchParams.get("sid");
	if (sid) {
		const initial = await timings.time("draft", () =>
			loadWizardInitial(db, form, user.id, sid),
		);
		if (!initial) throw data("Submission not found", { status: 404 });
		return data(
			{
				mode: "form" as const,
				readOnly: closed,
				initial,
				definition,
				selfContact,
				sectionTitle,
				sectionHtml,
				drafts: [],
				limit: null as number | null,
				used: 0,
				limitReached: false,
			},
			{ headers: { "Server-Timing": timings.header() } },
		);
	}

	if (closed) {
		// The layout renders the closed state in place of this step.
		return data({
			mode: "closed" as const,
			readOnly: true,
			initial: null,
			definition,
			selfContact,
			sectionTitle,
			sectionHtml,
			drafts: [],
			limit: null as number | null,
			used: 0,
			limitReached: false,
		});
	}

	const drafts = await timings.time("drafts", () =>
		listDrafts(db, form.id, user.id),
	);
	const used = await countSubmissionsUsed(db, form.id, user.id);
	const limit = effectiveSubmissionLimit(form, event);
	const limitReached = limit !== null && used >= limit;
	const startNew = url.searchParams.has("new");

	// At the limit, existing drafts can still be completed (they already count)
	// — only STARTING a submission is blocked.
	const mode = limitReached
		? drafts.length > 0
			? ("hub" as const)
			: ("blocked" as const)
		: !startNew && drafts.length > 0
			? ("hub" as const)
			: ("form" as const);

	return data(
		{
			mode,
			readOnly: false,
			initial: null,
			definition,
			selfContact,
			sectionTitle,
			sectionHtml,
			drafts: drafts.map((d) => ({
				id: d.id,
				title: d.title,
				updatedAt: d.updatedAt.getTime(),
			})),
			limit,
			used,
			limitReached,
		},
		{ headers: { "Server-Timing": timings.header() } },
	);
}

const SaveDraft = z.object({
	intent: z.literal("save-draft"),
	...WizardPayload.shape,
});
const DeleteDraft = z.object({
	intent: z.literal("delete-draft"),
	sid: z.string().min(1).max(120),
});
const ActionPayload = z.discriminatedUnion("intent", [SaveDraft, DeleteDraft]);

export type SessionActionResult =
	| { ok: true; kind: "saved"; sid: string; savedAt: number }
	| { ok: true; kind: "deleted" }
	| {
			ok: false;
			fieldErrors?: Record<string, string>;
			formError?: string;
	  };

export async function action({ context, request, params }: Route.ActionArgs) {
	const env = context.cloudflare.env;
	const user = await requireUser(env, request);
	const bundle = await loadPublicForm(env, params.eventSlug, params.formId);
	if (!bundle) throw data("Form not found", { status: 404 });
	const { form, event } = bundle;
	const db = getDb(env);
	const parsed = ActionPayload.safeParse(await request.json());
	if (!parsed.success) {
		return data(
			{ ok: false as const, formError: "That request couldn't be read." },
			{ status: 400 },
		);
	}
	const payload = parsed.data;

	if (payload.intent === "delete-draft") {
		const initial = await loadWizardInitial(db, form, user.id, payload.sid);
		if (!initial || initial.loadedStatus !== "draft") {
			return data(
				{ ok: false as const, formError: "This draft no longer exists." },
				{ status: 404 },
			);
		}
		await db.delete(submissions).where(eq(submissions.id, payload.sid));
		track("cfp.draft_deleted", { formId: form.id });
		return { ok: true as const, kind: "deleted" as const };
	}

	if (isFormClosed(form, systemClock.now())) {
		return data(
			{
				ok: false as const,
				formError:
					"This form is no longer accepting submissions, so drafts can't be saved.",
			},
			{ status: 403 },
		);
	}

	// Draft save asks for ONE thing: a title. Required-field validation applies
	// to advancing steps and submitting, never to saving a draft.
	const title = (payload.values.b_title ?? "").trim();
	if (!title) {
		return data(
			{
				ok: false as const,
				fieldErrors: { b_title: "Add a title to save your draft." },
			},
			{ status: 400 },
		);
	}

	const definition = await resolveFormDefinition(db, form);
	const participants = normalizeSelfRows(payload.participants).filter(
		(p) =>
			p.self || (p.email.trim() && p.firstName.trim() && p.lastName.trim()),
	);

	const roleError = roleMaxError(participants, definition);
	if (roleError) {
		return data({ ok: false as const, formError: roleError }, { status: 422 });
	}

	if (!payload.sid) {
		const drafts = await listDrafts(db, form.id, user.id);
		if (!form.allowMultipleDrafts && drafts.length > 0) {
			return data(
				{
					ok: false as const,
					formError:
						"You already have a saved draft for this form — resume or delete it before starting another.",
				},
				{ status: 422 },
			);
		}
		const limit = effectiveSubmissionLimit(form, event);
		const used = await countSubmissionsUsed(db, form.id, user.id);
		if (limit !== null && used >= limit) {
			return data(
				{
					ok: false as const,
					formError: `You've reached this form's limit of ${limit} submissions (drafts count toward it). Manage your existing submissions in your speaker portal.`,
				},
				{ status: 422 },
			);
		}
	}

	const timings = createTimings();
	try {
		const result = await timings.time("db", () =>
			writeSubmission(
				db,
				{
					form,
					definition,
					user,
					wizardId: payload.wizardId,
					sid: payload.sid,
					values: payload.values,
					participants,
				},
				"draft",
			),
		);
		if (!result.ok) {
			return data(
				{ ok: false as const, formError: result.error },
				{ status: result.status ?? 400 },
			);
		}
		track("cfp.draft_saved", {
			formId: form.id,
			created: result.created,
		});
		return data(
			{
				ok: true as const,
				kind: "saved" as const,
				sid: result.submissionId,
				savedAt: Date.now(),
			},
			{ headers: { "Server-Timing": timings.header() } },
		);
	} catch (error) {
		track("cfp.draft_save_failed", {
			formId: form.id,
			error: errorMessage(error),
		});
		return data(
			{
				ok: false as const,
				formError: "Your draft couldn't be saved — please try again.",
			},
			{ status: 500 },
		);
	}
}

function roleMaxError(
	participants: Array<{ role: string }>,
	definition: FormDefinition,
): string | null {
	for (const [role, limits] of Object.entries(definition.roles)) {
		const count = participants.filter((p) => p.role === role).length;
		if (limits.max !== null && count > limits.max) {
			return `No more than ${limits.max} ${role}s are allowed.`;
		}
	}
	return null;
}

/* -------------------------------------------------------------- component --- */

export default function SessionStep({
	loaderData,
	params,
}: Route.ComponentProps) {
	const layout = useRouteLoaderData<LayoutRoute.ComponentProps["loaderData"]>(
		"routes/submit.$eventSlug.$formId",
	);
	const ctx = useOutletContext<WizardCtx>();
	const navigate = useNavigate();
	const [searchParams] = useSearchParams();
	const saveFetcher = useFetcher<SessionActionResult>();
	const [errors, setErrors] = useState<Record<string, string>>({});

	const base = submitBasePath(params.eventSlug, params.formId);
	const { mode, definition, initial, selfContact, readOnly } = loaderData;
	const startNew = searchParams.has("new");

	// Last saved: the fresh save wins over the resumed draft's timestamp.
	const savedAt =
		saveFetcher.data?.ok && saveFetcher.data.kind === "saved"
			? saveFetcher.data.savedAt
			: initial && initial.loadedStatus === "draft"
				? initial.updatedAt
				: null;

	// Render-time seed so the form paints on the SERVER render too (resumes
	// show their content immediately); the shared wizard context adopts it on
	// mount and carries edits across steps.
	const seeded = useMemo<WizardState>(() => {
		if (initial) {
			return {
				wizardId: initial.sid,
				sid: initial.sid,
				loadedStatus: initial.loadedStatus,
				values: initial.values,
				participants:
					initial.participants.length > 0
						? initial.participants
						: newWizardState(selfContact).participants,
			};
		}
		return newWizardState(selfContact);
	}, [initial, selfContact]);

	// The context's state wins unless the URL points at a DIFFERENT submission
	// (resume/edit/new) — then the seed replaces it.
	const ctxMatchesTarget =
		ctx.state !== null &&
		(initial ? ctx.state.sid === initial.sid : !(startNew && ctx.state.sid));
	const state: WizardState =
		ctxMatchesTarget && ctx.state !== null ? ctx.state : seeded;

	// Adopt the rendered state into the shared context — never clobber values
	// the user is mid-typing (ctxMatchesTarget keeps their state).
	useEffect(() => {
		if (mode !== "form") return;
		if (!ctxMatchesTarget) ctx.setState(seeded);
	}, [mode, ctxMatchesTarget, seeded, ctx]);

	// A successful draft save mints the row — reflect its id in state + URL so
	// a reload resumes instead of forking a second draft.
	useEffect(() => {
		const result = saveFetcher.data;
		if (!result || !result.ok || result.kind !== "saved") return;
		if (ctx.state && ctx.state.sid !== result.sid) {
			ctx.setState({
				...ctx.state,
				sid: result.sid,
				loadedStatus: "draft",
			});
			navigate(`${base}/step/session?sid=${result.sid}`, {
				replace: true,
				preventScrollReset: true,
			});
		}
	}, [saveFetcher.data, ctx, navigate, base]);

	if (!layout) return null;

	if (mode === "closed") return null;

	if (mode === "blocked") {
		return (
			<Panel>
				<EmptyState
					icon="inbox"
					title="You've reached the submission limit"
					body={`This form allows ${loaderData.limit} submission${loaderData.limit === 1 ? "" : "s"} per user, and you've used ${loaderData.used} (drafts count too). You can review and manage your existing submissions from your speaker portal.`}
					action={
						layout.portalPath ? (
							<AnchorTextLink href={layout.portalPath}>
								Go to your speaker portal
							</AnchorTextLink>
						) : undefined
					}
				/>
			</Panel>
		);
	}

	if (mode === "hub") {
		return (
			<DraftsHub
				base={base}
				drafts={loaderData.drafts}
				actionPath={`${base}/step/session`}
				limitReached={loaderData.limitReached}
				limit={loaderData.limit}
				portalPath={layout.portalPath}
			/>
		);
	}

	if (readOnly) {
		return (
			<div className="flex flex-col gap-4">
				<InfoNotice>
					This form is closed, so editing is no longer available. Your
					submission is shown below — contact the event team if you need a
					change.
				</InfoNotice>
				<Panel>
					<div className="flex flex-col gap-5">
						<SummarySection title="Submission">
							<AnswersSummary
								fields={definition.session}
								values={state.values}
							/>
						</SummarySection>
						<SummarySection title="Participants">
							<ParticipantsSummary participants={state.participants} />
						</SummarySection>
					</div>
				</Panel>
			</div>
		);
	}

	const setValue = (key: string, value: string) => {
		ctx.setState((s) =>
			s ? { ...s, values: { ...s.values, [key]: value } } : s,
		);
		setErrors((e) => {
			if (!e[key]) return e;
			const next = { ...e };
			delete next[key];
			return next;
		});
	};

	const advance = () => {
		const errs = validateSection(definition.session, state.values);
		setErrors(errs);
		if (Object.keys(errs).length > 0) return;
		navigate(
			stepPath(
				base,
				layout.form.participantsStep ? "participant" : "review",
				state.sid,
			),
		);
	};

	const saveDraft = () => {
		const title = (state.values.b_title ?? "").trim();
		if (!title) {
			setErrors((e) => ({
				...e,
				b_title: "Add a title to save your draft.",
			}));
			return;
		}
		saveFetcher.submit(wizardPayload("save-draft", state), {
			method: "post",
			encType: "application/json",
			action: `${base}/step/session`,
		});
	};

	const saveResult = saveFetcher.data;
	const editingSubmitted =
		state.loadedStatus !== undefined && state.loadedStatus !== "draft";

	return (
		<div className="flex flex-col gap-4">
			{editingSubmitted && (
				<InfoNotice>
					You’re editing a submitted proposal. Changes take effect when you save
					them from the Review step, and editing stays open until the form’s
					close date.
				</InfoNotice>
			)}
			{state.loadedStatus === "draft" && savedAt !== null && (
				<InfoNotice>
					You are editing your draft. Last saved{" "}
					{new Date(savedAt).toLocaleString()}.
				</InfoNotice>
			)}
			<Panel>
				<div className="flex flex-col gap-4">
					<PageTitle>{loaderData.sectionTitle}</PageTitle>
					{loaderData.sectionHtml ? (
						<HtmlContent html={loaderData.sectionHtml} />
					) : (
						<LeadText>
							What do you want to present? Fill out the following information to
							tell us more.
						</LeadText>
					)}
					<SectionFields
						fields={definition.session}
						values={state.values}
						errors={errors}
						onChange={setValue}
					/>
				</div>
			</Panel>
			{saveResult && !saveResult.ok && saveResult.formError && (
				<ErrorText>{saveResult.formError}</ErrorText>
			)}
			<div className="flex flex-wrap items-center justify-between gap-3">
				<ButtonLink to={base} variant="ghost">
					← Back
				</ButtonLink>
				<div className="flex flex-wrap items-center gap-3">
					{!editingSubmitted && (
						<Button
							variant="ghost"
							type="button"
							disabled={saveFetcher.state !== "idle"}
							onClick={saveDraft}
						>
							{saveFetcher.state !== "idle" ? "Saving…" : "Save as draft"}
						</Button>
					)}
					<Button type="button" onClick={advance}>
						{layout.form.participantsStep
							? "Next step →"
							: "Continue to review →"}
					</Button>
				</div>
			</div>
		</div>
	);
}

function DraftsHub({
	base,
	drafts,
	actionPath,
	limitReached,
	limit,
	portalPath,
}: {
	base: string;
	drafts: Array<{ id: string; title: string; updatedAt: number }>;
	actionPath: string;
	limitReached: boolean;
	limit: number | null;
	portalPath: string | null;
}) {
	const deleteFetcher = useFetcher<SessionActionResult>();
	const [confirming, setConfirming] = useState<string | null>(null);

	return (
		<Panel>
			<div className="flex flex-col gap-4">
				<PageTitle>Your submissions for this form</PageTitle>
				<LeadText>
					{limitReached
						? "Resume a saved draft below. You've reached this form's submission limit, so new submissions can't be started."
						: "Resume a saved draft, or start a new submission from scratch."}
				</LeadText>
				<ul className="flex flex-col gap-3">
					{drafts.map((draft) => (
						<li
							key={draft.id}
							className="flex flex-wrap items-center justify-between gap-3"
						>
							<div className="flex min-w-0 flex-col gap-[3px]">
								<RowTitle>{draft.title}</RowTitle>
								<span className="flex items-center gap-2">
									<StatusBadge tone="faint">Draft — not submitted</StatusBadge>
									<MutedText>
										Last updated {new Date(draft.updatedAt).toLocaleString()}
									</MutedText>
								</span>
							</div>
							<div className="flex items-center gap-2">
								<ButtonLink to={`${base}/step/session?sid=${draft.id}`}>
									Resume draft
								</ButtonLink>
								<Button
									variant="ghost"
									type="button"
									onClick={() => setConfirming(draft.id)}
								>
									Delete
								</Button>
							</div>
						</li>
					))}
				</ul>
				{deleteFetcher.data && !deleteFetcher.data.ok && (
					<ErrorText>{deleteFetcher.data.formError}</ErrorText>
				)}
				{limitReached ? (
					<MutedText>
						This form allows {limit} submission{limit === 1 ? "" : "s"} per
						user, and drafts count toward the limit.{" "}
						{portalPath ? (
							<AnchorTextLink href={portalPath}>
								Manage your submissions in your speaker portal
							</AnchorTextLink>
						) : null}
					</MutedText>
				) : (
					<div>
						<ButtonLink to={`${base}/step/session?new=1`} variant="ghost">
							Start new submission
						</ButtonLink>
					</div>
				)}
			</div>
			<ConfirmDialog
				open={confirming !== null}
				title="Delete this draft?"
				body="This permanently deletes your saved draft — it can't be undone."
				onCancel={() => setConfirming(null)}
				confirm={
					<Button
						type="button"
						onClick={() => {
							if (confirming) {
								deleteFetcher.submit(
									{ intent: "delete-draft", sid: confirming },
									{
										method: "post",
										encType: "application/json",
										action: actionPath,
									},
								);
							}
							setConfirming(null);
						}}
					>
						Delete draft
					</Button>
				}
			/>
		</Panel>
	);
}
