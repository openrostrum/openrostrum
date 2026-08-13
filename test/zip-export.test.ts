import { describe, expect, it } from "vitest";
import {
	beginZipExport,
	failZipExport,
	finishZipExport,
	idleZipExport,
	parseZipGrouping,
	preflightZipExport,
	ZIP_MAX_ENTRIES,
	zipExportStatus,
} from "../app/domain/zip-export";

describe("zip export grouping", () => {
	it("treats only flat as a grouping change; everything else stays session folders", () => {
		expect(parseZipGrouping("flat")).toBe("flat");
		expect(parseZipGrouping(null)).toBe("session");
		expect(parseZipGrouping("session")).toBe("session");
		expect(parseZipGrouping("track")).toBe("session");
	});
});

describe("zip export preflight limits", () => {
	it("404s when nothing matches", () => {
		expect(preflightZipExport([])).toEqual({
			ok: false,
			status: 404,
			message: "Nothing to export yet — no files match.",
		});
	});

	it("400s at 10,001 files and at more than 1 GB", () => {
		expect(
			preflightZipExport(
				Array.from({ length: ZIP_MAX_ENTRIES + 1 }, () => ({ sizeBytes: 1 })),
			),
		).toEqual({
			ok: false,
			status: 400,
			message: "Too many files for one archive — narrow the selection.",
		});
		expect(
			preflightZipExport([
				{ sizeBytes: 600 * 1024 * 1024 },
				{ sizeBytes: 600 * 1024 * 1024 },
			]),
		).toEqual({
			ok: false,
			status: 400,
			message:
				"This selection exceeds the 1 GB archive limit — narrow the selection.",
		});
	});

	it("accepts 10,000 files that still fit under 1 GB", () => {
		expect(
			preflightZipExport(
				Array.from({ length: ZIP_MAX_ENTRIES }, () => ({ sizeBytes: 1 })),
			),
		).toEqual({
			ok: true,
			files: ZIP_MAX_ENTRIES,
			totalBytes: ZIP_MAX_ENTRIES,
		});
	});
});

describe("zip export in-flight lock", () => {
	it("ignores a second begin while the first export is still building", () => {
		const first = beginZipExport(idleZipExport());
		const second = beginZipExport(first);
		expect(first.phase).toBe("building");
		expect(second).toBe(first);
		expect(zipExportStatus(first)).toBe("Building ZIP…");
	});

	it("unlocks after the download handoff so another export can start", () => {
		const started = finishZipExport(beginZipExport(idleZipExport()), 2);
		expect(zipExportStatus(started)).toBe("Download started — 2 latest files.");
		expect(beginZipExport(started).phase).toBe("building");
	});

	it("singularizes the started copy for one file", () => {
		const started = finishZipExport(beginZipExport(idleZipExport()), 1);
		expect(zipExportStatus(started)).toBe("Download started — 1 latest file.");
	});

	it("returns to idle with the failure and allows a retry", () => {
		const failed = failZipExport(
			beginZipExport(idleZipExport()),
			"Nothing to export yet — no files match.",
		);
		expect(failed.phase).toBe("idle");
		expect(zipExportStatus(failed)).toBe(
			"Nothing to export yet — no files match.",
		);
		expect(beginZipExport(failed).phase).toBe("building");
	});
});
