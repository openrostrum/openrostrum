import { describe, expect, it } from "vitest";
import { buildIcs } from "../app/lib/ics";

// Oracles from RFC 5545: §3.1 line folding (75 octets, continuation = CRLF +
// space, no character split) and §3.3.11 TEXT escaping.

describe("ics serializer", () => {
	it("folds long non-ASCII lines at 75 UTF-8 octets without splitting characters", () => {
		const title = "Café Sessions — Übersicht für Sprecherinnen 🌍 ".repeat(4);
		const ics = buildIcs({
			calendarName: "Test",
			events: [
				{
					uid: "u1@test",
					start: new Date("2027-05-12T16:30:00Z"),
					end: new Date("2027-05-12T17:00:00Z"),
					title,
				},
			],
		});
		const encoder = new TextEncoder();
		for (const line of ics.split("\r\n")) {
			expect(encoder.encode(line).length).toBeLessThanOrEqual(75);
		}
		// Unfolding (CRLF + space removal) restores the exact escaped content.
		const unfolded = ics.replace(/\r\n /g, "");
		expect(unfolded).toContain(`SUMMARY:${title.replaceAll(",", "\\,")}`);
	});

	it("escapes TEXT values and keeps stable UIDs and UTC stamps", () => {
		const ics = buildIcs({
			calendarName: "Escape; test, here",
			events: [
				{
					uid: "or-session-s1@openrostrum",
					start: new Date("2027-05-12T16:30:00Z"),
					end: new Date("2027-05-12T17:00:00Z"),
					title: "Line1\nLine2; a, b",
					location: "Main Hall",
				},
			],
		});
		expect(ics).toContain("UID:or-session-s1@openrostrum");
		expect(ics).toContain("DTSTART:20270512T163000Z");
		expect(ics).toContain("SUMMARY:Line1\\nLine2\\; a\\, b");
		expect(ics).toContain("X-WR-CALNAME:Escape\\; test\\, here");
		expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
	});
});
