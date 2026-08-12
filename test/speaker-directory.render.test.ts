import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";
import type {
	PublicSpeakerProfile,
	SpeakerDirectoryData,
} from "../app/lib/program-types";
import { SpeakerDirectory } from "../app/widgets/surfaces";

// Oracle: docs/rules/design-system.md — compound metadata joins on " · ", the
// house separator. A person's role is written the same way on every surface,
// public or admin, so the speakers list, the gallery tiles, the session card
// and the speaker detail must all agree.

const speaker: PublicSpeakerProfile = {
	id: "sp-1",
	name: "Ada Rivera",
	firstName: "Ada",
	lastName: "Rivera",
	jobTitle: "CTO",
	companyName: "DevFlow",
	bio: null,
	photoUrl: null,
	sessions: [],
};

function directory(over: Partial<SpeakerDirectoryData> = {}) {
	return {
		speakers: [speaker],
		total: 1,
		page: 1,
		pages: 1,
		q: "",
		detail: null,
		...over,
	} satisfies SpeakerDirectoryData;
}

function render(layout: "list" | "gallery", data: SpeakerDirectoryData) {
	const RoutesStub = createRoutesStub([
		{
			id: "root",
			path: "/",
			Component: () =>
				createElement(SpeakerDirectory, {
					data,
					layout,
					base: "/speakers/devflow",
					sessionsBase: "/sessions/devflow",
				}),
		},
	]);
	return renderToString(createElement(RoutesStub, { initialEntries: ["/"] }));
}

describe("speaker role line", () => {
	it("writes title and company with the house separator in the list", () => {
		expect(render("list", directory())).toContain("CTO · DevFlow");
	});

	it("writes title and company with the house separator in the gallery", () => {
		expect(render("gallery", directory())).toContain("CTO · DevFlow");
	});

	it("writes title and company with the house separator on the detail", () => {
		const html = render("list", directory({ detail: speaker }));
		expect(html).toContain("CTO · DevFlow");
	});

	it("omits the separator when only one part is on record", () => {
		const html = render(
			"list",
			directory({ speakers: [{ ...speaker, companyName: null }] }),
		);
		expect(html).toContain("CTO");
		expect(html).not.toContain("CTO ·");
	});
});

describe("speaker directory layouts", () => {
	it("keeps each surface's own empty-state copy", () => {
		const empty = directory({ speakers: [], total: 0 });
		expect(render("list", empty)).toContain("Speakers appear here once");
		expect(render("gallery", empty)).toContain("The gallery fills in once");
	});

	it("offers the same recovery when a search matches nobody", () => {
		const noMatch = directory({ speakers: [], total: 0, q: "zzz" });
		for (const layout of ["list", "gallery"] as const) {
			const html = render(layout, noMatch);
			expect(html, layout).toContain("No speakers match");
			expect(html, layout).toContain("Clear search");
		}
	});

	it("labels the way back with the surface the visitor came from", () => {
		const detail = directory({ detail: speaker });
		expect(render("list", detail)).toContain("All speakers");
		expect(render("gallery", detail)).toContain("Back to gallery");
	});
});
