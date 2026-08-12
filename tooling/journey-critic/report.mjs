const MARKER =
	/<!--\s*jc:f=([0-9a-f]{16});s=([a-z]+);j=([a-z0-9-]+);first=([0-9-]+)\s*-->/g;
const TITLE_AFTER_MARKER = /^###[^\n]*?\s—\s(.+)$/m;

const SEVERITY_BADGE = {
	blocker: "🛑 blocker",
	major: "⚠️ major",
	minor: "· minor",
};

export function parseLedger(body = "") {
	const entries = [];
	for (const match of String(body).matchAll(MARKER)) {
		const tail = body.slice(match.index + match[0].length);
		const title = tail.match(TITLE_AFTER_MARKER);
		entries.push({
			fingerprint: match[1],
			severity: match[2],
			journey: match[3],
			firstSeen: match[4],
			title: title ? title[1].trim() : "",
		});
	}
	return entries;
}

function marker(finding, firstSeen) {
	return `<!-- jc:f=${finding.fingerprint};s=${finding.severity};j=${finding.journey};first=${firstSeen} -->`;
}

function findingSection(finding, { origin, firstSeen, shotHref }) {
	const shots = finding.evidence
		.map((id) => shotHref(finding.journey, id))
		.filter(Boolean);
	const seenAlso = finding.alsoSeen?.length
		? `\nAlso hit by: ${[...new Set(finding.alsoSeen)].join(", ")}`
		: "";
	const age =
		firstSeen && firstSeen !== finding.seenAt
			? ` · open since ${firstSeen}`
			: "";
	return `${marker(finding, firstSeen ?? finding.seenAt)}
### ${SEVERITY_BADGE[finding.severity]} — ${finding.title}

**${finding.journey}** · [${finding.url}](${absolute(finding.url, origin)}) · abandonment risk ${finding.abandonment}/10 · ${finding.kind}${age}${seenAlso}

- **Expected:** ${finding.expected}
- **Actually:** ${finding.actual}
- **Costs them:** ${finding.cost}
- **Evidence:** ${shots.length ? shots.join(" · ") : finding.evidence.join(", ")}`;
}

function absolute(url, origin) {
	if (/^https?:\/\//.test(url)) return url;
	return `${origin}${url.startsWith("/") ? "" : "/"}${url}`;
}

function coverageTable(results) {
	const rows = results.map((result) => {
		const state =
			result.status === "complete"
				? result.outcome
				: `**incomplete** — ${result.reason}`;
		return `| ${result.title} | ${state} | ${result.findings.length} | ${result.turns ?? 0} | ${result.shots?.length ?? 0} |`;
	});
	return `| Journey | Outcome | Findings | Turns | Screens |\n|---|---|---|---|---|\n${rows.join("\n")}`;
}

function tollSection(results) {
	const blocks = results
		.filter((result) => result.toll?.length)
		.map((result) => {
			const items = result.toll.map(
				(entry) =>
					`- **${entry.kind}** — ${entry.item} _(${entry.where})_ → ${entry.consequence}`,
			);
			return `**${result.title}**\n${items.join("\n")}`;
		});
	return blocks.length
		? blocks.join("\n\n")
		: "_No journey reported anything it had to invent, guess, or commit to._";
}

function incompleteBanner(results) {
	const broken = results.filter((result) => result.status !== "complete");
	if (!broken.length) return "";
	return `> **This run did not cover the product.** ${broken.length} of ${results.length} journeys did not finish: ${broken
		.map((result) => `${result.title} (${result.reason})`)
		.join(
			"; ",
		)}.\n> Findings below are only from the journeys that completed. Absence of a finding here is not evidence of absence.\n\n`;
}

function engineLine(engine) {
	if (!engine?.model) return "_unrecorded_";
	const via = engine.endpoint ? ` via ${engine.endpoint}` : "";
	const caveat = engine.visionVouched
		? ""
		: " — off-catalog model behind a gateway, so nothing here verified it can actually see the screenshots";
	return `\`${engine.model.id}\`${via}${caveat}`;
}

export function isComplete(results) {
	return results.every((result) => result.status === "complete");
}

export function renderReport({
	runId,
	origin,
	startedAt,
	results,
	findings,
	identities,
	ownedSlugs,
	blocked,
	engine,
}) {
	const complete = isComplete(results);
	const header = `# Journey critic — run ${runId}

Walked \`${origin}\` on ${startedAt}. ${results.length} journeys, ${findings.length} findings.

`;
	const body = findings.length
		? findings
				.map((finding) =>
					findingSection(finding, {
						origin,
						firstSeen: finding.seenAt,
						shotHref: (journey, id) => {
							const shot = results
								.find((result) => result.journey === journey)
								?.shots?.find((entry) => entry.id === id);
							return shot ? `[${id}](shots/${journey}/${shot.file})` : null;
						},
					}),
				)
				.join("\n\n")
		: complete
			? "_Every journey completed and none of them cost the person anything worth reporting._"
			: "_No findings from the journeys that completed — see the coverage warning above._";

	const narratives =
		results
			.filter((result) => result.narrative)
			.map(
				(result) =>
					`**${result.title}** (${result.outcome})\n\n${result.narrative}`,
			)
			.join("\n\n") ||
		"_Nobody got far enough to have an account of it — every journey stopped short._";

	const guard = blocked?.length
		? blocked
				.map(
					(entry) =>
						`- ${entry.journey}: ${entry.method} ${entry.url} — ${entry.reason}`,
				)
				.join("\n")
		: "_Nothing was blocked._";

	return `${header}${incompleteBanner(results)}## Coverage

${coverageTable(results)}

## Findings

${body}

## The toll — what each person had to invent, guess, or commit to

${tollSection(results)}

## What happened, in their words

${narratives}

## Run data the owner may need

- Judged by: ${engineLine(engine)}
- Accounts this run could have created on the live product: ${identities.map((identity) => `\`${identity.email}\``).join(", ") || "none"}
- Events this run created: ${[...ownedSlugs].map((slug) => `\`${slug}\``).join(", ") || "none"}
- Requests the safety guard blocked:

${guard}
`;
}

export function renderIssueBody({
	runId,
	origin,
	startedAt,
	results,
	findings,
	ledger,
	artifactUrl,
}) {
	const complete = isComplete(results);
	const firstSeenOf = new Map(
		ledger.map((entry) => [entry.fingerprint, entry.firstSeen]),
	);
	const today = startedAt.slice(0, 10);
	const sections = findings.map((finding) =>
		findingSection(finding, {
			origin,
			firstSeen: firstSeenOf.get(finding.fingerprint) ?? today,
			shotHref: () => null,
		}),
	);

	const body = findings.length
		? sections.join("\n\n")
		: complete
			? "_Every journey completed and none of them cost the person anything worth reporting._"
			: "_No findings from the journeys that completed — coverage was incomplete, so this is not a clean bill of health._";

	return `<!-- jc:issue -->
Open experience findings from the scheduled journey critic. Rewritten on every run; each run also leaves a comment with what changed.

Last run \`${runId}\` walked ${origin} on ${startedAt}.${artifactUrl ? ` [Screenshots and full report](${artifactUrl})` : ""}

${incompleteBanner(results)}${coverageTable(results)}

---

${body}
`;
}

export function renderRunComment({
	runId,
	startedAt,
	results,
	reconciliation,
	artifactUrl,
}) {
	const complete = isComplete(results);
	const list = (entries) =>
		entries.length
			? entries
					.map((entry) => `- ${SEVERITY_BADGE[entry.severity]} ${entry.title}`)
					.join("\n")
			: "- _none_";

	const resolved = reconciliation.deferredResolution
		? "_Resolution deferred: this run did not cover every journey, so nothing can be called fixed._"
		: list(reconciliation.resolved);

	return `**Journey critic run \`${runId}\`** — ${startedAt}${complete ? "" : " · ⚠️ incomplete coverage"}

**New this run**
${list(reconciliation.fresh)}

**Still open**
${list(reconciliation.recurring)}

**Gone since last run**
${resolved}
${artifactUrl ? `\n[Screenshots and full report](${artifactUrl})` : ""}
`;
}
