export const PRODUCTION = Object.freeze({
	worker: "openrostrum",
	database: "openrostrum",
	bucket: "openrostrum-files",
});

function parsePr(value) {
	const text = String(value ?? "");
	if (!/^[1-9][0-9]*$/.test(text)) {
		throw new Error(
			`PR number must be a positive integer, got ${JSON.stringify(value)}`,
		);
	}
	return Number(text);
}

export function previewNames(pr) {
	const n = parsePr(pr);
	return {
		pr: n,
		worker: `openrostrum-pr-${n}`,
		database: `openrostrum-pr-${n}`,
		bucket: `openrostrum-pr-${n}-files`,
	};
}

export function assertPreviewIsolation(names) {
	if (
		names.worker === PRODUCTION.worker ||
		names.database === PRODUCTION.database ||
		names.bucket === PRODUCTION.bucket
	) {
		throw new Error(
			"refusing to operate on production Worker / D1 / R2 from a preview job",
		);
	}
}
