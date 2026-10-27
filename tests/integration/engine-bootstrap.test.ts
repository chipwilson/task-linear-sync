/**
 * T018 [US1] — Bootstrap-mode integration test through the frozen `SyncEngine` interface
 * (quickstart 1.1; contracts/engine-pipeline.md `buildSyncPlan` stages 1–7 + gated
 * `applySyncPlan`; US1 AC1; SC-001/SC-002 at the plan boundary).
 *
 * RED BY DESIGN: this file COMPILES and FAILS at runtime until the wiring lanes land —
 * `createSyncEngine` composes but every frozen method throws `EngineError` ("not wired")
 * while `buildSyncPlan` awaits T024/T026 and `applySyncPlan` awaits T043/T045. The
 * structure needs NO edits when those lanes merge: expectations come from the worlds'
 * `expected/plan.json` classification tables + `expected/checkpoint-seed.json` and from
 * the frozen contracts — never re-derived inline (small inline expectations only where a
 * world ships no golden, e.g. the sync-default discriminator in test 1).
 *
 * Asserts (all through `attachEngine(w, createSyncEngine, { keyProvider: w.keyProvider })`):
 *  1. no checkpoints ⇒ the plan runs in bootstrap mode driving `bootstrapConflictMap`
 *     (observable via entry reasons per `first-run-bootstrap/expected/plan.json`: the
 *     `bootstrap-no-checkpoint` label plus the bootstrap action `overwrite-linear`, NOT
 *     the sync-map default);
 *  2. meaningful difference ⇒ `both-changed`; normalized-identical ⇒ no conflict (AC1,
 *     world tasks 1.1/1.2; unmatched 1.3 ⇒ create outside the conflict machinery);
 *  3. `formatting-noise` world ⇒ zero conflicts AND zero planned rewrites in BOTH modes
 *     (bootstrap and checkpoint-seeded sync), byte-stable files (SC-002);
 *  4. full bootstrap CYCLE (plan → gated apply with the frozen `GateRequest`: applyFlag +
 *     world-config `confirmationKey` + low-confidence acceptance + plan reference — fails
 *     today at the apply seam, passes when T043/T045 land): a second `buildSyncPlan` over
 *     unchanged inputs reports zero pending changes (SC-001 at the plan boundary);
 *  5. stage-7 persistence: `plans/<planId>.json` (StoredPlan) and exactly one
 *     `reports/<runId>/report.json` validating against the frozen
 *     `plan-report.schema.json` (T012/T025 minimal-validator posture reused from
 *     `tests/contract/report-schema.test.ts`), paired `report.md` included.
 *
 * Hermetic (constitution VI): 007 fake `LinearPort` worlds via the shared harness, temp
 * state directory, injected fixed clock, placeholder identities only (Principle III).
 * Titles prefixed `engine-bootstrap —` (tier pattern `engine-bootstrap|engine-conflict-freeze`).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  Checkpoint,
  Plan,
  PlanDecision,
  PlanTaskEntry,
  StoredPlan,
} from "task-linear-sync/domain";
import type { GateRequest } from "task-linear-sync/gates";

import {
  attachEngine,
  buildWorld,
  fixtureFile,
  hasCheckpoints,
  readCheckpointStore,
  readExpectedJson,
  seedCheckpoints,
  sha256Hex,
  type EngineWorld,
} from "../helpers/engine-harness.js";

import { createSyncEngine } from "../../src/engine/create.js";

// ───────────────────────────────────────────────────────── world expectation tables

/** One entry of `expected/plan.json` (classification table authored by the worlds lane). */
interface ExpectedPlanEntry {
  readonly taskUuid: string;
  readonly localTaskId: string;
  readonly title: string;
  /** Issue KEY (placeholder ACME-*) resolved to the world seed id, or null ⇒ unmatched. */
  readonly matchedIssueKey: string | null;
  readonly decision: PlanDecision;
  /** null ⇒ NO description conflict expected; else the exact conflict type label. */
  readonly descriptionConflict: string | null;
  /** Conflict-resolution-matrix action expected in the entry reasons (bootstrap map). */
  readonly bootstrapMapAction?: string;
  /** Substrings that MUST appear across the entry reasons (FR-005 machine labels). */
  readonly reasonIncludes?: readonly string[];
  readonly expectedMarkdownChanges?: readonly string[];
  readonly note?: string;
}

interface ExpectedPlan {
  readonly world: string;
  readonly mode?: "bootstrap" | "sync";
  readonly modeNote?: string;
  readonly entries: readonly ExpectedPlanEntry[];
  readonly reportNotes?: Readonly<Record<string, unknown>>;
}

/** The world seed under test — only the issue key→id map is needed for plan-entry checks. */
interface WorldSeed {
  readonly issues?: ReadonlyArray<{ readonly id: string; readonly key: string }>;
}

function issueIdForKey(world: EngineWorld, key: string): string {
  const seed = JSON.parse(readFileSync(fixtureFile(world, "world.json"), "utf8")) as WorldSeed;
  const issue = (seed.issues ?? []).find((i) => i.key === key);
  assert.ok(issue, `world seed for issue key ${key} (expected/plan.json ↔ world.json pairing)`);
  return issue!.id;
}

function entryFor(plan: Plan, taskUuid: string, localTaskId: string): PlanTaskEntry {
  const entry = plan.entries.find((e) => e.taskUuid === taskUuid);
  assert.ok(entry, `plan entry for task ${localTaskId} (${taskUuid}) — plan.json golden`);
  return entry!;
}

/** Conflict LABELS only (`description-conflict:<type>`); `no-description-conflict` is not one. */
function conflictLabels(entry: PlanTaskEntry): readonly string[] {
  return entry.reasons.filter((r) => r.includes("description-conflict:"));
}

/**
 * Assert the plan against the world's `expected/plan.json` classification table: entry
 * count, per-task decision, match identity, conflict label presence/absence, FR-005
 * reason substrings, and planned-rewrite lists where the golden provides them.
 */
function assertMatchesExpectedPlan(plan: Plan, expected: ExpectedPlan, world: EngineWorld): void {
  assert.equal(expected.world, world.name, "golden belongs to this world");
  assert.equal(plan.entries.length, expected.entries.length, "plan entry count");
  for (const exp of expected.entries) {
    const entry = entryFor(plan, exp.taskUuid, exp.localTaskId);
    assert.equal(entry.decision, exp.decision, `decision for task ${exp.localTaskId} (${exp.note ?? ""})`);

    if (exp.matchedIssueKey === null) {
      assert.equal(entry.match, undefined, `task ${exp.localTaskId} must be unmatched`);
    } else {
      assert.equal(
        entry.match?.issueId,
        issueIdForKey(world, exp.matchedIssueKey),
        `task ${exp.localTaskId} must match ${exp.matchedIssueKey}`,
      );
    }

    if (exp.matchedIssueKey !== null) {
      // Matched tasks always carry the explicit FR-005 verdict label (classify.ts
      // vocabulary, pinned by T013); create entries live outside the conflict machinery.
      if (exp.descriptionConflict === null) {
        assert.deepEqual(conflictLabels(entry), [], `no conflict label for ${exp.localTaskId} (${exp.note ?? ""})`);
        assert.ok(
          entry.reasons.includes("no-description-conflict"),
          `explicit no-conflict label for ${exp.localTaskId} (FR-005)`,
        );
      } else {
        assert.ok(
          conflictLabels(entry).some((r) => r.includes(exp.descriptionConflict!)),
          `conflict label ${exp.descriptionConflict} for ${exp.localTaskId}`,
        );
      }
    } else {
      assert.deepEqual(conflictLabels(entry), [], `create entry ${exp.localTaskId} carries no conflict label`);
    }

    for (const needle of exp.reasonIncludes ?? []) {
      assert.ok(
        entry.reasons.some((r) => r.includes(needle)),
        `a reason for ${exp.localTaskId} must mention "${needle}" (FR-005): ${entry.reasons.join(", ")}`,
      );
    }

    if (exp.expectedMarkdownChanges !== undefined) {
      assert.deepEqual(
        [...entry.expectedMarkdownChanges],
        [...exp.expectedMarkdownChanges],
        `planned rewrites for ${exp.localTaskId} (SC-002: zero)`,
      );
    }
  }
}

/**
 * Mode observability at the plan boundary (the frozen `Plan` shape has no mode field —
 * observability is via classify's reason vocabulary, pinned by T013/T020): matched
 * bootstrap runs label every entry `bootstrap-no-checkpoint`; sync runs never do.
 */
function assertModeLabels(plan: Plan, mode: "bootstrap" | "sync"): void {
  const matched = plan.entries.filter((e) => e.match !== undefined);
  assert.ok(matched.length > 0, "world expects at least one matched task");
  for (const entry of matched) {
    const bootstrapLabel = entry.reasons.includes("bootstrap-no-checkpoint");
    if (mode === "bootstrap") {
      assert.ok(bootstrapLabel, `bootstrap run must label ${entry.taskUuid} bootstrap-no-checkpoint`);
    } else {
      assert.ok(!bootstrapLabel, `sync run must NOT label ${entry.taskUuid} bootstrap-no-checkpoint`);
    }
  }
}

/** The frozen GateRequest satisfying every gate: flag + exact confirmation key + plan reference. */
function passingGates(world: EngineWorld, plan: Plan): GateRequest {
  return {
    applyFlag: true,
    confirmationKey: world.config.confirmationKey, // exact per world config (US2 AC "ACME")
    acceptLowConfidence: plan.lowConfidencePresent, // accept iff the plan actually needs it
    planReference: plan.planId, // persisted plans/<planId>.json (stage 7)
  };
}

// ───────────────────────────────────────────────── report schema validation (T012/T025 precedent)

const pkgRoot = fileURLToPath(new URL("../../../", import.meta.url));
const reportSchema = JSON.parse(
  readFileSync(
    new URL("specs/002-core-domain-contracts/contracts/plan-report.schema.json", `file://${pkgRoot}`),
    "utf8",
  ),
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

// ─────────────────────────────────────────────────────────────────────────── tests

test("engine-bootstrap — first-run-bootstrap: no checkpoints ⇒ bootstrap mode driving bootstrapConflictMap (AC1)", async () => {
  const w = await buildWorld("first-run-bootstrap");
  try {
    assert.equal(await hasCheckpoints(w), false, "world must start with NO checkpoints (data-model §2)");
    const engine = attachEngine(w, createSyncEngine, { keyProvider: w.keyProvider });

    const plan = await engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot });
    const expected = readExpectedJson<ExpectedPlan>(w, "plan.json");
    assert.equal(expected.mode, "bootstrap", "golden pins the expected mode");
    assertMatchesExpectedPlan(plan, expected, w);

    // Assertion 1+2 (world table): bootstrap mode is observable on every matched entry,
    // and the BOTH-CHANGED action comes from the BUILT-IN BOOTSTRAP map.
    assertModeLabels(plan, "bootstrap");
    for (const exp of expected.entries) {
      if (exp.bootstrapMapAction === undefined) continue;
      const entry = entryFor(plan, exp.taskUuid, exp.localTaskId);
      assert.ok(
        entry.reasons.some((r) => r.includes(exp.bootstrapMapAction!)),
        `bootstrapConflictMap action "${exp.bootstrapMapAction}" for ${exp.localTaskId} (matrix §1)`,
      );
      // Discriminator against the sync built-in (both-changed ⇒ report-only in
      // syncConflictDefaults): its presence would prove the WRONG map drove the plan.
      assert.ok(
        !entry.reasons.some((r) => r.includes("report-only")),
        `bootstrap plan must not carry the sync-map default for ${exp.localTaskId}`,
      );
    }
  } finally {
    await w.dispose();
  }
});

test("engine-bootstrap — formatting-noise (bootstrap, no checkpoints): zero conflicts, zero planned rewrites (SC-002)", async () => {
  const w = await buildWorld("formatting-noise");
  try {
    assert.equal(await hasCheckpoints(w), false, "no seeding ⇒ bootstrap classification");
    const engine = attachEngine(w, createSyncEngine, { keyProvider: w.keyProvider });

    const tasksMd = join(w.repositoryRoot, "specs", "sync-demo", "tasks.md");
    const bytesBefore = sha256Hex(readFileSync(tasksMd, "utf8"));

    const plan = await engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot });
    const expected = readExpectedJson<ExpectedPlan>(w, "plan.json");
    assertMatchesExpectedPlan(plan, expected, w);
    assertModeLabels(plan, "bootstrap");

    // SC-002 at the plan boundary: no entry is a conflict/rewrite of any kind and the
    // planned rewrites are empty per golden; the repo file stays byte-identical.
    assert.deepEqual(plan.entries.filter((e) => e.decision !== "no-change"), [], "zero pending changes");
    assert.equal(sha256Hex(readFileSync(tasksMd, "utf8")), bytesBefore, "plan must not touch repo bytes");
  } finally {
    await w.dispose();
  }
});

test("engine-bootstrap — formatting-noise (sync, seeded checkpoints): normalized-identical still means zero conflicts (SC-002)", async () => {
  const w = await buildWorld("formatting-noise");
  try {
    // Pinned seeding pattern: expected/checkpoint-seed.json (Record<taskUuid, Checkpoint>,
    // hashes precomputed over the normalized baselines — PLAYBOOK decision 3).
    const seed = readExpectedJson<Record<string, Checkpoint>>(w, "checkpoint-seed.json");
    await seedCheckpoints(w, seed);
    assert.equal(await hasCheckpoints(w), true, "seeding flips mode to sync (data-model §2)");
    const engine = attachEngine(w, createSyncEngine, { keyProvider: w.keyProvider });

    const plan = await engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot });
    const expected = readExpectedJson<ExpectedPlan>(w, "plan.json");
    assertMatchesExpectedPlan(plan, expected, w);
    assertModeLabels(plan, "sync");
    assert.deepEqual(plan.entries.filter((e) => e.decision !== "no-change"), [], "zero pending changes");
  } finally {
    await w.dispose();
  }
});

test("engine-bootstrap — full bootstrap cycle: gated apply then second plan reports zero pending changes (SC-001)", async () => {
  const w = await buildWorld("first-run-bootstrap");
  try {
    const engine = attachEngine(w, createSyncEngine, { keyProvider: w.keyProvider });

    // Plan 1: the bootstrap pending set (create + conflict + no-change per golden table).
    const plan1 = await engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot });
    const expected = readExpectedJson<ExpectedPlan>(w, "plan.json");
    assertMatchesExpectedPlan(plan1, expected, w);
    const pending1 = plan1.entries.filter((e) => e.decision !== "no-change");
    assert.equal(pending1.length, 2, "bootstrap plan carries the create + conflict work");

    // Full CYCLE: gated apply with the frozen GateRequest — gates satisfied per world
    // config (applyFlag, exact confirmationKey "ACME", low-confidence acceptance as the
    // plan requires, planReference to the persisted plan). Red at the apply seam until
    // T043/T045 wire applySyncPlan; no test edits needed afterwards.
    const result = await engine.applySyncPlan(plan1, passingGates(w, plan1));
    assert.deepEqual(result.gateFailures, [], "gates are satisfied ⇒ no refusals");
    assert.equal(result.status, "applied", `apply must complete (got ${result.status})`);

    // Checkpoint store written as the final apply step (data-model §1): one checkpoint
    // per task of the golden table — that is what flips the next plan to sync mode.
    const store = await readCheckpointStore(w);
    assert.ok(store, "checkpoint store exists after a successful apply");
    assert.deepEqual(
      Object.keys(store!.checkpoints).sort(),
      expected.entries.map((e) => e.taskUuid).sort(),
      "every bootstrapped task has a checkpoint",
    );

    // SC-001 at the plan boundary: second build over UNCHANGED inputs ⇒ zero pending
    // changes, zero conflict labels, sync mode (no bootstrap label).
    const plan2 = await engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot });
    assert.equal(plan2.entries.length, expected.entries.length, "same task set re-planned");
    assert.deepEqual(
      plan2.entries.filter((e) => e.decision !== "no-change"),
      [],
      "SC-001: after a full bootstrap cycle nothing remains pending",
    );
    for (const exp of expected.entries) {
      const entry = entryFor(plan2, exp.taskUuid, exp.localTaskId);
      assert.deepEqual(conflictLabels(entry), [], `task ${exp.localTaskId} must be conflict-free post-cycle`);
      assert.deepEqual([...entry.expectedMarkdownChanges], [], `task ${exp.localTaskId} must be rewrite-free`);
    }
    assertModeLabels(plan2, "sync");
  } finally {
    await w.dispose();
  }
});

test("engine-bootstrap — plan persists: plans/<planId>.json + reports/<runId>/report.json conform to the frozen schema (stage 7)", async () => {
  const w = await buildWorld("first-run-bootstrap");
  try {
    const engine = attachEngine(w, createSyncEngine, { keyProvider: w.keyProvider });
    const plan = await engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot });

    // plans/<planId>.json — the StoredPlan the Plan_Reference gate reads back.
    const planPath = join(w.stateDir, "plans", `${plan.planId}.json`);
    assert.ok(existsSync(planPath), `persisted plan at plans/${plan.planId}.json (state dir only)`);
    const stored = JSON.parse(readFileSync(planPath, "utf8")) as StoredPlan;
    assert.equal(stored.plan.planId, plan.planId, "stored plan round-trips by planId");
    assert.equal(typeof stored.storedAt, "string", "StoredPlan carries an injected-clock storedAt");

    // reports/<runId>/report.json — exactly one deterministic plan-report run per build.
    const reportsDir = join(w.stateDir, "reports");
    assert.ok(existsSync(reportsDir), "reports/ directory exists after plan build");
    const runDirs = readdirSync(reportsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    assert.equal(runDirs.length, 1, `exactly one report run dir, found: ${runDirs.join(", ")}`);
    const runDir = join(reportsDir, runDirs[0]);

    const reportPath = join(runDir, "report.json");
    assert.ok(existsSync(reportPath), "reports/<runId>/report.json exists");
    const report = JSON.parse(readFileSync(reportPath, "utf8")) as unknown;
    const errors: string[] = [];
    validateInto(report, reportSchema, reportSchema, "$", errors);
    assert.deepEqual(errors, [], `report.json must conform to plan-report.schema.json:\n${errors.join("\n")}`);
    assert.equal((report as { planId: string }).planId, plan.planId, "report names the plan it reports");
    assert.ok(existsSync(join(runDir, "report.md")), "paired sanitized report.md written");

    // Plans/reports only — the read-only pipeline never writes a run marker (R13).
    assert.equal(existsSync(join(w.stateDir, "last-run.json")), false, "plan builds never touch last-run.json");
  } finally {
    await w.dispose();
  }
});
