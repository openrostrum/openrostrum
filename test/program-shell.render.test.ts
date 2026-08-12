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
