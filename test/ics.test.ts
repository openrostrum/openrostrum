import { describe, expect, it } from "vitest";
import {
	buildIcs,
	inspectIcsAttachment,
	parseIcsAttachment,
} from "../app/lib/ics";

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
				title: "Talk",
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
				title:
					"AI.Engineer Sandbox Event (save the date): Closing Keynote: The Post-SaaS Stack",
				location: null,
				sequence: 0,
			},
		]);
	});

	it("rejects malformed SEQUENCE values", () => {
		for (const sequence of ["-1", "1.5", "NaN", "Infinity"]) {
			const ics = [
				"BEGIN:VCALENDAR",
				"BEGIN:VEVENT",
				"UID:submission-s1@openrostrum",
				"DTSTART:20270512T163000Z",
				"DTEND:20270512T170000Z",
				"SUMMARY:Talk",
				`SEQUENCE:${sequence}`,
				"END:VEVENT",
				"END:VCALENDAR",
			].join("\r\n");

			expect(parseIcsAttachment(ics), sequence).toEqual([]);
		}
	});

	it("rejects impossible UTC timestamp components", () => {
		for (const start of [
			"20260230T150000Z",
			"20261301T150000Z",
			"20261012T240000Z",
			"20261012T156000Z",
			"20261012T150060Z",
		]) {
			const ics = [
				"BEGIN:VCALENDAR",
				"BEGIN:VEVENT",
				"UID:submission-s1@openrostrum",
				`DTSTART:${start}`,
				"DTEND:20261012T170000Z",
				"SUMMARY:Talk",
				"SEQUENCE:0",
				"END:VEVENT",
				"END:VCALENDAR",
			].join("\r\n");

			expect(parseIcsAttachment(ics), start).toEqual([]);
		}
	});

	it("treats VEVENT tokens inside a title as text, not structure", () => {
		const title = "Literal BEGIN:VEVENT and END:VEVENT tokens";
		const ics = buildIcs({
			calendarName: "T",
			events: [
				{
					uid: "submission-tokens@openrostrum",
					start: new Date("2027-05-12T16:30:00Z"),
					end: new Date("2027-05-12T17:00:00Z"),
					title,
				},
			],
		});

		expect(parseIcsAttachment(ics)).toEqual([
			expect.objectContaining({
				uid: "submission-tokens@openrostrum",
				title,
			}),
		]);
	});

	it("inspects event count and parsed events in one result", () => {
		const valid = buildIcs({
			calendarName: "T",
			events: [
				{
					uid: "submission-valid@openrostrum",
					start: new Date("2027-05-12T16:30:00Z"),
					end: new Date("2027-05-12T17:00:00Z"),
					title: "Talk",
				},
			],
		});
		const malformed = [
			"BEGIN:VEVENT",
			"UID:submission-malformed@openrostrum",
			"END:VEVENT",
		].join("\r\n");
		const ics = valid.replace("END:VCALENDAR", `${malformed}\r\nEND:VCALENDAR`);

		expect(inspectIcsAttachment(ics)).toEqual({
			eventCount: 2,
			events: [
				expect.objectContaining({
					uid: "submission-valid@openrostrum",
					title: "Talk",
				}),
			],
		});
	});

	it("stops retaining parsed events after the inspection ceiling", () => {
		const ics = buildIcs({
			calendarName: "T",
			events: Array.from({ length: 4 }, (_, index) => ({
				uid: `submission-${index}@openrostrum`,
				start: new Date("2027-05-12T16:30:00Z"),
				end: new Date("2027-05-12T17:00:00Z"),
				title: `Talk ${index}`,
			})),
		});

		expect(inspectIcsAttachment(ics, 3)).toEqual({
			eventCount: 4,
			events: [],
		});
	});

	it("skips unparseable blocks instead of throwing", () => {
		expect(parseIcsAttachment("BEGIN:VEVENT\r\nUID:x\r\nEND:VEVENT")).toEqual(
			[],
		);
		expect(parseIcsAttachment("not an ics at all")).toEqual([]);
	});

	it("never reads a prefix-named property as the property it shadows", () => {
		// A client that wrote UIDX/DTSTARTX/SUMMARY-OTHER never wrote UID/DTSTART/
		// SUMMARY. Reading the impostor would let a malformed attachment become a
		// trusted delivery baseline and suppress the corrective invite.
		const withImpostor = (real: string, impostor: string) =>
			inspectIcsAttachment(
				[
					"BEGIN:VCALENDAR",
					"BEGIN:VEVENT",
					"UID:submission-s1@openrostrum",
					"DTSTART:20270512T163000Z",
					"DTEND:20270512T170000Z",
					"SUMMARY:Talk",
					"LOCATION:Room A",
					"END:VEVENT",
					"END:VCALENDAR",
				]
					.map((line) => (line === real ? impostor : line))
					.join("\r\n"),
			);

		// A missing UID/DTSTART leaves nothing to compare against, so the event is
		// dropped while the structural count stands — the row is then quarantined.
		for (const [real, impostor] of [
			["UID:submission-s1@openrostrum", "UIDX:submission-s1@openrostrum"],
			["DTSTART:20270512T163000Z", "DTSTARTX:20270512T163000Z"],
			["DTEND:20270512T170000Z", "DTENDX:20270512T170000Z"],
		] as const) {
			expect(withImpostor(real, impostor), impostor).toEqual({
				eventCount: 1,
				events: [],
			});
		}

		// SUMMARY/LOCATION are optional in RFC 5545, so the impostor must simply
		// not be read as the real value.
		expect(withImpostor("SUMMARY:Talk", "SUMMARY-OTHER:Talk").events).toEqual([
			expect.objectContaining({ title: null }),
		]);
		expect(
			withImpostor("LOCATION:Room A", "LOCATION-OTHER:Room A").events,
		).toEqual([expect.objectContaining({ location: null })]);
	});

	it("still reads properties that carry RFC 5545 parameters", () => {
		const ics = [
			"BEGIN:VCALENDAR",
			"BEGIN:VEVENT",
			"UID:submission-s1@openrostrum",
			"DTSTART;VALUE=DATE-TIME:20270512T163000Z",
			"DTEND;VALUE=DATE-TIME:20270512T170000Z",
			"SUMMARY;LANGUAGE=en-US:Talk",
			"END:VEVENT",
			"END:VCALENDAR",
		].join("\r\n");

		expect(parseIcsAttachment(ics)).toEqual([
			expect.objectContaining({
				uid: "submission-s1@openrostrum",
				start: new Date("2027-05-12T16:30:00Z"),
				end: new Date("2027-05-12T17:00:00Z"),
				title: "Talk",
			}),
		]);
	});

	it("quarantines events that repeat a property clients disagree on", () => {
		for (const duplicate of [
			"UID:submission-other@openrostrum",
			"DTSTART:20270512T180000Z",
			"DTEND:20270512T190000Z",
			"SUMMARY:Other talk",
			"LOCATION:Room B",
			"SEQUENCE:4",
		]) {
			const ics = [
				"BEGIN:VCALENDAR",
				"BEGIN:VEVENT",
				"UID:submission-s1@openrostrum",
				"DTSTART:20270512T163000Z",
				"DTEND:20270512T170000Z",
				"SUMMARY:Talk",
				"LOCATION:Room A",
				"SEQUENCE:1",
				duplicate,
				"END:VEVENT",
				"END:VCALENDAR",
			].join("\r\n");

			expect(inspectIcsAttachment(ics), duplicate).toEqual({
				eventCount: 1,
				events: [],
			});
		}
	});

	it("rejects events that are not wrapped in a VCALENDAR envelope", () => {
		const event = [
			"BEGIN:VEVENT",
			"UID:submission-s1@openrostrum",
			"DTSTART:20270512T163000Z",
			"DTEND:20270512T170000Z",
			"SUMMARY:Talk",
			"END:VEVENT",
		];

		for (const lines of [
			event,
			["BEGIN:VCALENDAR", ...event],
			[...event, "END:VCALENDAR"],
			["BEGIN:VCALENDAR", ...event, "END:VCALENDAR", ...event],
			["BEGIN:VCALENDAR", "BEGIN:VEVENT", ...event, "END:VEVENT"],
		]) {
			const inspection = inspectIcsAttachment(lines.join("\r\n"));
			expect(inspection.events, lines.join(" | ")).toEqual([]);
			expect(inspection.eventCount, lines.join(" | ")).toBeGreaterThan(0);
		}
	});
});
