import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";
import { createSession } from "./browser.mjs";
import { loadCharter, REPO_ROOT } from "./charter.mjs";
import { DEFAULT_LIMITS, runJourney } from "./critic.mjs";
import { collate, reconcile } from "./findings.mjs";
import {
	accountsUsed,
	JOURNEYS,
	missingNeeds,
	planWaves,
} from "./journeys.mjs";
import { createGithub } from "./publish.mjs";
import {
	hasFullCoverage,
	isComplete,
	parseLedger,
	renderIssueBody,
	renderReport,
	renderRunComment,
} from "./report.mjs";
import { makeRuntime } from "./runtime.mjs";

const {
	ANTHROPIC_API_KEY,
	JC_TARGET = "https://openrostrum.com",
	JC_MODEL,
	JC_BASE_URL,
	JC_THINKING,
	// Reserved, non-routable by RFC 6761: the harness signs up on a live product
	// and must never cause mail to be delivered to a stranger.
	JC_EMAIL_DOMAIN = "journey-critic.invalid",
	JC_JOURNEYS,
	JC_OUT = "tooling/journey-critic/.out",
	JC_HEADED,
	GH_TOKEN,
	REPO,
	GITHUB_SERVER_URL = "https://github.com",
	GITHUB_REPOSITORY,
	GITHUB_RUN_ID,
	DRY_RUN,
} = process.env;

function fail(message) {
	console.error(message);
	process.exit(1);
}

if (!ANTHROPIC_API_KEY) fail("missing env ANTHROPIC_API_KEY");

const origin = new URL(JC_TARGET).origin;
const startedAt = new Date().toISOString();
const runId = `${startedAt.slice(0, 10).replaceAll("-", "")}-${Math.random().toString(36).slice(2, 8)}`;
const outDir = join(REPO_ROOT, JC_OUT, runId);

const identities = {
	organizer: {
		email: `journey-critic+${runId}-organizer@${JC_EMAIL_DOMAIN}`,
		password: `Northbound-${runId}`,
		name: "Priya Raman",
	},
	reviewer: {
		email: `journey-critic+${runId}-reviewer@${JC_EMAIL_DOMAIN}`,
		password: `Whitfield-${runId}`,
		name: "Lena Whitfield",
	},
};

const selected = JC_JOURNEYS
	? JOURNEYS.filter((journey) => JC_JOURNEYS.split(",").includes(journey.id))
	: JOURNEYS;
if (!selected.length) fail(`no journeys matched ${JC_JOURNEYS}`);

const accounts = accountsUsed(selected).map((key) => identities[key]);

function entryUrl(journey, handoff) {
	const entry = journey.entry({ handoff });
	return /^https?:\/\//.test(entry) ? entry : `${origin}${entry}`;
}

async function main() {
	const charter = await loadCharter();
	const runtime = makeRuntime({
		key: ANTHROPIC_API_KEY,
		model: JC_MODEL,
		baseUrl: JC_BASE_URL,
		thinkingLevel: JC_THINKING,
	});
	const browser = await chromium.launch({ headless: !JC_HEADED });
	const ownedSlugs = new Set();
	const handoff = {};
	const results = [];
	const blocked = [];

	console.error(
		`journey-critic ${runId} → ${origin} (${selected.length} journeys, model ${runtime.model.id})`,
	);

	try {
		for (const wave of planWaves(selected)) {
			const started = await Promise.all(
				wave.map(async (journey) => {
					const missing = missingNeeds(journey, handoff);
					if (missing.length) {
						const reason = `could not start: ${missing.join(", ")} was never produced by an earlier journey`;
						console.error(`  ${journey.id}: incomplete (${reason})`);
						return {
							journey: journey.id,
							title: journey.title,
							status: "incomplete",
							findings: [],
							toll: [],
							handoff: {},
							reason,
						};
					}

					const shotDir = join(outDir, "shots", journey.id);
					const session = await createSession({
						browser,
						origin,
						journey,
						shotDir,
						limits: DEFAULT_LIMITS,
						ownedSlugs,
					});
					try {
						const result = await runJourney({
							journey,
							entry: entryUrl(journey, handoff),
							brief: journey.brief({
								identity: identities[journey.identity ?? "organizer"],
								reviewer: identities.reviewer,
								handoff,
							}),
							charter,
							session,
							runtime,
						});
						console.error(
							`  ${journey.id}: ${result.status}${result.outcome ? ` / ${result.outcome}` : ""} — ${result.findings.length} findings, ${result.turns ?? 0} turns${result.reason ? ` (${result.reason})` : ""}${result.truncated ? ` (cut short: ${result.truncated})` : ""}`,
						);
						return result;
					} finally {
						for (const entry of session.blocked)
							blocked.push({ journey: journey.id, ...entry });
						await session.close();
					}
				}),
			);

			for (const result of started) {
				results.push(result);
				for (const [key, value] of Object.entries(result.handoff ?? {}))
					if (value) handoff[key] = value;
			}
			if (handoff.eventSlug) ownedSlugs.add(handoff.eventSlug);
		}
	} finally {
		await browser.close();
	}

	const tokens = [
		runId,
		...ownedSlugs,
		...Object.values(identities).map((identity) => identity.email),
	];
	const findings = collate(
		results.flatMap((result) => result.findings),
		tokens,
	).map((finding) => ({ ...finding, seenAt: startedAt.slice(0, 10) }));
	const complete = isComplete(results);
	const covered = hasFullCoverage(results);

	await mkdir(outDir, { recursive: true });
	const report = renderReport({
		runId,
		origin,
		startedAt,
		results,
		findings,
		identities: accounts,
		ownedSlugs,
		blocked,
		engine: runtime,
	});
	await writeFile(join(outDir, "report.md"), report);
	await writeFile(
		join(outDir, "findings.json"),
		`${JSON.stringify({ runId, origin, startedAt, complete, covered, results, findings, blocked }, null, 2)}\n`,
	);
	console.log(report);

	const repo = REPO ?? GITHUB_REPOSITORY;
	if (GH_TOKEN && repo && !DRY_RUN) {
		const artifactUrl =
			GITHUB_RUN_ID && repo
				? `${GITHUB_SERVER_URL}/${repo}/actions/runs/${GITHUB_RUN_ID}`
				: undefined;
		const github = createGithub({ token: GH_TOKEN, repo });
		await github.ensureLabel();
		const issue = await github.findLedgerIssue();
		const ledger = parseLedger(issue?.body ?? "");
		const reconciliation = reconcile({
			current: findings,
			previous: ledger,
			complete: covered,
		});
		const body = renderIssueBody({
			runId,
			origin,
			startedAt,
			results,
			findings,
			ledger,
			artifactUrl,
		});
		const target = issue
			? (await github.updateIssue(issue.number, body), issue)
			: await github.createIssue(body);
		await github.comment(
			target.number,
			renderRunComment({
				runId,
				startedAt,
				results,
				reconciliation,
				artifactUrl,
			}),
		);
		console.error(`published to ${target.html_url}`);
	} else {
		console.error("not publishing: set GH_TOKEN and REPO, and unset DRY_RUN");
	}

	console.error(`artifacts in ${outDir}`);
	if (!complete) fail("run incomplete — coverage below is not a clean result");
	// A truncated journey still reported, so the run is not a failure. It is also
	// not full coverage, and the console is where that gets noticed.
	if (!covered)
		console.error("run partial — some journeys were cut short by the harness");
}

main().catch((error) => fail(String(error?.stack ?? error)));
