import { createHash } from "node:crypto";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OPAQUE_ID = /^[0-9a-z]{16,}$/i;
const STOPWORDS = new Set([
	"a",
	"an",
	"and",
	"are",
	"as",
	"at",
	"be",
	"but",
	"by",
	"for",
	"from",
	"has",
	"in",
	"is",
	"it",
	"its",
	"no",
	"not",
	"of",
	"on",
	"or",
	"that",
	"the",
	"to",
	"with",
	"you",
	"your",
]);
const FUZZY_THRESHOLD = 0.6;

const SEVERITY_ORDER = { blocker: 0, major: 1, minor: 2 };

function mask(value, tokens) {
	let out = String(value ?? "");
	for (const token of tokens) {
		if (!token || token.length < 3) continue;
		out = out.replaceAll(token, "·");
	}
	return out;
}

export function normalizeUrl(url, tokens = []) {
	let path = String(url ?? "");
	try {
		path = new URL(path, "https://x.invalid").pathname;
	} catch {
		path = path.split("?")[0];
	}
	const masked = mask(path, tokens);
	return (
		masked
			.toLowerCase()
			.split("/")
			.map((segment) =>
				segment.includes("·") ||
				UUID.test(segment) ||
				OPAQUE_ID.test(segment) ||
				/^\d+$/.test(segment)
					? ":id"
					: segment,
			)
			.join("/")
			.replace(/\/+$/, "") || "/"
	);
}

export function titleTokens(title, tokens = []) {
	return new Set(
		mask(title, tokens)
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, " ")
			.split(" ")
			.filter((word) => word.length > 2 && !STOPWORDS.has(word)),
	);
}

export function fingerprint(finding, tokens = []) {
	const words = [...titleTokens(finding.title, tokens)].sort().join(" ");
	return createHash("sha256")
		.update(
			[
				finding.journey ?? "",
				finding.kind,
				normalizeUrl(finding.url, tokens),
				words,
			].join("\n"),
		)
		.digest("hex")
		.slice(0, 16);
}

function similar(a, b) {
	if (!a.size || !b.size) return false;
	let shared = 0;
	for (const word of a) if (b.has(word)) shared++;
	return shared / (a.size + b.size - shared) >= FUZZY_THRESHOLD;
}

export function sameConcept(left, right, tokens = []) {
	return (
		left.journey === right.journey &&
		left.kind === right.kind &&
		normalizeUrl(left.url, tokens) === normalizeUrl(right.url, tokens) &&
		similar(titleTokens(left.title, tokens), titleTokens(right.title, tokens))
	);
}

export function collate(findings, tokens = []) {
	const kept = [];
	for (const finding of findings) {
		const stamped = { ...finding, fingerprint: fingerprint(finding, tokens) };
		const twin = kept.find(
			(existing) =>
				existing.fingerprint === stamped.fingerprint ||
				sameConcept(existing, stamped, tokens),
		);
		if (!twin) {
			kept.push(stamped);
			continue;
		}
		// Two personas hitting the same wall is stronger evidence, not noise.
		if (SEVERITY_ORDER[stamped.severity] < SEVERITY_ORDER[twin.severity])
			twin.severity = stamped.severity;
		twin.abandonment = Math.max(twin.abandonment, stamped.abandonment);
		twin.alsoSeen = [...(twin.alsoSeen ?? []), stamped.journey];
	}
	return kept.sort(
		(a, b) =>
			SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
			b.abandonment - a.abandonment,
	);
}

export function reconcile({ current, previous = [], complete }) {
	const previousByFingerprint = new Map(
		previous.map((entry) => [entry.fingerprint, entry]),
	);
	const currentFingerprints = new Set(
		current.map((finding) => finding.fingerprint),
	);
	const fresh = current.filter(
		(finding) => !previousByFingerprint.has(finding.fingerprint),
	);
	const recurring = current.filter((finding) =>
		previousByFingerprint.has(finding.fingerprint),
	);
	// A run that could not walk every journey has not shown a finding is gone —
	// it has only failed to look. Resolution waits for a complete run.
	const resolved = complete
		? previous.filter((entry) => !currentFingerprints.has(entry.fingerprint))
		: [];
	return { fresh, recurring, resolved, deferredResolution: !complete };
}
