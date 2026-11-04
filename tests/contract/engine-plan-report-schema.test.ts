/**
 * T047 [P] — Plan/run report contract (`quickstart` "Security & determinism checks";
 * FR-005; contracts/plan-artifact.md; frozen schema
 * `specs/002-core-domain-contracts/contracts/plan-report.schema.json`).
 *
 * Asserts, through the wired engine on fixture worlds:
 *  1. every PLAN `report.json` validates against the frozen schema — the minimal
 *     dependency-free draft-2020-12 validator is the T012/T018 posture reused verbatim
 *     from `tests/contract/report-schema.test.ts` (schema is `additionalProperties:false`
 *     at every level, so validation is a structural content-exclusion proof);
 *  2. every APPLY and ROLLBACK run report validates too — a full lifecycle sweep over
 *     each `reports/<runId>/report.json` (plan report + apply run report + rollback run
 *     report, each with its paired `report.md`);
 *  3. no report artifact (JSON or Markdown, any run) contains a raw task-body line or a
 *     raw issue-description line — the body/description material comes from the fixture
 *     sources themselves (repo files + `world.json`), never hardcoded here;
 *  4. FR-005: every applied action's report entry names the conflict type + the mapped
 *     action + the reason (the `conflict:<type>` / `action:<action>` / `reason:<text>`
 *     machine labels — the schema admits no dedicated field, so the labels ARE the
 *     contract, pinned by `build.ts` stage 5 and `report.ts`).
 *
 * Hermetic (constitution VI): fake-Linear worlds via the shared harness, temp state dir,
 * fixed clock, placeholders only (Principle III). Titles prefixed
 * `engine-plan-report-schema —` (tier pattern `engine-`).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Checkpoint, Plan } from "task-linear-sync/domain";
import type { GateRequest } from "task-linear-sync/gates";

import {
  attachEngine,
  buildWorld,
  expectedFile,
  fixtureFile,
  readExpectedJson,
  seedCheckpoints,
  type EngineWorld,
} from "../helpers/engine-harness.js";

import { createSyncEngine } from "../../src/engine/create.js";

// ───────────────────────── Frozen schema + minimal validator (T012 posture, reused) ─────────────────────────

const pkgRoot = fileURLToPath(new URL("../../../", import.meta.url));
const reportSchema = JSON.parse(
  readFileSync(new URL("specs/002-core-domain-contracts/contracts/plan-report.schema.json", `file://${pkgRoot}`), "utf8"),
) as JsonSchema;

interface JsonSchema {
  type?: string | string[];
  const?: unknown;
  enum?: unknown[];
  pattern?: string;
  format?: string;
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  minItems?: number;
  maxItems?: number;
  minimum?: number;
  maxLength?: number;
  $ref?: string;
  [key: string]: unknown;
}

const DATE_TIME = /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/;

/** Minimal draft-2020-12 subset validator — same posture as the T012 precedent in
 *  `tests/contract/report-schema.test.ts` (type/const/enum/pattern/format/required/
 *  additionalProperties/properties/items/min|maxItems/minimum/maxLength/$ref). */
function validateInto(value: unknown, s: JsonSchema, root: JsonSchema, path: string, errors: string[]): void {
  if (s.$ref) {
    const m = /^#\/\$defs\/(.+)$/.exec(s.$ref);
    assert.ok(m, `unsupported $ref: ${s.$ref}`);
    const target = (root as { $defs?: Record<string, JsonSchema> }).$defs?.[m[1]];
    assert.ok(target, `unresolved $ref: ${s.$ref}`);
    validateInto(value, target, root, path, errors);
    return;
  }
  if (s.const !== undefined && value !== s.const) errors.push(`${path}: must equal ${JSON.stringify(s.const)}`);
  if (s.enum && !s.enum.includes(value)) errors.push(`${path}: must be one of ${JSON.stringify(s.enum)}`);

  const types = s.type === undefined ? undefined : Array.isArray(s.type) ? s.type : [s.type];
  if (types) {
    const rawType = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
    const actual = rawType === "number" && Number.isInteger(value as number) ? "integer" : rawType;
    const ok = types.includes(actual) || (actual === "integer" && types.includes("number"));
    if (!ok) {
      errors.push(`${path}: expected type ${types.join("|")}, got ${rawType}`);
      return;
    }
  }
  if (typeof value === "string") {
    if (s.pattern && !new RegExp(s.pattern).test(value)) errors.push(`${path}: fails pattern ${s.pattern}`);
    if (s.format === "date-time" && !DATE_TIME.test(value)) errors.push(`${path}: not date-time`);
    if (s.maxLength !== undefined && value.length > s.maxLength) errors.push(`${path}: exceeds maxLength`);
  }
  if (typeof value === "number" && s.minimum !== undefined && value < s.minimum) {
    errors.push(`${path}: below minimum ${s.minimum}`);
  }
  if (Array.isArray(value)) {
    if (s.minItems !== undefined && value.length < s.minItems) errors.push(`${path}: fewer than ${s.minItems} items`);
    if (s.maxItems !== undefined && value.length > s.maxItems) errors.push(`${path}: more than ${s.maxItems} items`);
    if (s.items) value.forEach((v, i) => validateInto(v, s.items as JsonSchema, root, `${path}[${i}]`, errors));
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    for (const key of s.required ?? []) {
      if (!(key in obj)) errors.push(`${path}: missing required '${key}'`);
    }
    const props = s.properties ?? {};
    for (const [key, v] of Object.entries(obj)) {
      if (props[key]) validateInto(v, props[key], root, `${path}.${key}`, errors);
      else if (s.additionalProperties === false) errors.push(`${path}: additional property '${key}' not allowed`);
      else if (typeof s.additionalProperties === "object") validateInto(v, s.additionalProperties, root, `${path}.${key}`, errors);
    }
  }
}

// ───────────────────────────────────────────────────────────────── harness glue

function passingGates(world: EngineWorld, plan: Plan): GateRequest {
  return {
    applyFlag: true,
    confirmationKey: world.config.confirmationKey,
    acceptLowConfidence: plan.lowConfidencePresent,
    planReference: plan.planId,
  };
}

/** Every `reports/<runId>/` directory name currently present under the state dir. */
function reportRunDirs(world: EngineWorld): string[] {
  const dir = join(world.stateDir, "reports");
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

/** Validate every report.json under reports/ against the frozen schema; return the docs. */
function validateAllReports(world: EngineWorld, context: string): Array<Record<string, unknown>> {
  const dirs = reportRunDirs(world);
  assert.ok(dirs.length > 0, `${context}: at least one report run dir exists`);
  const docs: Array<Record<string, unknown>> = [];
  for (const runId of dirs) {
    const jsonPath = join(world.stateDir, "reports", runId, "report.json");
    const mdPath = join(world.stateDir, "reports", runId, "report.md");
    assert.ok(existsSync(jsonPath), `${context}: reports/${runId}/report.json exists`);
    assert.ok(existsSync(mdPath), `${context}: paired reports/${runId}/report.md exists`);
    const doc = JSON.parse(readFileSync(jsonPath, "utf8")) as unknown;
    const errors: string[] = [];
    validateInto(doc, reportSchema, reportSchema, `$[${runId.slice(0, 12)}]`, errors);
    assert.deepEqual(errors, [], `${context}: reports/${runId}/report.json must conform to plan-report.schema.json:\n${errors.join("\n")}`);
    docs.push(doc as Record<string, unknown>);
  }
  return docs;
}

/**
 * Raw task-body / issue-description lines sourced FROM the fixture itself (never
 * hardcoded): repo-side body lines (skipping task lines, headings, blanks) plus every
 * seeded issue description line. The scanner rule keeps sentence-shaped lines only
 * (≥ 20 chars, whitespace-bearing) — the material a sanitized report must never echo.
 */
function rawContentLines(world: EngineWorld): string[] {
  const lines: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".md")) {
        for (const line of readFileSync(p, "utf8").split(/\r\n|\r|\n/u)) lines.push(line);
      }
    }
  };
  walk(fixtureFile(world, "repo"));
  const seed = JSON.parse(readFileSync(fixtureFile(world, "world.json"), "utf8")) as {
    issues?: ReadonlyArray<{ description?: string }>;
  };
  for (const issue of seed.issues ?? []) lines.push(...(issue.description ?? "").split(/\r\n|\r|\n/u));
  return lines
    .map((l) => l.trim())
    .filter(
      (l) =>
        l.length >= 20 &&
        /\s/.test(l) &&
        !/^#/.test(l) && // headings
        !/^[-*]\s+\[[ xX~]\]/.test(l) && // 004 task lines (titles are report-legal)
        !/^\d+\.\d+/.test(l),
    );
}

function reportTexts(world: EngineWorld): Array<{ file: string; text: string }> {
  const out: Array<{ file: string; text: string }> = [];
  for (const runId of reportRunDirs(world)) {
    for (const name of ["report.json", "report.md"]) {
      out.push({ file: `reports/${runId}/${name}`, text: readFileSync(join(world.stateDir, "reports", runId, name), "utf8") });
    }
  }
  return out;
}

/** Flatten the schema-shaped groups into every report task entry. */
function reportEntries(doc: Record<string, unknown>): Array<Record<string, unknown>> {
  const groups = doc["groups"] as Array<{ entries: Array<Record<string, unknown>> }>;
  return groups.flatMap((g) => g.entries);
}

// ───────────────────────────────────────────────────────────────────────── tests

test("engine-plan-report-schema — plan report.json validates against the frozen plan-report schema (stage-7 artifact)", async () => {
  const w = await buildWorld("first-run-bootstrap");
  try {
    const engine = attachEngine(w, createSyncEngine, { keyProvider: w.keyProvider });
    const plan = await engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot });
    assert.equal(reportRunDirs(w).length, 1, "one deterministic plan-report run dir per build");
    const docs = validateAllReports(w, "plan report");
    assert.equal((docs[0] as { planId: string }).planId, plan.planId, "the report names the plan it reports");
    assert.equal((docs[0] as { schemaVersion: number }).schemaVersion, 1, "frozen schemaVersion constant");
  } finally {
    await w.dispose();
  }
});

test("engine-plan-report-schema — full-lifecycle sweep: plan + apply + rollback report.json all validate (one dir per run, paired markdown)", async () => {
  const w = await buildWorld("rollback-full");
  try {
    await seedCheckpoints(w, readExpectedJson<Record<string, Checkpoint>>(w, "checkpoint-seed.json"));
    const engine = attachEngine(w, createSyncEngine, { keyProvider: w.keyProvider });

    const plan = await engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot });
    const afterPlan = reportRunDirs(w);

    const apply = await engine.applySyncPlan(plan, passingGates(w, plan));
    assert.equal(apply.status, "applied", "the journaled run completes");
    const afterApply = reportRunDirs(w);

    const rb = await engine.rollbackRun(apply.runId);
    assert.equal(rb.status, "rolled-back", "the rollback run completes");
    const afterRollback = reportRunDirs(w);

    // One NEW report dir per mutating run, on top of the plan report.
    assert.equal(afterPlan.length, 1, "plan build wrote its report");
    assert.equal(afterApply.length, afterPlan.length + 1, "apply wrote its own run report");
    assert.equal(afterRollback.length, afterApply.length + 1, "rollback wrote its own run report");

    const docs = validateAllReports(w, "lifecycle report");
    assert.equal(docs.length, 3, "three conforming report documents");
    assert.equal(
      new Set(afterRollback).size,
      afterRollback.length,
      "run ids are unique — each run reported exactly once",
    );
  } finally {
    await w.dispose();
  }
});

test("engine-plan-report-schema — no report (JSON or Markdown, any run) carries a raw task body or issue description (structural exclusion, SC-005 posture)", async () => {
  for (const worldName of ["first-run-bootstrap", "rollback-full"]) {
    const w = await buildWorld(worldName);
    try {
      if (existsSync(expectedFile(w, "checkpoint-seed.json"))) {
        await seedCheckpoints(w, readExpectedJson<Record<string, Checkpoint>>(w, "checkpoint-seed.json"));
      }
      const engine = attachEngine(w, createSyncEngine, { keyProvider: w.keyProvider });

      const sentinels = rawContentLines(w);
      assert.ok(sentinels.length > 0, `${worldName}: fixture bodies exist to scan`);

      const plan = await engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot });
      const apply = await engine.applySyncPlan(plan, passingGates(w, plan));
      assert.equal(apply.status, "applied", `${worldName}: the run completes`);
      const rb = await engine.rollbackRun(apply.runId);
      assert.equal(rb.status, "rolled-back", `${worldName}: the rollback run completes`);

      const texts = reportTexts(w);
      assert.ok(texts.length >= 6, `${worldName}: every run ships a paired JSON + Markdown report`);
      for (const { file, text } of texts) {
        for (const line of sentinels) {
          assert.equal(text.includes(line), false, `${worldName}/${file} must not echo raw content line "${line.slice(0, 60)}"`);
        }
      }
    } finally {
      await w.dispose();
    }
  }
});

test("engine-plan-report-schema — every applied conflict entry names conflict type + action + reason in the report (FR-005)", async () => {
  const w = await buildWorld("first-run-bootstrap");
  try {
    const engine = attachEngine(w, createSyncEngine, { keyProvider: w.keyProvider });
    const plan = await engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot });

    // The plan report (stage 7) — conflict entries carry the FR-005 label triple.
    const planReport = validateAllReports(w, "FR-005 plan report")[0]!;
    assertConflictLabels(planReport, "plan report");

    // APPLY run report — the APPLIED action entries keep naming type + action + reason.
    const planDirs = reportRunDirs(w);
    const apply = await engine.applySyncPlan(plan, passingGates(w, plan));
    assert.equal(apply.status, "applied", "the run with conflicts completes");
    const newDirs = reportRunDirs(w).filter((d) => !planDirs.includes(d));
    assert.equal(newDirs.length, 1, "the apply wrote exactly its own run report");
    const runReport = JSON.parse(readFileSync(join(w.stateDir, "reports", newDirs[0] as string, "report.json"), "utf8")) as Record<string, unknown>;
    const errors: string[] = [];
    validateInto(runReport, reportSchema, reportSchema, "$run", errors);
    assert.deepEqual(errors, [], "run report validates before the FR-005 label check");
    assertConflictLabels(runReport, "apply run report");
  } finally {
    await w.dispose();
  }
});

/**
 * FR-005 (matrix §2; pipeline stage 5): the frozen schema admits no dedicated conflict
 * field, so every conflict entry must name type + action + reason as machine-readable
 * reasons labels (`conflict:<type>` / `action:<action>` / `reason:<text>`).
 */
function assertConflictLabels(report: Record<string, unknown>, context: string): void {
  const conflicts = reportEntries(report).filter((e) => e["decision"] === "conflict");
  assert.ok(conflicts.length > 0, `${context}: the world ships at least one conflict entry (both-changed golden)`);
  for (const entry of conflicts) {
    const reasons = entry["reasons"] as string[];
    const typeLabel = reasons.find((r) => /^conflict:(linear-changed|spec-changed|both-changed)$/.test(r));
    const actionLabel = reasons.find((r) => /^action:(overwrite-linear|overwrite-spec|report-only|skip|prefer-newer|fail)$/.test(r));
    const reasonLabel = reasons.find((r) => /^reason:.+$/.test(r));
    assert.ok(typeLabel, `${context}: conflict entry ${entry["taskUuid"]} names its conflict type (FR-005): ${reasons.join(", ")}`);
    assert.ok(actionLabel, `${context}: conflict entry ${entry["taskUuid"]} names its mapped action (FR-005): ${reasons.join(", ")}`);
    assert.ok(reasonLabel, `${context}: conflict entry ${entry["taskUuid"]} names its reason (FR-005): ${reasons.join(", ")}`);
    assert.ok((reasonLabel as string).length > "reason:".length, `${context}: reason text is non-empty`);
  }
}
