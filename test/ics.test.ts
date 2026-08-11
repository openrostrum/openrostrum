import { describe, expect, it } from "vitest";
import { buildIcs, parseIcsAttachment } from "../app/lib/ics";

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

	it("carries the given SEQUENCE (defaulting to 0) and the iTIP METHOD", () => {
		const base = {
			uid: "u1@test",
			start: new Date("2027-05-12T16:30:00Z"),
			end: new Date("2027-05-12T17:00:00Z"),
			title: "Talk",
		};
		expect(buildIcs({ calendarName: "T", events: [base] })).toContain(
			"SEQUENCE:0",
		);
		const revised = buildIcs({
			calendarName: "T",
			method: "PUBLISH",
			events: [{ ...base, sequence: 3 }],
		});
		// RFC 5546: same UID + higher SEQUENCE is what makes a client REPLACE
		// the stored event instead of duplicating it.
		expect(revised).toContain("SEQUENCE:3");
		expect(revised).toContain("METHOD:PUBLISH");
	});
});

describe("parseIcsAttachment (the outbox ledger reader)", () => {
	it("round-trips this serializer's output — folded lines and escaped LOCATION included", () => {
		const location = `Grand Ballroom, Floor 2; ${"Very Long Wing Name ".repeat(6)}`;
		const ics = buildIcs({
			calendarName: "T",
			events: [
				{
					uid: "submission-s1@openrostrum",
					start: new Date("2027-05-12T16:30:00Z"),
					end: new Date("2027-05-12T17:00:00Z"),
					title: "Talk",
					location,
					sequence: 2,
				},
			],
		});
		expect(parseIcsAttachment(ics)).toEqual([
			{
				uid: "submission-s1@openrostrum",
				start: new Date("2027-05-12T16:30:00Z"),
				end: new Date("2027-05-12T17:00:00Z"),
				location,
				sequence: 2,
			},
		]);
	});

	it("atomically unescapes literal backslash-n alongside newlines and punctuation", () => {
		const location = "Hall \\n Annex\nFloor 2; A, B";
		const ics = buildIcs({
			calendarName: "T",
			events: [
				{
					uid: "submission-escapes@openrostrum",
					start: new Date("2027-05-12T16:30:00Z"),
					end: new Date("2027-05-12T17:00:00Z"),
					title: "Talk",
					location,
				},
			],
		});

		expect(parseIcsAttachment(ics)[0]?.location).toBe(location);
	});

	it("reads the npm-ics payloads historic accept emails attached", () => {
		// Captured VERBATIM from the npm-ics output the accept spine attached
		// before this serializer replaced it — what prod outbox rows hold (note
		// the tab-folded SUMMARY). Change detection must read it as a baseline.
		const historic =
			"BEGIN:VCALENDAR\r\nVERSION:2.0\r\nCALSCALE:GREGORIAN\r\nPRODID:adamgibbons/ics\r\nMETHOD:PUBLISH\r\nX-PUBLISHED-TTL:PT1H\r\nBEGIN:VEVENT\r\nUID:submission-s_keynote@openrostrum\r\nSUMMARY:AI.Engineer Sandbox Event (save the date): Closing Keynote: The Pos\r\n\tt-SaaS Stack\r\nDTSTAMP:20260810T205445Z\r\nDTSTART:20261012T150000Z\r\nDTEND:20261015T010000Z\r\nSEQUENCE:0\r\nSTATUS:CONFIRMED\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
		expect(parseIcsAttachment(historic)).toEqual([
			{
				uid: "submission-s_keynote@openrostrum",
				start: new Date("2026-10-12T15:00:00Z"),
				end: new Date("2026-10-15T01:00:00Z"),
				location: null,
				sequence: 0,
			},
		]);
	});

	it("skips unparseable blocks instead of throwing", () => {
		expect(parseIcsAttachment("BEGIN:VEVENT\r\nUID:x\r\nEND:VEVENT")).toEqual(
			[],
		);
		expect(parseIcsAttachment("not an ics at all")).toEqual([]);
	});
});
