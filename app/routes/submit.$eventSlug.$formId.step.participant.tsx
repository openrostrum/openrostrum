// @public route family — loader gates with getUser and redirects to the
// account step when logged out.
import { useState } from "react";
import {
	data,
	redirect,
	useFetcher,
	useNavigate,
	useOutletContext,
	useRouteLoaderData,
} from "react-router";
import {
	isEditingSubmitted,
	isValidEmail,
	type ParticipantErrors,
	participantExtraFields,
	participantRequirements,
	type ParticipantRole,
	ROLE_LABELS,
	roleCountLabel,
	validateParticipants,
	validateSection,
	type WizardParticipant,
} from "~/cfp/definition";
import { SectionFields } from "~/cfp/fields";
import {
	isFormClosed,
	loadPublicForm,
	loadSelfContact,
	resolveFormDefinition,
} from "~/cfp/server";
import {
	HtmlContent,
	InfoNotice,
	LeadText,
	MutedText,
	PageTitle,
	RichText,
	SectionHeading,
} from "~/cfp/ui";
import { stepPath, type WizardCtx, wizardPayload } from "~/cfp/wizard";
import { getDb } from "~/db";
import { submitPath } from "~/domain/forms";
import { getUser } from "~/lib/auth";
import { useBusy } from "~/lib/use-busy";
import { systemClock } from "~/ports/clock";
import { Button, ButtonLink, ErrorText, Field, Input, Panel } from "~/ui";
import type { SessionActionResult } from "./submit.$eventSlug.$formId.step.session";
import type { Route } from "./+types/submit.$eventSlug.$formId.step.participant";
import type { Route as LayoutRoute } from "./+types/submit.$eventSlug.$formId";

export async function loader({ context, request, params }: Route.LoaderArgs) {
	const env = context.cloudflare.env;
	const base = submitPath(params.eventSlug, params.formId);
	const url = new URL(request.url);
	const user = await getUser(env, request);
	if (!user) throw redirect(`${base}/step/account${url.search}`);
	const bundle = await loadPublicForm(env, params.eventSlug, params.formId);
	if (!bundle) throw data("Form not found", { status: 404 });
	const { form, event } = bundle;
	if (!form.participantsStep) {
		throw redirect(
			stepPath(base, "review", url.searchParams.get("sid") ?? undefined),
		);
	}
	const db = getDb(env);
	const definition = await resolveFormDefinition(db, form);
	const selfContact = await loadSelfContact(db, event.id, user);
	return {
		definition,
		selfContact,
		closed: isFormClosed(form, systemClock.now()),
		sectionTitle: form.participantSectionTitle || "Tell us about you",
		sectionHtml: form.participantSectionHtml,
	};
}

export default function ParticipantStep({
	loaderData,
	params,
}: Route.ComponentProps) {
	const layout = useRouteLoaderData<LayoutRoute.ComponentProps["loaderData"]>(
		"routes/submit.$eventSlug.$formId",
	);
	const ctx = useOutletContext<WizardCtx>();
	const navigate = useNavigate();
	const saveFetcher = useFetcher<SessionActionResult>();
	const busy = useBusy();
	const [errors, setErrors] = useState<ParticipantErrors>({
		rows: {},
		form: [],
	});
	const [extraErrors, setExtraErrors] = useState<Record<string, string>>({});

	const base = submitPath(params.eventSlug, params.formId);
	const { definition } = loaderData;
	const state = ctx.state;

	if (!layout) return null;
	if (!state) {
		// Deep link before any wizard state exists — start from the beginning.
		return (
			<InfoNotice>
				Start your submission from the{" "}
				<ButtonLink to={stepPath(base, "session")} variant="ghost">
					Submission step
				</ButtonLink>
			</InfoNotice>
		);
	}

	const extraFields = participantExtraFields(definition.participant);
	const showPhone = definition.participant.some(
		(f) => f.builtinRef === "mobile_phone",
	);
	const showBio = definition.participant.some(
		(f) => f.builtinRef === "biography",
	);
	const requirements = participantRequirements(definition.participant);

	const roles = definition.roles;
	const speakerLimits = roles.speaker ?? { min: 1, max: null };
	const speakerCount = state.participants.filter(
		(p) => p.role === "speaker",
	).length;
	const addableRoles = (Object.keys(roles) as ParticipantRole[]).filter(
		(role) => {
			const limits = roles[role];
			if (!limits) return false;
			const count = state.participants.filter((p) => p.role === role).length;
			return limits.max === null || count < limits.max;
		},
	);

	const updateRow = (key: string, patch: Partial<WizardParticipant>) => {
		ctx.setState((s) =>
			s
				? {
						...s,
						participants: s.participants.map((p) =>
							p.key === key ? { ...p, ...patch } : p,
						),
					}
				: s,
		);
	};
	const removeRow = (key: string) => {
		ctx.setState((s) =>
			s
				? { ...s, participants: s.participants.filter((p) => p.key !== key) }
				: s,
		);
	};
	const addRow = (role: ParticipantRole) => {
		ctx.setState((s) =>
			s
				? {
						...s,
						participants: [
							...s.participants,
							{
								key: crypto.randomUUID(),
								role,
								firstName: "",
								lastName: "",
								email: "",
								mobilePhone: "",
								bio: "",
							},
						],
					}
				: s,
		);
	};

	const blurValidateEmail = (p: WizardParticipant) => {
		if (p.email.trim() && !isValidEmail(p.email)) {
			setErrors((e) => ({
				...e,
				rows: {
					...e.rows,
					[p.key]: { ...e.rows[p.key], email: "Enter a valid email address." },
				},
			}));
		} else {
			setErrors((e) => {
				const next = { ...e.rows[p.key] };
				delete next.email;
				return { ...e, rows: { ...e.rows, [p.key]: next } };
			});
		}
	};

	const continueToReview = () => {
		const participantErrors = validateParticipants(
			state.participants,
			roles,
			requirements,
		);
		const extra = validateSection(extraFields, state.values);
		setErrors(participantErrors);
		setExtraErrors(extra);
		if (
			participantErrors.form.length > 0 ||
			Object.keys(participantErrors.rows).length > 0 ||
			Object.keys(extra).length > 0
		) {
			return;
		}
		navigate(stepPath(base, "review", state.sid));
	};

	const saveDraft = () => {
		if (!(state.values.b_title ?? "").trim()) {
			setErrors((e) => ({
				...e,
				form: ["Add a title on the Submission step to save your draft."],
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
	const editingSubmitted = isEditingSubmitted(state);

	return (
		<div className="flex flex-col gap-4">
			<Panel>
				<div className="flex flex-col gap-4">
					<PageTitle>{loaderData.sectionTitle}</PageTitle>
					{loaderData.sectionHtml ? (
						<HtmlContent html={loaderData.sectionHtml} />
					) : (
						<LeadText>
							Who’s presenting? Add each speaker below — you can also add a
							secondary contact to help with tasks and communication.
						</LeadText>
					)}
					<InfoNotice>
						{roleCountLabel(speakerLimits, speakerCount)}
						{roles.chairperson &&
							` · ${roleCountLabel(roles.chairperson, state.participants.filter((p) => p.role === "chairperson").length, "Chairpersons")}`}
						{roles.moderator &&
							` · ${roleCountLabel(roles.moderator, state.participants.filter((p) => p.role === "moderator").length, "Moderators")}`}
					</InfoNotice>

					{state.participants.map((p) => (
						<div key={p.key} className="flex flex-col gap-3">
							<div className="flex items-center justify-between gap-3">
								<SectionHeading
									title={
										p.self
											? `${ROLE_LABELS[p.role]} — you`
											: p.firstName || p.lastName
												? `${ROLE_LABELS[p.role]} — ${`${p.firstName} ${p.lastName}`.trim()}`
												: ROLE_LABELS[p.role]
									}
								/>
								{!p.self && (
									<Button
										variant="ghost"
										type="button"
										onClick={() => removeRow(p.key)}
									>
										Remove
									</Button>
								)}
							</div>
							<div className="grid gap-4 sm:grid-cols-2">
								<Field
									label="First Name *"
									error={errors.rows[p.key]?.firstName}
								>
									<Input
										value={p.firstName}
										maxLength={255}
										autoComplete="off"
										invalid={Boolean(errors.rows[p.key]?.firstName)}
										onChange={(e) =>
											updateRow(p.key, { firstName: e.target.value })
										}
									/>
								</Field>
								<Field label="Last Name *" error={errors.rows[p.key]?.lastName}>
									<Input
										value={p.lastName}
										maxLength={255}
										autoComplete="off"
										invalid={Boolean(errors.rows[p.key]?.lastName)}
										onChange={(e) =>
											updateRow(p.key, { lastName: e.target.value })
										}
									/>
								</Field>
							</div>
							<Field label="Email *" error={errors.rows[p.key]?.email}>
								<Input
									type="email"
									value={p.email}
									disabled={p.self}
									autoComplete="off"
									invalid={Boolean(errors.rows[p.key]?.email)}
									onChange={(e) => updateRow(p.key, { email: e.target.value })}
									onBlur={() => blurValidateEmail(p)}
								/>
							</Field>
							{p.self && (
								<MutedText>
									Your email comes from your account — log out to submit as
									someone else.
								</MutedText>
							)}
							{p.role !== "secondary" && showPhone && (
								<Field
									label={
										requirements.mobilePhone ? "Mobile Phone *" : "Mobile Phone"
									}
									error={errors.rows[p.key]?.mobilePhone}
								>
									<Input
										type="tel"
										value={p.mobilePhone}
										placeholder="+1 415 555 0142"
										invalid={Boolean(errors.rows[p.key]?.mobilePhone)}
										onChange={(e) =>
											updateRow(p.key, { mobilePhone: e.target.value })
										}
									/>
								</Field>
							)}
							{p.role !== "secondary" && showBio && (
								<Field
									label={requirements.bio ? "Biography *" : "Biography"}
									error={errors.rows[p.key]?.bio}
								>
									<RichText
										value={p.bio}
										compact
										placeholder="Tell us a bit about yourself"
										invalid={Boolean(errors.rows[p.key]?.bio)}
										onChange={(html) => updateRow(p.key, { bio: html })}
									/>
								</Field>
							)}
						</div>
					))}

					<div className="flex flex-wrap items-center gap-3">
						{addableRoles.map((role) => (
							<Button
								key={role}
								variant="ghost"
								type="button"
								icon="plus"
								onClick={() => addRow(role)}
							>
								Add {ROLE_LABELS[role]}
							</Button>
						))}
						{addableRoles.length === 0 && (
							<MutedText>
								The maximum number of participants has been reached — remove
								someone to add another.
							</MutedText>
						)}
					</div>
					<div className="flex flex-col gap-1">
						<Button
							variant="ghost"
							type="button"
							icon="plus"
							onClick={() => addRow("secondary")}
						>
							Add Secondary Contact
						</Button>
						<MutedText>
							Secondary contacts can assist with tasks and communication.
						</MutedText>
					</div>

					{extraFields.length > 0 && (
						<SectionFields
							fields={extraFields}
							values={state.values}
							errors={extraErrors}
							onChange={(key, value) =>
								ctx.setState((s) =>
									s ? { ...s, values: { ...s.values, [key]: value } } : s,
								)
							}
						/>
					)}
				</div>
			</Panel>

			{errors.form.map((message) => (
				<ErrorText key={message}>{message}</ErrorText>
			))}
			{saveResult && !saveResult.ok && saveResult.formError && (
				<ErrorText>{saveResult.formError}</ErrorText>
			)}

			<div className="flex flex-wrap items-center justify-between gap-3">
				<ButtonLink to={stepPath(base, "session", state.sid)} variant="ghost">
					← Back
				</ButtonLink>
				<div className="flex flex-wrap items-center gap-3">
					{!editingSubmitted && (
						<Button
							variant="ghost"
							type="button"
							disabled={busy}
							onClick={saveDraft}
						>
							{saveFetcher.state !== "idle" ? "Saving…" : "Save as draft"}
						</Button>
					)}
					<Button type="button" disabled={busy} onClick={continueToReview}>
						Continue to review →
					</Button>
				</div>
			</div>
		</div>
	);
}
