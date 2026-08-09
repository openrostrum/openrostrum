import fs from "node:fs";
import path from "node:path";
import type { EvalConfig } from "./types.js";

export const KIT_VERSION = "0.1.0";
export const DEFAULT_AGENT_MODEL = "claude-opus-5";
export const DEFAULT_JUDGE_MODEL = "claude-opus-5";
export const DEFAULT_MAX_TURNS = 70;
/**
 * Below this share of rubric weight judged, the headline score is withheld:
 * a percentage computed over a fraction of the rubric is not comparable
 * across submissions and reads far more favorably than it deserves.
 */
export const MIN_COVERAGE_PCT = 60;

export interface CliArgs {
  command: string;
  flags: Record<string, string | boolean>;
}

export function parseArgs(argv: string[]): CliArgs {
  const [command = "help", ...rest] = argv;
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (!arg.startsWith("--")) {
      console.warn(`Ignoring unexpected argument: ${arg}`);
      continue;
    }
    let key = arg.slice(2);
    const eq = key.indexOf("=");
    if (eq >= 0) {
      flags[key.slice(0, eq)] = key.slice(eq + 1);
      continue;
    }
    const next = rest[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags[key] = next;
      i++;
    } else {
      flags[key] = true;
    }
  }
  return { command, flags };
}

export function loadConfig(args: CliArgs): EvalConfig {
  let fileConfig: Partial<EvalConfig> = {};
  const configPath = typeof args.flags.config === "string" ? args.flags.config : "evalconfig.json";
  if (fs.existsSync(configPath)) {
    fileConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
  }

  const url = typeof args.flags.url === "string" ? args.flags.url : fileConfig.url;
  if (!url) {
    throw new Error(
      "No target URL. Pass --url <submission url> or set \"url\" in evalconfig.json",
    );
  }

  const csv = (v: unknown) =>
    typeof v === "string" ? v.split(",").map((a) => a.trim()).filter(Boolean) : undefined;
  const areas = csv(args.flags.areas) ?? fileConfig.areas;
  const scenarios = csv(args.flags.scenarios) ?? fileConfig.scenarios;

  const stringFlag = (name: string): string | undefined => {
    const v = args.flags[name];
    if (v === true) throw new Error(`--${name} requires a value`);
    return typeof v === "string" && v.length > 0 ? v : undefined;
  };

  const maxTurnsFlag = stringFlag("max-turns");
  const maxTurns = maxTurnsFlag ? Number(maxTurnsFlag) : undefined;
  if (maxTurnsFlag && (!Number.isFinite(maxTurns) || maxTurns! < 1)) {
    throw new Error(`--max-turns must be a positive number (got "${maxTurnsFlag}")`);
  }

  return {
    ...fileConfig,
    url,
    areas,
    scenarios,
    includeOptional: Boolean(args.flags["include-optional"] ?? fileConfig.includeOptional),
    agentModel: stringFlag("agent-model") ?? fileConfig.agentModel ?? DEFAULT_AGENT_MODEL,
    judgeModel: stringFlag("judge-model") ?? fileConfig.judgeModel ?? DEFAULT_JUDGE_MODEL,
    maxTurnsPerScenario: maxTurns ?? fileConfig.maxTurnsPerScenario ?? DEFAULT_MAX_TURNS,
    headless: args.flags.headed ? false : fileConfig.headless ?? true,
  };
}

export function newRunDir(root = "runs"): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const dir = path.join(root, stamp);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
