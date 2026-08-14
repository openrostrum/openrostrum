/**
 * One-off agent task: populate a SessionBoard sandbox event with realistic
 * demo content (tracks, review groups, sessions + speakers, a one-day agenda).
 *
 * Reuses the eval kit's browser tools and agent loop, but runs a bespoke
 * scenario instead of a spec — so it produces the same evidence bundle
 * (screenshots + transcript + observations) as a graded scenario.
 *
 * Requires a saved organizer session:
 *   npm run sbek -- auth --persona organizer --config evalconfig.sessionboard.json
 *
 * Then:
 *   npm run setup:sessionboard
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { runScenario } from "../src/agent.js";
import { initLog, log, closeLog } from "../src/log.js";
import { newRunDir } from "../src/config.js";
import type { EvalConfig, Scenario } from "../src/types.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const kitRoot = path.resolve(here, "..");
const configPath = path.join(kitRoot, "evalconfig.sessionboard.json");
if (!fs.existsSync(configPath)) throw new Error(`Missing ${configPath}`);
const config: EvalConfig = {
  ...JSON.parse(fs.readFileSync(configPath, "utf8")),
  maxTurnsPerScenario: Number(process.env.SBEK_MAX_TURNS ?? 120),
  headless: process.env.SBEK_HEADED ? false : true,
};

const fixtures = JSON.parse(
  fs.readFileSync(path.join(kitRoot, "fixtures", "aie-europe.json"), "utf8"),
);

const scenario: Scenario = {
  id: "SETUP-S1",
  name: "Populate the sandbox event with tracks, review groups, sessions and a one-day agenda",
  persona: "organizer",
  steps: `You are populating a SessionBoard sandbox event with realistic demo content. This is a
sandbox owned by the person who asked for this, and creating content is exactly what they want.

SAFETY RULES — follow these strictly:
- CREATE and EDIT only. Never delete, archive, cancel, or bulk-remove anything that already exists.
- Never send emails, invitations, or notifications to anyone. If a save dialog offers to notify
  speakers or reviewers, turn that option OFF before saving. If it cannot be turned off, skip that
  step and record an observation instead.
- Never change account, billing, integration, or workspace-wide settings.
- Use only the dummy speaker names/emails from the sample data (all @sbek-demo.example.com).
- Screenshot every created object after saving, so there is a record of what was added.

ALREADY DONE in a previous pass — do NOT redo these:
- Tracks: the event already has 6 tracks (Track 1, AI Architects, Coding Agents, Context Engineering,
  Evals & Observability, Track 2). Use them; do not create new tracks.
- Review groups: "Engineering Review Group", "Leadership Review Group" and "Finance Review Group"
  already exist as Evaluation Plans. Do not recreate them.
- Sessions already created: "Every API Is a Tool for Agents" and "Replacing 12K LoC with a 200 LoC Skill".
  Leave them alone except to add a missing abstract/description if one is blank.

RICH TEXT: the session Description field is a TinyMCE-style editor. The snapshot now lists editor
iframes as their own ref marked <richtext> — use fill on THAT ref. Inline editors also work: fill the
ref whose label shows the editor's placeholder text. Do not spend more than two attempts per field;
if it still will not accept text, record an observation and move on.

WORK TO DO, in order:

1. Get oriented. You should already be signed in. Go straight to /event/6703/sessions?useNewUI=true. Screenshot the landing page and record the event
   name and the main navigation items. Find the areas for tracks/categories, review groups (may be
   called review teams, committees, evaluation groups, or reviewer assignment), sessions/abstracts,
   speakers, and the agenda/schedule builder. Record the URL of each as an observation.

2. TRACKS. Look at what tracks/categories already exist in this event and screenshot the list.
   - If tracks already exist, USE THEM — map the sample sessions onto the existing tracks sensibly
     and record which existing tracks you chose.
   - Only if there are no usable tracks, create these three: "Finance Track", "Engineering Track",
     "Leadership Track". Screenshot the list after creating them.

3. REVIEW GROUPS. Create one review group per track you are using (e.g. "Engineering Review Group"
   for the Engineering Track). Attach the corresponding track/category to each group if the UI
   supports it. Do NOT invite or email any reviewers — if the only way to create a group is to
   invite someone, stop and record that as an observation instead. Screenshot the resulting list.

4. SESSIONS + SPEAKERS. Create the sample sessions from the sample data (there are 7). For each:
   title, abstract, format, its track, and the dummy speaker (name, company, job title, email).
   Create the speaker record if the UI requires one first. If a field in the sample data has no
   equivalent in this UI, skip it and note that. Screenshot each session after saving, and
   screenshot the full sessions list at the end showing all of them.

5. AGENDA. Build a simple ONE-DAY agenda and place the sessions into it using the times in the
   sample data's agenda block (09:00-14:25, with a lunch gap). Create the day and any required
   room/stage/location if the builder needs one. Screenshot the finished agenda showing the
   sessions laid out in time order.

6. VERIFY. Reload the sessions list and the agenda from a fresh navigation and screenshot both,
   confirming everything persisted. Record a final observation summarising exactly what you
   created: track names, review group names, session titles, and the agenda day/times.

If any step is impossible in this product, record a clear observation explaining what you tried and
what was missing, then continue with the remaining steps — do not abandon the whole task.`,
  success_signals: [
    "Screenshot of the tracks list (existing tracks used, or the three created)",
    "Screenshot of the review groups list with one group per track",
    "Screenshot of the sessions list showing all created sessions with their speakers",
    "Screenshot of the one-day agenda with sessions placed in time order",
    "A final observation listing exactly what was created",
  ],
};

const runDir = newRunDir("runs-setup");
initLog(runDir);
log(`SessionBoard setup run: ${runDir}`);
log(`Target: ${config.url}`);

const evidenceDir = path.join(runDir, scenario.id);
fs.mkdirSync(evidenceDir, { recursive: true });

const client = new Anthropic();
const result = await runScenario({
  client,
  config,
  scenario,
  areaTitle: "SessionBoard sandbox population",
  fixtures,
  evidenceDir,
});

fs.writeFileSync(path.join(evidenceDir, "evidence.json"), JSON.stringify(result, null, 2));
log(`\noutcome: ${result.outcome} (${result.turns} turns, ${result.screenshots.length} screenshots)`);
log(`summary: ${result.summary}`);
if (result.observations.length) {
  log(`\nobservations:`);
  for (const o of result.observations) log(`  - ${o}`);
}
log(`\nEvidence: ${evidenceDir}`);
closeLog();
