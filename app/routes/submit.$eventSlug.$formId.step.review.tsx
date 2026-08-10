// @public route family — loader gates with getUser; the submit action
// requires a signed-in speaker and re-validates everything server-side.
import {
	data,
	redirect,
	useNavigation,
	useOutletContext,
	useRouteLoaderData,
	useSubmit,
} from "react-router";
import { z } from "zod";
import {
	validateParticipants,
	validateSection,
	type WizardParticipant,
} from "~/cfp/definition";
import { normalizeSelfRows, WizardPayload } from "~/cfp/payload";
import {
	countSubmissionsUsed,
	effectiveSubmissionLimit,
	isFormClosed,
	loadPortalPath,
	loadPublicForm,
	loadSelfContact,
	resolveFormDefinition,
	sendConfirmationEmail,
	writeSubmission,
} from "~/cfp/server";
import {
	AnswersSummary,
	ParticipantsSummary,
	SummarySection,
} from "~/cfp/summary";
import { InfoNotice, LeadText, PageTitle } from "~/cfp/ui";
import {
	selfParticipant,
	stepPath,
	submitBasePath,
	type WizardCtx,
	wizardPayload,
} from "~/cfp/wizard";
import { getDb } from "~/db";
import { getUser, requireUser } from "~/lib/auth";
import { errorMessage } from "~/lib/errors";
import { createTimings, track } from "~/lib/track";
import { systemClock } from "~/ports/clock";
import { Button, ButtonLink, ErrorText, Panel, TextLink } from "~/ui";
import type { Route } from "./+types/submit.$eventSlug.$formId.step.review";
import type { Route as LayoutRoute } from "./+types/submit.$eventSlug.$formId";

export function headers({ loaderHeaders }: Route.HeadersArgs) {
	return loaderHeaders;
}

export async function loader({ context, request, params }: Route.LoaderArgs) {
	const env = context.cloudflare.env;
	const base = submitBasePath(params.eventSlug, params.formId);
	const url = new URL(request.url);
	const user = await getUser(env, request);
	if (!user) throw redirect(`${base}/step/account${url.search}`);
	const bundle = await loadPublicForm(env, params.eventSlug, params.formId);
	if (!bundle) throw data("Form not found", { status: 404 });
	const definition = await resolveFormDefinition(getDb(env), bundle.form);
	return { definition };
}

const SubmitPayload = z.object({
	intent: z.literal("submit"),
	...WizardPayload.shape,
});

type SubmitResult = {
	ok: false;
	formError?: string;
	fieldErrors?: Record<string, string>;
	participantErrors?: string[];
};

export async function action({ context, request, params }: Route.ActionArgs) {
	const env = context.cloudflare.env;
	const user = await requireUser(env, request);
	const bundle = await loadPublicForm(env, params.eventSlug, params.formId);
	if (!bundle) throw data("Form not found", { status: 404 });
	const { form, event } = bundle;
	const db = getDb(env);
	const base = submitBasePath(params.eventSlug, params.formId);

	if (isFormClosed(form, systemClock.now())) {
		track("cfp.submit_blocked_closed", { formId: form.id });
		return data(
			{
				ok: false,
				formError: "This form is no longer accepting submissions.",
			} satisfies SubmitResult,
			{ status: 403 },
		);
	}

	const parsed = SubmitPayload.safeParse(await request.json());
	if (!parsed.success) {
		return data(
			{
				ok: false,
				formError: "That request couldn't be read.",
			} satisfies SubmitResult,
			{ status: 400 },
		);
	}

	const definition = await resolveFormDefinition(db, form);
	const selfContact = await loadSelfContact(db, event.id, user);

	let participantRows: WizardParticipant[];
	if (form.participantsStep) {
		participantRows = normalizeSelfRows(parsed.data.participants);
		if (!participantRows.some((p) => p.self)) {
			participantRows = [selfParticipant(selfContact), ...participantRows];
		}
	} else {
		// No participant step on this form — the submitter is the sole speaker.
		participantRows = [selfParticipant(selfContact)];
	}
	// The self row's identity comes from the ACCOUNT, whatever the client sent.
	participantRows = participantRows.map((p) =>
		p.self
			? {
					...p,
					email: user.email,
					firstName: p.firstName.trim() || selfContact.firstName,
					lastName: p.lastName.trim() || selfContact.lastName,
				}
			: p,
	);

	const phoneRequired =
		definition.participant.find((f) => f.builtinRef === "mobile_phone")
			?.required ?? false;
	const bioRequired =
		definition.participant.find((f) => f.builtinRef === "biography")
			?.required ?? false;

	const fieldErrors = validateSection(definition.session, parsed.data.values);
	const participantErrors = form.participantsStep
		? validateParticipants(participantRows, definition.roles, {
				mobilePhone: phoneRequired,
				bio: bioRequired,
			})
		: { rows: {}, form: [] };

	if (
		Object.keys(fieldErrors).length > 0 ||
		participantErrors.form.length > 0 ||
		Object.keys(participantErrors.rows).length > 0
	) {
		const rowMessages = Object.values(participantErrors.rows).flatMap((row) =>
			Object.values(row).filter((m): m is string => Boolean(m)),
		);
		return data(
			{
				ok: false,
				fieldErrors,
				participantErrors: [...participantErrors.form, ...rowMessages],
			} satisfies SubmitResult,
			{ status: 422 },
		);
	}

	// Limit check applies to NEW submissions only — an existing draft already
	// occupies its slot, and edits of a submitted proposal replace in place.
	if (!parsed.data.sid) {
		const limit = effectiveSubmissionLimit(form, event);
		if (limit !== null) {
			const used = await countSubmissionsUsed(db, form.id, user.id);
			if (used >= limit) {
				track("cfp.submit_blocked_limit", { formId: form.id, used, limit });
				return data(
					{
						ok: false,
						formError: `You've reached this form's limit of ${limit} submissions per user. You can manage your existing submissions in your speaker portal.`,
					} satisfies SubmitResult,
					{ status: 422 },
				);
			}
		}
	}

	const timings = createTimings();
	let result: Awaited<ReturnType<typeof writeSubmission>>;
	try {
		result = await timings.time("db", () =>
			writeSubmission(
				db,
				{
					form,
					definition,
					user,
					wizardId: parsed.data.wizardId,
					sid: parsed.data.sid,
					values: parsed.data.values,
					participants: participantRows,
				},
				"submit",
			),
		);
	} catch (error) {
		track("cfp.submit_failed", { formId: form.id, error: errorMessage(error) });
		return data(
			{
				ok: false,
				formError:
					"Your submission couldn't be saved — nothing was lost, please try again.",
			} satisfies SubmitResult,
			{ status: 500 },
		);
	}
	if (!result.ok) {
		return data({ ok: false, formError: result.error } satisfies SubmitResult, {
			status: result.status ?? 400,
		});
	}

	const becamePending = result.created || result.previousStatus === "draft";
	const editedSubmitted = !becamePending;

	if (becamePending && form.sendConfirmationEmail) {
		const origin = new URL(request.url).origin;
		const portalPath = await loadPortalPath(db, event.id, event.slug);
		try {
			await sendConfirmationEmail(env, {
				event,
				form,
				submissionId: result.submissionId,
				submissionTitle: (parsed.data.values.b_title ?? "").trim(),
				to: user.email,
				firstName:
					participantRows.find((p) => p.self)?.firstName ||
					selfContact.firstName,
				portalUrl: `${origin}${portalPath ?? "/login"}`,
			});
			track("cfp.confirmation_email_sent", { formId: form.id });
		} catch (error) {
			// The submission is safely stored — a provider hiccup must not turn
			// success into an error page. The failure is logged for the outbox.
			track("cfp.confirmation_email_failed", {
				formId: form.id,
				error: errorMessage(error),
			});
		}
	}

	track("cfp.submitted", {
		formId: form.id,
		submissionId: result.submissionId,
		created: result.created,
		edited: editedSubmitted,
	});

	return redirect(
		`${stepPath(base, "success")}?sid=${result.submissionId}${editedSubmitted ? "&updated=1" : ""}`,
		{ headers: { "Server-Timing": timings.header() } },
	);
}

export default function ReviewStep({
	loaderData,
	actionData,
	params,
}: Route.ComponentProps) {
	const layout = useRouteLoaderData<LayoutRoute.ComponentProps["loaderData"]>(
		"routes/submit.$eventSlug.$formId",
	);
	const ctx = useOutletContext<WizardCtx>();
	const submit = useSubmit();
	const navigation = useNavigation();
	const base = submitBasePath(params.eventSlug, params.formId);
	const state = ctx.state;
	const result = actionData as SubmitResult | undefined;

	if (!layout) return null;
	if (!state) {
		return (
			<InfoNotice>
				Nothing to review yet — start from the{" "}
				<TextLink to={stepPath(base, "session")}>Submission step</TextLink>.
			</InfoNotice>
		);
	}

	const editingSubmitted =
		state.loadedStatus !== undefined && state.loadedStatus !== "draft";
	const busy = navigation.state !== "idle";

	const doSubmit = () => {
		submit(wizardPayload("submit", state), {
			method: "post",
			encType: "application/json",
			action: `${base}/step/review`,
		});
	};

	return (
		<div className="flex flex-col gap-4">
			<Panel>
				<div className="flex flex-col gap-5">
					<div className="flex flex-col gap-1">
						<PageTitle>Review your submission</PageTitle>
						<LeadText>
							Check that everything looks correct. You can go back to make
							changes before {editingSubmitted ? "saving" : "submitting"}.
						</LeadText>
					</div>
					<SummarySection title="Submission">
						<AnswersSummary
							fields={loaderData.definition.session}
							values={state.values}
						/>
					</SummarySection>
					{layout.form.participantsStep && (
						<SummarySection title="Participants">
							<ParticipantsSummary participants={state.participants} />
						</SummarySection>
					)}
				</div>
			</Panel>

			{result && !result.ok && (
				<div className="flex flex-col gap-2">
					{result.formError && <ErrorText>{result.formError}</ErrorText>}
					{result.fieldErrors && Object.keys(result.fieldErrors).length > 0 && (
						<ErrorText>
							Some submission details need attention:{" "}
							{Object.values(result.fieldErrors).join(" · ")} —{" "}
							<TextLink to={stepPath(base, "session", state.sid)}>
								edit the submission step
							</TextLink>
						</ErrorText>
					)}
					{result.participantErrors && result.participantErrors.length > 0 && (
						<ErrorText>
							Participant details need attention:{" "}
							{result.participantErrors.join(" · ")} —{" "}
							<TextLink to={stepPath(base, "participant", state.sid)}>
								edit the participant step
							</TextLink>
						</ErrorText>
					)}
				</div>
			)}

			<div className="flex flex-wrap items-center justify-between gap-3">
				<ButtonLink
					to={stepPath(
						base,
						layout.form.participantsStep ? "participant" : "session",
						state.sid,
					)}
					variant="ghost"
				>
					← Back
				</ButtonLink>
				<Button type="button" disabled={busy} onClick={doSubmit}>
					{busy ? "Submitting…" : editingSubmitted ? "Save changes" : "Submit"}
				</Button>
			</div>
		</div>
	);
}
