import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import type { Spec, RubricItem, Scenario } from "./types.js";

const here = path.dirname(fileURLToPath(import.meta.url));
export const SPECS_DIR = path.resolve(here, "..", "specs");
export const FIXTURES_DIR = path.resolve(here, "..", "fixtures");

export function loadSpecs(specsDir = SPECS_DIR): Spec[] {
  const files = fs
    .readdirSync(specsDir)
    .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
    .sort();
  const specs = files.map((f) => {
    const raw = YAML.parse(fs.readFileSync(path.join(specsDir, f), "utf8"));
    return validateSpec(raw, f);
  });
  const slugs = new Set<string>();
  // Rubric and scenario ids must be globally unique: manual-results.json is
  // keyed by rubric id, and runDir/<scenarioId>/ is the evidence directory.
  const rubricIds = new Set<string>();
  const scenarioIds = new Set<string>();
  for (const s of specs) {
    if (slugs.has(s.area)) throw new Error(`Duplicate spec area slug: ${s.area}`);
    slugs.add(s.area);
    for (const r of s.rubric) {
      if (rubricIds.has(r.id)) throw new Error(`Duplicate rubric id across specs: ${r.id}`);
      rubricIds.add(r.id);
    }
    for (const sc of s.scenarios) {
      if (scenarioIds.has(sc.id)) throw new Error(`Duplicate scenario id across specs: ${sc.id}`);
      scenarioIds.add(sc.id);
    }
  }
  return specs;
}

/**
 * Loads the shared sample data. Persona emails are overridable per submission
 * (config.personaEmails, or an email supplied in config.credentials) so anyone
 * running the kit can point verification/magic-link mail at their own inbox
 * instead of the placeholder addresses shipped here.
 */
export function loadFixtures(config?: {
  personaEmails?: Record<string, string>;
  credentials?: Record<string, { email?: string }>;
}): Record<string, unknown> {
  const p = path.join(FIXTURES_DIR, "sample-data.json");
  const data = JSON.parse(fs.readFileSync(p, "utf8"));
  const identities = data.identities as Record<string, { email?: string }> | undefined;
  if (!identities) return data;

  for (const persona of Object.keys(identities)) {
    const override = config?.personaEmails?.[persona] ?? config?.credentials?.[persona]?.email;
    if (override) identities[persona].email = override;
  }
  return data;
}

function validateSpec(raw: any, file: string): Spec {
  const problems: string[] = [];
  const req = (field: string) => {
    if (raw?.[field] === undefined || raw?.[field] === null || raw?.[field] === "") {
      problems.push(`missing "${field}"`);
    }
  };
  req("area");
  req("title");
  req("prefix");
  req("overview");
  req("rubric");

  const scenarios: Scenario[] = (raw.scenarios ?? []).map((s: any, i: number) => {
    if (!s.id || !s.steps) problems.push(`scenario[${i}] missing id or steps`);
    return s as Scenario;
  });
  const scenarioIds = new Set(scenarios.map((s) => s.id));

  const rubric: RubricItem[] = (raw.rubric ?? []).map((r: any, i: number) => {
    if (!r.id || !r.criterion || !r.pass_criteria) {
      problems.push(`rubric[${i}] missing id, criterion, or pass_criteria`);
    }
    if (![1, 2, 3].includes(r.weight)) problems.push(`rubric[${i}] (${r.id}) weight must be 1|2|3`);
    if (!["auto", "auto-partial", "manual"].includes(r.testability)) {
      problems.push(`rubric[${i}] (${r.id}) invalid testability "${r.testability}"`);
    }
    for (const sid of r.scenarios ?? []) {
      if (!scenarioIds.has(sid)) problems.push(`rubric ${r.id} references unknown scenario ${sid}`);
    }
    if (r.testability === "manual" && !r.manual_instructions) {
      problems.push(`rubric ${r.id} is manual but has no manual_instructions`);
    }
    if (r.testability === "auto-partial" && !r.manual_instructions) {
      // Without instructions the unverifiable half silently earns full weight
      // from the UI-observable half alone.
      problems.push(`rubric ${r.id} is auto-partial but has no manual_instructions for the manual half`);
    }
    const dupId = raw.rubric.filter((x: any) => x.id === r.id).length;
    if (dupId > 1) problems.push(`rubric id ${r.id} appears ${dupId} times in this spec`);
    return r as RubricItem;
  });

  if (problems.length) {
    throw new Error(`Spec ${file} invalid:\n  - ${problems.join("\n  - ")}`);
  }
  return { ...raw, scenarios, rubric } as Spec;
}

export function selectSpecs(
  specs: Spec[],
  areas: string[] | undefined,
  includeOptional: boolean,
): Spec[] {
  if (areas && areas.length > 0) {
    const bySlug = new Map(specs.map((s) => [s.area, s]));
    areas = [...new Set(areas)];
    return areas.map((a) => {
      const s = bySlug.get(a);
      if (!s) {
        throw new Error(`Unknown area "${a}". Known: ${specs.map((x) => x.area).join(", ")}`);
      }
      return s;
    });
  }
  return specs.filter((s) => !s.optional || includeOptional);
}
