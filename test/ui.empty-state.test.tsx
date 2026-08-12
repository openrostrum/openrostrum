import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EmptyLine } from "../app/ui/empty-state";
import { PipelineColumn } from "../app/components/pipeline-card";

const sources = import.meta.glob("../app/**/*.tsx", {
	query: "?raw",
	import: "default",
	eager: true,
}) as Record<string, string>;

/**
 * An emptiness branch that draws its own sentence: a `… === 0` test with a
 * sized, tinted text class in the JSX right under it. This is the shape the
 * audit found by hand — four copies at three different sizes and tones.
 */
function handRolledEmptyLines(source: string): number[] {
	const lines = source.split("\n");
	return lines.flatMap((line, i) => {
		if (!/(?:length|count|total) === 0/.test(line)) return [];
		const window = lines.slice(i, i + 4).join("\n");
		const sized = /text-\[1[23](?:\.5)?px\]/.test(window);
		const tinted = /text-fg-(?:muted|faint)/.test(window);
		return sized && tinted ? [i + 1] : [];
	});
}

describe("EmptyLine", () => {
	it("is the secondary text tier, and carries no box of its own", () => {
		// `fg-faint` is the placeholder/disabled tier (design-system.md tokens):
		// copy a reader has to read is `fg-muted`. Padding differs at every call
		// site, so it stays on the caller's wrapper — same split as `Caps`.
		const html = renderToString(
			createElement(EmptyLine, {
				children: "No notes yet — add the first one.",
			}),
		);
		expect(html).toBe(
			'<p class="text-[12.5px] text-fg-muted">No notes yet — add the first one.</p>',
		);
	});

	it("is what an empty pipeline column says", () => {
		const html = renderToString(
			createElement(PipelineColumn, {
				label: "Prospect",
				count: 0,
				truncated: 0,
				children: null,
			}),
		);
		expect(html).toContain(
			'<p class="text-[12.5px] text-fg-muted">No prospects here yet',
		);
	});

	it("is the only way a list inside a card or column says it is empty", () => {
		const handRolled = Object.entries(sources)
			.filter(([path]) => !path.endsWith("/ui/empty-state.tsx"))
			.flatMap(([path, source]) =>
				handRolledEmptyLines(source).map(
					(line) => `${path.replace("../", "")}:${line}`,
				),
			);
		// `EmptyState` (page/section), `EmptyRow` (inside a Table) and `EmptyLine`
		// (inside a card, column or menu) are the three; a bare <p> is none of them.
		expect(handRolled).toEqual([]);
	});
});
