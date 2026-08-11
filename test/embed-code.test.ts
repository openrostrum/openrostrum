import { describe, expect, it } from "vitest";
import { getEmbedCodeOutputs } from "../app/lib/embed-code";

describe("embed Get Code outputs", () => {
	it("returns every exact output for a speaker-family embed", () => {
		expect(
			getEmbedCodeOutputs({
				origin: "https://events.test",
				eventSlug: "devflow",
				publicId: "pub-gallery-1",
				type: "gallery",
			}),
		).toEqual({
			shareUrl: "https://events.test/embed/pub-gallery-1",
			styledHtml:
				'<script src="https://events.test/feeds/devflow/widget.js?embed=pub-gallery-1" async></script>',
			basicHtml:
				"https://events.test/feeds/devflow/speakers.html?embed=pub-gallery-1",
			json: "https://events.test/feeds/devflow/speakers.json?embed=pub-gallery-1",
			xml: "https://events.test/feeds/devflow/speakers.xml?embed=pub-gallery-1",
			iCal: "https://events.test/feeds/devflow/agenda.ics?embed=pub-gallery-1",
		});
	});

	it("uses session feeds for agenda-family embeds and encodes ids verbatim", () => {
		const outputs = getEmbedCodeOutputs({
			origin: "https://events.test",
			eventSlug: "dev flow",
			publicId: "pub/agenda one",
			type: "agenda",
		});

		expect(outputs.basicHtml).toBe(
			"https://events.test/feeds/dev%20flow/sessions.html?embed=pub%2Fagenda+one",
		);
		expect(outputs.json).toBe(
			"https://events.test/feeds/dev%20flow/sessions.json?embed=pub%2Fagenda+one",
		);
		expect(outputs.xml).toBe(
			"https://events.test/feeds/dev%20flow/sessions.xml?embed=pub%2Fagenda+one",
		);
		expect(outputs.iCal).toBe(
			"https://events.test/feeds/dev%20flow/agenda.ics?embed=pub%2Fagenda+one",
		);
	});
});
