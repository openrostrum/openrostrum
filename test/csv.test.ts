import { describe, expect, it } from "vitest";
import { parseCsv } from "../app/lib/csv";

// Oracle: RFC 4180 — quoted fields may contain commas, doubled quotes, and
// line breaks; CRLF and LF both delimit records. Real Sessionboard exports
// carry bios with all three.

describe("parseCsv", () => {
	it("parses quoted fields containing commas, quotes, and newlines", () => {
		const csv =
			'name,bio\n"Raman, Priya","Says ""hi""\nacross two lines"\nMarcus,plain';
		const { headers, rows } = parseCsv(csv);
		expect(headers).toEqual(["name", "bio"]);
		expect(rows).toEqual([
			["Raman, Priya", 'Says "hi"\nacross two lines'],
			["Marcus", "plain"],
		]);
	});

	it("handles CRLF records, a BOM, and no trailing newline", () => {
		const csv = "\uFEFFa,b\r\n1,2\r\n3,4";
		const { headers, rows } = parseCsv(csv);
		expect(headers).toEqual(["a", "b"]);
		expect(rows).toEqual([
			["1", "2"],
			["3", "4"],
		]);
	});

	it("skips blank lines and pads/truncates ragged rows to the header width", () => {
		const csv = "a,b,c\n\n1,2\n1,2,3,4\n";
		const { rows } = parseCsv(csv);
		expect(rows).toEqual([
			["1", "2", ""],
			["1", "2", "3"],
		]);
	});

	it("returns empty for an empty file", () => {
		expect(parseCsv("")).toEqual({ headers: [], rows: [] });
	});
});
