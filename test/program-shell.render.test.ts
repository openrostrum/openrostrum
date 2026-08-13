import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";
import type { ProgramEvent } from "../app/lib/program-types";
import { EmbedShell, ProgramShell } from "../app/widgets/chrome";

const event: ProgramEvent = {
	id: "event-devflow",
	name: "DevFlow Summit",
	slug: "devflow",
	timezone: "America/Los_Angeles",
	location: "San Francisco",
	dateRange: "October 12–13, 2026",
};

function renderShell(kind: "program" | "embed") {
	const RoutesStub = createRoutesStub([
		{
			id: "root",
			path: "/",
			Component: () =>
				kind === "program"
					? createElement(ProgramShell, {
							event,
							active: "sessions",
							children: createElement("p", null, "Program content"),
						})
					: createElement(EmbedShell, {
							event,
							children: createElement("p", null, "Embed content"),
						}),
		},
	]);
	return renderToString(createElement(RoutesStub, { initialEntries: ["/"] }));
}

describe("public program navigation", () => {
	it("wraps destinations so a fifth tab cannot clip off a phone", () => {
		// Five labels (Sessions / Speakers / Agenda / Itinerary / Gallery) do not
		// fit one 390px row. Shrinking them clips Gallery; wrapping keeps every
		// public surface reachable without a sideways swipe.
		expect(renderShell("program")).toMatch(
			/aria-label="Program"[^>]*flex-wrap/,
		);
	});
});

describe("public program theme control", () => {
	it("exposes the theme preference on standalone program pages", () => {
		expect(renderShell("program")).toMatch(
			/<button[^>]*aria-expanded="false"[^>]*aria-haspopup="true"/,
		);
	});

	it("keeps preference controls out of OS-pinned embeds", () => {
		expect(renderShell("embed")).not.toContain('aria-haspopup="true"');
	});
});

function renderWith(
	eventOverride: Partial<ProgramEvent>,
	kind: "program" | "embed" = "program",
) {
	const next = { ...event, ...eventOverride };
	const RoutesStub = createRoutesStub([
		{
			id: "root",
			path: "/",
			Component: () =>
				kind === "program"
					? createElement(ProgramShell, {
							event: next,
							active: "sessions",
							children: createElement("p", null, "Program content"),
						})
					: createElement(EmbedShell, {
							event: next,
							children: createElement("p", null, "Embed content"),
						}),
		},
	]);
	return renderToString(createElement(RoutesStub, { initialEntries: ["/"] }));
}

describe("public program header", () => {
	it("shows dates and location on standalone pages and embeds", () => {
		const line = "October 12–13, 2026 · San Francisco";
		expect(renderWith({})).toContain(line);
		expect(renderWith({}, "embed")).toContain(line);
	});

	it("shows dates alone when location is empty — no dangling separator", () => {
		const html = renderWith({ location: null });
		expect(html).toContain("October 12–13, 2026");
		expect(html).not.toContain("October 12–13, 2026 ·");
		expect(html).not.toContain(" · ");
	});

	it("shows location alone when dates are unset", () => {
		const html = renderWith({ dateRange: null, location: "San Francisco" });
		expect(html).toContain("San Francisco");
		expect(html).not.toContain(" · ");
	});

	it("omits the meta line entirely when both sides are empty", () => {
		const html = renderWith({ dateRange: null, location: null });
		expect(html).not.toContain("October 12–13, 2026");
		expect(html).not.toContain("San Francisco");
		expect(html).not.toContain(" · ");
	});
});
