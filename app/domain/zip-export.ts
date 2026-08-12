export const ZIP_MAX_TOTAL_BYTES = 1024 * 1024 * 1024;
export const ZIP_MAX_ENTRIES = 10_000;

export type ZipGrouping = "session" | "flat";

export function parseZipGrouping(raw: string | null): ZipGrouping {
	return raw === "flat" ? "flat" : "session";
}

export type ZipPreflight =
	| { ok: true; files: number; totalBytes: number }
	| { ok: false; status: 400 | 404; message: string };

export function preflightZipExport(
	files: Array<{ sizeBytes: number | null }>,
): ZipPreflight {
	if (files.length === 0) {
		return {
			ok: false,
			status: 404,
			message: "Nothing to export yet — no files match.",
		};
	}
	if (files.length > ZIP_MAX_ENTRIES) {
		return {
			ok: false,
			status: 400,
			message: "Too many files for one archive — narrow the selection.",
		};
	}
	const totalBytes = files.reduce(
		(sum, file) => sum + (file.sizeBytes ?? 0),
		0,
	);
	if (totalBytes > ZIP_MAX_TOTAL_BYTES) {
		return {
			ok: false,
			status: 400,
			message:
				"This selection exceeds the 1 GB archive limit — narrow the selection.",
		};
	}
	return { ok: true, files: files.length, totalBytes };
}

export type ZipExportPhase = "idle" | "building" | "started";

export type ZipExportState = {
	phase: ZipExportPhase;
	fileCount: number;
	error: string | null;
};

export function idleZipExport(): ZipExportState {
	return { phase: "idle", fileCount: 0, error: null };
}

export function beginZipExport(state: ZipExportState): ZipExportState {
	if (state.phase === "building") return state;
	return { phase: "building", fileCount: state.fileCount, error: null };
}

export function finishZipExport(
	state: ZipExportState,
	fileCount: number,
): ZipExportState {
	if (state.phase !== "building") return state;
	return { phase: "started", fileCount, error: null };
}

export function failZipExport(
	state: ZipExportState,
	error: string,
): ZipExportState {
	if (state.phase !== "building") return state;
	return { phase: "idle", fileCount: 0, error };
}

export function zipExportStatus(state: ZipExportState): string | null {
	if (state.phase === "building") return "Building ZIP…";
	if (state.phase === "started") {
		const n = state.fileCount;
		return `Download started — ${n} latest file${n === 1 ? "" : "s"}.`;
	}
	return state.error;
}
