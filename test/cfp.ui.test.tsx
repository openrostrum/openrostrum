import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";
import { FootNote } from "../app/cfp/ui";
import SubmitLayout from "../app/routes/submit.$eventSlug.$formId";
import { DraftsHub } from "../app/routes/submit.$eventSlug.$formId.step.session";

function renderInRouter(element: ReturnType<typeof createElement>): string {
	const RoutesStub = createRoutesStub([
		{ path: "/", Component: () => element },
	]);
	return renderToString(createElement(RoutesStub, { initialEntries: ["/"] }));
}

describe("public CFP hydration contracts", () => {
	it("renders footer forms in valid flow content", () => {
		const html = renderToString(
			createElement(FootNote, null, createElement("form", null, "Log out")),
		);
		expect(html).toMatch(/^<div\b/);
		expect(html).not.toMatch(/^<p\b/);
	});

	it("renders draft timestamps in the event timezone", () => {
		const html = renderInRouter(
			createElement(DraftsHub, {
				base: "/submit/event/form",
				drafts: [
					{
						id: "s1",
						title: "Hydration-safe draft",
						updatedAt: new Date("2026-08-11T13:16:34Z").getTime(),
					},
				],
				actionPath: "/submit/event/form/step/session",
				limitReached: false,
				limit: null,
				portalPath: null,
				timezone: "America/Los_Angeles",
			}),
		);

		expect(html).toContain("Last updated");
		expect(html).toContain("Aug 11, 2026, 6:16 AM PDT");
		expect(html).toContain("?sid=s1");
	});

	it("puts Submission before Account on the stepper", () => {
		const loaderData = {
			event: { name: "DevFlow Conf", slug: "devflow", timezone: "UTC" },
			form: {
				publicId: "form-1",
				externalTitle: "Call for Sessions",
				pageHeading: "Welcome!",
				welcomeHtml: null,
				participantsStep: true,
				autoRedirect: false,
			},
			closed: false,
			closeBanner: null,
			limit: 3,
			user: null,
			portalPath: null,
		};
		const RoutesStub = createRoutesStub([
			{
				path: "/submit/:eventSlug/:formId",
				Component: () =>
					createElement(SubmitLayout, {
						loaderData,
					} as never),
			},
		]);
		const html = renderToString(
			createElement(RoutesStub, {
				initialEntries: ["/submit/devflow/form-1"],
			}),
		);
		const rail = html.match(
			/<nav aria-label="Submission steps"[\s\S]*?<\/nav>/,
		)?.[0];
		expect(rail).toBeTruthy();
		const welcome = rail!.indexOf(">Welcome<");
		const submission = rail!.indexOf(">Submission<");
		const account = rail!.indexOf(">Account<");
		expect(welcome).toBeGreaterThan(-1);
		expect(submission).toBeGreaterThan(welcome);
		expect(account).toBeGreaterThan(submission);
	});
});
