import { Agent } from "@earendil-works/pi-agent-core";
import { Value } from "typebox/value";
import { terminalSchema } from "./charter.mjs";

export const DEFAULT_LIMITS = {
	maxTurns: 64,
	maxToolCalls: 200,
	maxLooks: 30,
	timeoutMs: 18 * 60 * 1000,
	// Turns held back from walking so a journey that runs long still gets to
	// report. A walk that hits the ceiling mid-stride has already collected the
	// evidence; losing all of it to the clock is the most expensive failure here.
	wrapMargin: 8,
};

const WRAP_BLOCK =
	"Your budget for this journey is spent — you cannot look or act again. Answer with the JSON report now, covering only what you already walked.";

export function extractJson(text) {
	try {
		return JSON.parse(text);
	} catch {
		const start = text.indexOf("{");
		const end = text.lastIndexOf("}");
		if (start < 0 || end <= start) return null;
		try {
			return JSON.parse(text.slice(start, end + 1));
		} catch {
			return null;
		}
	}
}

function handoffContract(produces) {
	if (!produces.length) return `"handoff":{}`;
	return `"handoff":{${produces.map((key) => `"${key}":"…"|null`).join(",")}}`;
}

export function journeyPrompt({ journey, entry, brief, limits }) {
	const produces = journey.produces ?? [];
	return `${brief}

You start at ${entry}. Open it and begin.

Work the loop: look, say what you expect, act, look again. You have ${limits.maxLooks} screenshots and roughly ${limits.maxTurns - limits.wrapMargin} turns of walking before the harness stops you and takes your report — enough to finish the goal properly, not enough to wander. Spend them on the path this person would take.

When the journey is over — goal reached, or abandoned the way this person would abandon it — do the two passes the charter ends on before you write anything: the toll, and the second look at the screens you crossed without stopping. Then reply with JSON only, in exactly this shape:

{"status":"complete",
 "outcome":"achieved"|"achieved-with-friction"|"abandoned",
 "narrative":"what actually happened to you, in your own voice, including where you hesitated or nearly stopped",
 "toll":[{"item":"what you had to invent, guess, commit to, or never found out","kind":"invented"|"guessed"|"committed"|"unanswered","where":"url or step","consequence":"what it costs this person if it was wrong"}],
 "findings":[{"title":"short, specific","kind":"momentum"|"clarity"|"trust"|"continuity"|"visual","severity":"blocker"|"major"|"minor","url":"where it happened","evidence":["shot-04"],"expected":"what you expected at that moment","actual":"what actually happened","cost":"what this costs the person and why they care","abandonment":0}],
 ${handoffContract(produces)}}

Rules for that JSON: every finding cites at least one screenshot id you actually took (the "screenshot: shot-NN" line in a look result). "abandonment" is 0–10, how close this finding brought you to closing the tab. "blocker" means a real person with this goal stops or does the wrong thing; "major" means they get through but pay for it in confusion, rework, or lost confidence; "minor" means it reads as unfinished. An empty findings list is a claim that nothing cost this person anything — make it only if that is true.

Never answer "complete" if the browser, the network, or your own budget stopped you from actually walking this journey. Say what went wrong in plain text instead.`;
}

export function wrapPrompt(reason) {
	return `Stop where you are — ${reason}. This is the harness running out of room, not this person giving up.

Report the journey as far as you actually walked it, using only what you already saw — including the second look at the screens you crossed without stopping, which costs you nothing now because those screenshots are already in front of you. Reply with the JSON report now, in the shape you were given. Set "outcome" to what was true at the moment you stopped, and say plainly in the narrative where you had got to and what you never reached. Do not invent anything you did not see and do not pad the findings to look thorough.`;
}

export function repairPrompt(problem) {
	return `Your report was rejected: ${problem}

Send the same report again, corrected, as JSON only — no prose around it, no code fence. Keep every finding you already made and change nothing about what you saw; this is a formatting fix, not a second opinion. Do not invent a finding to fill a field. If you genuinely cannot report this journey as walked, say so in plain text instead.`;
}

function incomplete(journey, reason, details = {}) {
	return {
		journey: journey.id,
		title: journey.title,
		status: "incomplete",
		findings: [],
		toll: [],
		handoff: {},
		reason,
		...details,
	};
}

function assistantText(message) {
	return message.content
		.filter((block) => block.type === "text")
		.map((block) => block.text)
		.join("");
}

function validate(value, journey, shotIds) {
	const schema = terminalSchema(journey.produces ?? []);
	if (!Value.Check(schema, value)) {
		const [first] = [...Value.Errors(schema, value)];
		throw new Error(
			`terminal response is not a completed journey: ${first?.path || "/"} ${first?.message ?? "invalid shape"}`,
		);
	}
	for (const [index, finding] of value.findings.entries()) {
		const unknown = finding.evidence.filter((id) => !shotIds.has(id));
		if (unknown.length)
			throw new Error(
				`finding ${index + 1} ("${finding.title}") cites ${unknown.join(", ")}, which is not a screenshot this journey took`,
			);
	}
	return value;
}

export async function runJourney({
	journey,
	entry,
	brief,
	charter,
	session,
	runtime,
	limits: supplied = {},
}) {
	const limits = { ...DEFAULT_LIMITS, ...supplied };
	let turns = 0;
	let toolCalls = 0;
	let limitReason;
	let spent;
	let wrapping = false;

	const critic = new Agent({
		initialState: {
			systemPrompt: charter,
			model: runtime.model,
			thinkingLevel: runtime.thinkingLevel ?? "off",
			tools: session.tools,
		},
		streamFn: runtime.streamFn,
		toolExecution: "sequential",
		beforeToolCall: async () => {
			if (wrapping) return { block: true, reason: WRAP_BLOCK };
			if (toolCalls <= limits.maxToolCalls) return undefined;
			spent ??= "tool call budget exhausted";
			return { block: true, reason: WRAP_BLOCK };
		},
		shouldStopAfterTurn: async ({ message }) => {
			if (wrapping) {
				if (turns < limits.maxTurns) return false;
				limitReason = "turn budget exhausted while wrapping up";
				return true;
			}
			const wantsMore = message.content.some(
				(block) => block.type === "toolCall",
			);
			if (wantsMore && turns >= limits.maxTurns - limits.wrapMargin) {
				spent ??= "turn budget exhausted";
				return true;
			}
			return Boolean(spent);
		},
	});

	critic.subscribe((event) => {
		if (event.type === "turn_start") turns++;
		if (event.type === "tool_execution_start") toolCalls++;
	});

	const timer = setTimeout(() => {
		limitReason = "journey timeout exceeded";
		critic.abort();
	}, limits.timeoutMs);

	const stats = () => ({
		turns,
		toolCalls,
		shots: session.shots,
		blocked: session.blocked,
	});

	function walked(result) {
		return {
			journey: journey.id,
			title: journey.title,
			status: "complete",
			outcome: result.outcome,
			narrative: result.narrative,
			toll: result.toll,
			findings: result.findings.map((finding) => ({
				...finding,
				journey: journey.id,
			})),
			handoff: result.handoff,
			...(spent ? { truncated: spent } : {}),
			...stats(),
		};
	}

	function terminalMessage() {
		if (limitReason) throw new Error(limitReason);
		if (critic.state.errorMessage) throw new Error(critic.state.errorMessage);
		const terminal = critic.state.messages.findLast(
			(message) => message.role === "assistant",
		);
		if (!terminal || terminal.stopReason !== "stop")
			throw new Error(
				`provider stopped with ${terminal?.stopReason ?? "no assistant response"}`,
			);
		return terminal;
	}

	function readReport(terminal) {
		const shotIds = new Set(session.shots.map((shot) => shot.id));
		return validate(extractJson(assistantText(terminal)), journey, shotIds);
	}

	try {
		await critic.prompt(journeyPrompt({ journey, entry, brief, limits }));
		// A journey stopped by its own budget has already collected the evidence.
		// It is asked for the report it can honestly give, and the run records that
		// the rest of the arc was never walked.
		if (spent && !critic.state.errorMessage) {
			wrapping = true;
			await critic.prompt(wrapPrompt(spent));
		}
		let result;
		try {
			result = readReport(terminalMessage());
		} catch (error) {
			// The journey has already been walked. Throwing away a real walk over a
			// dropped field costs far more than one more turn asking for it back.
			// Only the report's shape is retried; a dead provider or a spent budget
			// falls straight through, because asking it again cannot help.
			terminalMessage();
			await critic.prompt(repairPrompt(error.message));
			result = readReport(terminalMessage());
		}
		return walked(result);
	} catch (error) {
		return incomplete(journey, String(error?.message ?? error), stats());
	} finally {
		clearTimeout(timer);
	}
}
