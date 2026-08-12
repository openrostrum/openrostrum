import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
	FALLBACK_TIMEZONE,
	TimezoneSelect,
} from "../app/components/timezone-select";

function optionValues(html: string): string[] {
	return [...html.matchAll(/<option value="([^"]+)"/g)].map((m) => m[1] ?? "");
}

function selectedValue(html: string): string | undefined {
	return html.match(/<option value="([^"]+)" selected=""/)?.[1];
}

describe("timezone select", () => {
	it("preselects the stored zone over the server's fallback", () => {
		const html = renderToString(
			createElement(TimezoneSelect, { value: "Europe/Paris" }),
		);
		expect(selectedValue(html)).toBe("Europe/Paris");
	});

	it("falls back to a real zone when nobody has answered yet", () => {
		const html = renderToString(createElement(TimezoneSelect, { value: null }));
		// The browser's own zone is a client-only signal, so the server renders a
		// valid selected option rather than an empty control that submits nothing.
		expect(selectedValue(html)).toBe(FALLBACK_TIMEZONE);
	});

	it("keeps a stored legacy alias selectable instead of dropping it", () => {
		// `US/Pacific` is a zone the server accepts (Intl.DateTimeFormat resolves it)
		// but the canonical list omits. Without the alias as an option the control
		// renders blank, and saving an unrelated field rewrites the event's timezone.
		expect(Intl.supportedValuesOf("timeZone")).not.toContain("US/Pacific");

		const html = renderToString(
			createElement(TimezoneSelect, { value: "US/Pacific" }),
		);
		expect(optionValues(html)).toContain("US/Pacific");
		expect(selectedValue(html)).toBe("US/Pacific");
	});

	it("does not duplicate a stored zone the canonical list already carries", () => {
		const html = renderToString(
			createElement(TimezoneSelect, { value: "Europe/Paris" }),
		);
		expect(optionValues(html).filter((v) => v === "Europe/Paris")).toHaveLength(
			1,
		);
	});

	it("submits under the name the event and onboarding actions read", () => {
		const html = renderToString(
			createElement(TimezoneSelect, { value: "Europe/Paris" }),
		);
		expect(html).toContain('name="timezone"');
		expect(html).toContain("required");
	});

	it("shows a server-side validation error on the field", () => {
		const html = renderToString(
			createElement(TimezoneSelect, {
				value: "Europe/Paris",
				error: "Pick a timezone",
			}),
		);
		expect(html).toContain("Pick a timezone");
	});
});
