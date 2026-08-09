import { describe, expect, it } from "vitest";
import { serverTimingHeader } from "../app/lib/track";

// Oracle: the Server-Timing header grammar — `<name>;dur=<millis>` entries,
// comma-separated — as consumed by browser DevTools and curl -D.
describe("serverTimingHeader", () => {
	it("serializes marks per the header grammar", () => {
		expect(
			serverTimingHeader([
				{ name: "db", dur: 12.34 },
				{ name: "total", dur: 100 },
			]),
		).toBe("db;dur=12.3, total;dur=100.0");
	});

	it("serializes no marks to an empty header value", () => {
		expect(serverTimingHeader([])).toBe("");
	});
});
