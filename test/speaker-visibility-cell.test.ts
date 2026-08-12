import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";
import { SpeakerVisibilityCell } from "../app/lib/submission-list";

// An evaluator aiming for a session title clicked a speaker's name and took her
// off every public surface, because the name WAS the toggle. These hold the two
// controls apart and make each one say what it is.

function render(opts: { visible: boolean; notice?: string }) {
	const RoutesStub = createRoutesStub([
		{
			id: "root",
			path: "/",
			Component: () =>
				createElement(SpeakerVisibilityCell, {
					Form: "form" as never,
					busy: false,
					speaker: {
						contactId: "c1",
						name: "Priya Raman",
						publicVisible: opts.visible,
					},
					visible: opts.visible,
					notice: opts.notice,
				}),
		},
	]);
	return renderToString(createElement(RoutesStub, { initialEntries: ["/"] }));
}

describe("speaker visibility cell", () => {
	it("makes the name a link to the speaker, never the toggle", () => {
		const html = render({ visible: true });
		expect(html).toMatch(
			/<a [^>]*href="\/admin\/contacts\/c1"[^>]*>Priya Raman/,
		);
		expect(html.match(/type="submit"/g)).toHaveLength(1);
		expect(html).not.toMatch(/<button[^>]*>[^<]*Priya Raman/);
	});

	it("names the speaker and the direction on the one submit control", () => {
		const shown = render({ visible: true });
		expect(shown).toContain(
			'aria-label="Hide Priya Raman from the public program"',
		);
		expect(shown).toContain('value="0"');

		const hidden = render({ visible: false });
		expect(hidden).toContain(
			'aria-label="Show Priya Raman on the public program"',
		);
		expect(hidden).toContain('value="1"');
		expect(hidden).toContain("Hidden");
	});

	it("keeps what the toggle did next to the toggle", () => {
		const html = render({
			visible: false,
			notice: "Priya Raman is hidden from the public program.",
		});
		// Inside the form, after the controls: a notice that rendered above the
		// row, or on some page-level flash, is not attached to the eye pressed.
		expect(html).toMatch(
			/aria-label="Show Priya Raman[^]*?Priya Raman is hidden from the public program\.[^]*?<\/form>/,
		);
	});
});
