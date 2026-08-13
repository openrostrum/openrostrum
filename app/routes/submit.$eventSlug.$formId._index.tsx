// @public — welcome step of the public CFP wizard.
import { useRouteLoaderData } from "react-router";
import { HtmlContent, LeadText, PageTitle } from "~/cfp/ui";
import { stepPath } from "~/cfp/wizard";
import { submitPath } from "~/domain/forms";
import { ButtonLink, Panel } from "~/ui";
import type { Route as LayoutRoute } from "./+types/submit.$eventSlug.$formId";

export default function WelcomeStep() {
	const layout = useRouteLoaderData<LayoutRoute.ComponentProps["loaderData"]>(
		"routes/submit.$eventSlug.$formId",
	);
	if (!layout) return null;
	const base = submitPath(layout.event.slug, layout.form.publicId);
	const next = stepPath(base, "session");
	return (
		<Panel>
			<div className="flex flex-col gap-4">
				<PageTitle>{layout.form.pageHeading || "Welcome!"}</PageTitle>
				{layout.form.welcomeHtml ? (
					<HtmlContent html={layout.form.welcomeHtml} />
				) : (
					<LeadText>
						We’re excited to hear what you’d like to present at{" "}
						{layout.event.name}. This form takes about five minutes: you’ll
						create or sign in to your speaker account, describe your session,
						and tell us who’s presenting. You can save a draft at any point and
						come back later.
					</LeadText>
				)}
				<div>
					<ButtonLink to={next}>Get Started</ButtonLink>
				</div>
			</div>
		</Panel>
	);
}
