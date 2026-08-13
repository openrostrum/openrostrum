// @public — the shareable CFP form URL; anyone with the link sees the wizard.
import { useCallback, useState } from "react";
import { data, Outlet, useFetcher, useLocation } from "react-router";
import type { WizardState } from "~/cfp/definition";
import {
	closeBannerText,
	effectiveSubmissionLimit,
	isFormClosed,
	loadPortalPath,
	loadPublicForm,
} from "~/cfp/server";
import {
	AnchorTextLink,
	FootNote,
	LinkishButton,
	NoticeBanner,
	type StepDescriptor,
	StepRail,
	WizardChrome,
} from "~/cfp/ui";
import { stepPath, type WizardCtx } from "~/cfp/wizard";
import { getDb } from "~/db";
import { publicFormTitle, submitPath } from "~/domain/forms";
import { getUser } from "~/lib/auth";
import { useBusy } from "~/lib/use-busy";
import { systemClock } from "~/ports/clock";
import { createTimings } from "~/lib/track";
import { EmptyState, Panel } from "~/ui";
import type { Route } from "./+types/submit.$eventSlug.$formId";

export function headers({ loaderHeaders }: Route.HeadersArgs) {
	return loaderHeaders;
}

export function meta({ data: loaderData }: Route.MetaArgs) {
	return [
		{
			title: loaderData
				? `${loaderData.form.externalTitle} — ${loaderData.event.name}`
				: "Form not found",
		},
	];
}

export async function loader({ context, request, params }: Route.LoaderArgs) {
	const env = context.cloudflare.env;
	const timings = createTimings();
	const bundle = await timings.time("db", () =>
		loadPublicForm(env, params.eventSlug, params.formId),
	);
	if (!bundle || bundle.form.status === "draft") {
		throw data("Form not found", { status: 404 });
	}
	const { form, event } = bundle;
	const user = await getUser(env, request);
	const portalPath = await loadPortalPath(getDb(env), event.id, event.slug);
	const closed = isFormClosed(form, systemClock.now());
	return data(
		{
			event: { name: event.name, slug: event.slug, timezone: event.timezone },
			form: {
				publicId: form.publicId,
				externalTitle: publicFormTitle(form, event),
				pageHeading: form.pageHeading,
				welcomeHtml: form.showWelcome ? form.welcomeHtml : null,
				participantsStep: form.participantsStep,
				autoRedirect: form.autoRedirect,
			},
			closed,
			closeBanner: closed ? null : closeBannerText(form, event.timezone),
			limit: effectiveSubmissionLimit(form, event),
			user: user ? { name: user.name, email: user.email } : null,
			portalPath,
		},
		{ headers: { "Server-Timing": timings.header() } },
	);
}

const STEP_ORDER = [
	"welcome",
	"account",
	"session",
	"participant",
	"review",
] as const;

function currentStepId(
	pathname: string,
): (typeof STEP_ORDER)[number] | "success" {
	if (pathname.endsWith("/step/account")) return "account";
	if (pathname.endsWith("/step/session")) return "session";
	if (pathname.endsWith("/step/participant")) return "participant";
	if (pathname.endsWith("/step/review")) return "review";
	if (pathname.endsWith("/step/success")) return "success";
	return "welcome";
}

function LoggedInBar({
	user,
	base,
}: {
	user: { name: string | null; email: string };
	base: string;
}) {
	const fetcher = useFetcher();
	const busy = useBusy();
	return (
		<FootNote>
			You are logged in as {user.name ?? user.email} ({user.email}). Not you?{" "}
			<fetcher.Form
				method="post"
				action={`${base}/step/account`}
				className="inline"
			>
				<LinkishButton name="intent" value="logout" disabled={busy}>
					Click here to log out
				</LinkishButton>
			</fetcher.Form>
		</FootNote>
	);
}

export default function SubmitLayout({ loaderData }: Route.ComponentProps) {
	const { event, form, closed, closeBanner, limit, user, portalPath } =
		loaderData;
	const location = useLocation();
	const [state, setState] = useState<WizardState | null>(null);
	const reset = useCallback(() => setState(null), []);
	const ctx: WizardCtx = { state, setState, reset };

	const base = submitPath(event.slug, form.publicId);
	const step = currentStepId(location.pathname);
	const hasSid = new URLSearchParams(location.search).has("sid");
	const onSuccess = step === "success";

	const labels: Record<(typeof STEP_ORDER)[number], string> = {
		welcome: "Welcome",
		account: "Account",
		session: "Submission",
		participant: "Participant",
		review: "Review",
	};
	const visibleSteps = STEP_ORDER.filter(
		(s) => s !== "participant" || form.participantsStep,
	);
	const activeIndex = visibleSteps.indexOf(
		step === "success" ? "review" : step,
	);
	const steps: StepDescriptor[] = visibleSteps.map((id, i) => ({
		id,
		label: labels[id],
		state:
			onSuccess || i < activeIndex
				? "done"
				: i === activeIndex
					? "active"
					: "todo",
		href:
			i < activeIndex && !onSuccess
				? id === "welcome"
					? base
					: stepPath(base, id, state?.sid)
				: undefined,
	}));

	// After close, only an existing submission may still be opened (read-only);
	// every other step — including deep links — renders the closed state.
	const showClosed = closed && !(step === "session" && hasSid);

	return (
		<WizardChrome
			eventName={event.name}
			formTitle={form.externalTitle}
			footer={user ? <LoggedInBar user={user} base={base} /> : undefined}
		>
			{!onSuccess && !showClosed && (
				<>
					<StepRail steps={steps} />
					{(closeBanner || limit !== null) && (
						<NoticeBanner>
							{closeBanner && <span>{closeBanner}</span>}
							{limit !== null && (
								<span>
									Submission Limit: {limit} submission{limit === 1 ? "" : "s"}{" "}
									per user
								</span>
							)}
						</NoticeBanner>
					)}
				</>
			)}
			{showClosed ? (
				<Panel>
					<EmptyState
						icon="calendar"
						title="Form submissions are no longer being accepted."
						body="The submission window for this form has closed. If you need to change an existing submission, contact the event team."
						action={
							user && portalPath ? (
								<AnchorTextLink href={portalPath}>
									Go to your speaker portal
								</AnchorTextLink>
							) : undefined
						}
					/>
				</Panel>
			) : (
				<Outlet context={ctx} />
			)}
		</WizardChrome>
	);
}

export function ErrorBoundary() {
	return (
		<div className="mx-auto flex min-h-screen max-w-[560px] flex-col justify-center px-5">
			<EmptyState
				icon="inbox"
				title="This form isn't available"
				body="The link may be incomplete or the form may have been removed. Check the URL you received, or contact the event team for a fresh link."
			/>
		</div>
	);
}
