// @public route family — loader requires the signed-in owner of the submission.
import { useEffect } from "react";
import {
	data,
	redirect,
	useOutletContext,
	useSearchParams,
} from "react-router";
import { eq } from "drizzle-orm";
import { isFormClosed, loadPortalPath, loadPublicForm } from "~/cfp/server";
import {
	AnchorButton,
	CenteredStack,
	HtmlContent,
	LeadText,
	MutedText,
	PageTitle,
	SuccessMark,
} from "~/cfp/ui";
import { submitBasePath, type WizardCtx } from "~/cfp/wizard";
import { getDb } from "~/db";
import { submissions } from "~/db/schema";
import { getUser } from "~/lib/auth";
import { systemClock } from "~/ports/clock";
import { Panel, TextLink } from "~/ui";
import type { Route } from "./+types/submit.$eventSlug.$formId.step.success";

export async function loader({ context, request, params }: Route.LoaderArgs) {
	const env = context.cloudflare.env;
	const base = submitBasePath(params.eventSlug, params.formId);
	const url = new URL(request.url);
	const user = await getUser(env, request);
	if (!user) throw redirect(`${base}/step/account${url.search}`);
	const bundle = await loadPublicForm(env, params.eventSlug, params.formId);
	if (!bundle) throw data("Form not found", { status: 404 });
	const { form, event } = bundle;
	const db = getDb(env);

	const sid = url.searchParams.get("sid");
	if (!sid) throw redirect(base);
	const [row] = await db
		.select({
			id: submissions.id,
			title: submissions.title,
			status: submissions.status,
			submitterId: submissions.submitterId,
		})
		.from(submissions)
		.where(eq(submissions.id, sid))
		.limit(1);
	if (!row || row.submitterId !== user.id) {
		throw data("Submission not found", { status: 404 });
	}
	if (row.status === "draft") {
		throw redirect(`${base}/step/session?sid=${sid}`);
	}

	const portalPath = await loadPortalPath(db, event.id, event.slug);
	return {
		title: row.title,
		successHtml: form.successHtml,
		autoRedirect: form.autoRedirect && !isFormClosed(form, systemClock.now()),
		portalPath,
		base,
	};
}

export default function SuccessStep({ loaderData }: Route.ComponentProps) {
	const ctx = useOutletContext<WizardCtx>();
	const [searchParams] = useSearchParams();
	const updated = searchParams.has("updated");
	const { successHtml, autoRedirect, portalPath, base, title } = loaderData;

	// The wizard is complete — clear its state so "submit another" starts clean.
	const reset = ctx.reset;
	useEffect(() => {
		reset();
	}, [reset]);

	// Hands-free: after ~10 seconds the speaker lands in their portal without
	// touching anything (organizer-configurable per form).
	useEffect(() => {
		if (updated || !autoRedirect || !portalPath) return;
		const timer = window.setTimeout(() => {
			window.location.assign(portalPath);
		}, 10_000);
		return () => window.clearTimeout(timer);
	}, [updated, autoRedirect, portalPath]);

	return (
		<Panel>
			<CenteredStack>
				<SuccessMark />
				{updated ? (
					<>
						<PageTitle>Your changes have been saved</PageTitle>
						<LeadText>
							“{title}” has been updated — the event team sees the latest
							version. You can keep editing until the form’s close date.
						</LeadText>
					</>
				) : successHtml ? (
					<HtmlContent html={successHtml} />
				) : (
					<>
						<PageTitle>
							Thank you for submitting to present at our event!
						</PageTitle>
						<LeadText>
							You will receive a confirmation email shortly with a link to your
							speaker portal, where you can track your submission’s status and
							complete any tasks. We review submissions on a rolling basis and
							will notify you about your status.
						</LeadText>
					</>
				)}
				{!updated && (
					<MutedText>
						If you would like to submit another session,{" "}
						<TextLink to={base}>click here</TextLink> to return to the
						submission form.
					</MutedText>
				)}
				{portalPath && (
					<div className="flex flex-col items-center gap-2 pt-1">
						<AnchorButton href={portalPath}>Continue to portal →</AnchorButton>
						{!updated && autoRedirect && (
							<MutedText>
								You’ll be taken to your speaker portal automatically in about 10
								seconds.
							</MutedText>
						)}
					</div>
				)}
			</CenteredStack>
		</Panel>
	);
}
