import { createElement, type ComponentType } from "react";
import { renderToString } from "react-dom/server";
import { createRoutesStub, Outlet } from "react-router";
import { describe, expect, it } from "vitest";
import { FootNote } from "../app/cfp/ui";
import ParticipantStep from "../app/routes/submit.$eventSlug.$formId.step.participant";
import { DraftsHub } from "../app/routes/submit.$eventSlug.$formId.step.session";

function renderInRouter(element: ReturnType<typeof createElement>): string {
	const RoutesStub = createRoutesStub([
		{ path: "/", Component: () => element },
	]);
	return renderToString(createElement(RoutesStub, { initialEntries: ["/"] }));
}
function renderParticipantStep(): string {
	const RouteComponent = ParticipantStep as unknown as ComponentType<{
		loaderData: unknown;
		params: { eventSlug: string; formId: string };
	}>;
	const loaderData = {
		definition: {
			session: [],
			participant: [],
			roles: { speaker: { min: 1, max: null } },
		},
		selfContact: {
			firstName: "Priya",
			lastName: "Raman",
			email: "priya@example.com",
			mobilePhone: "",
			bio: "",
		},
		closed: false,
		sectionTitle: "Tell us about you",
		sectionHtml: null,
	};
	const ctx = {
		state: {
			wizardId: "w1",
			values: {},
			participants: [
				{
					key: "self",
					role: "speaker" as const,
					firstName: "Priya",
					lastName: "Raman",
					email: "priya@example.com",
					mobilePhone: "",
					bio: "",
					self: true,
				},
			],
		},
		setState: () => {},
		reset: () => {},
	};
	const RoutesStub = createRoutesStub([
		{
			path: "/",
			Component: () => createElement(Outlet, { context: ctx }),
			children: [
				{
					path: "step",
					Component: () =>
						createElement(RouteComponent, {
							loaderData,
							params: { eventSlug: "test-event", formId: "form-uuid-1" },
						}),
				},
			],
		},
	]);
	return renderToString(
		createElement(RoutesStub, { initialEntries: ["/step"] }),
	);
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

	it("does not speak organizer jargon on the participant step", () => {
		const html = renderParticipantStep();
		expect(html).toContain("Tell us about you");
		expect(html).toContain("Add another person");
		expect(html).toContain("1 speaker added");
		expect(html).not.toContain("Add Secondary Contact");
		expect(html).not.toContain("At least 1 Speakers");
	});
});
