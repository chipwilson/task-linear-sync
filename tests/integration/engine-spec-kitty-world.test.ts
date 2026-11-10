/**
 * T021 [017 polish] — SC-005 engine parity over the committed `spec-kitty-basic` world.
 *
 * The engine suites are identity-agnostic (they drive `Unit`s through the fake
 * `Linear_Port`), so "the six identities yield the same results shape" is pinned here
 * against a pre-existing world: the `spec-kitty` world's plan, apply, idempotent
 * re-plan, and total-restoration rollback must match the SAME result shapes the five
 * pre-existing identities produce (the `completion-toggle` world is the reference).
 *
 * The parameterized plan/apply/rollback flows exercised are the exact engine seams
 * (`buildSyncPlan` → `applySyncPlan` → `buildSyncPlan` → `rollbackRun`) the scenario
 * worlds (`rollback-full`, `first-run-bootstrap`, …) drive.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { GateRequest } from "task-linear-sync/gates";

import { ExitCode, runCli } from "../../src/cli/index.js";
import { buildCliWorld } from "../helpers/cli-harness.js";
import { attachEngine, buildWorld, callsOf, type EngineWorld } from "../helpers/engine-harness.js";
import { createSyncEngine } from "../../src/engine/create.js";

const engineWorldDir = (name: string): string =>
  fileURLToPath(new URL(`../../../tests/fixtures/engine/worlds/${name}/`, import.meta.url));

/** Raw byte walk of the temp repo (byte-equality unit — engine-properties precedent). */
function walkFiles(dir: string, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const dirent of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = prefix === "" ? dirent.name : `${prefix}/${dirent.name}`;
    if (dirent.isDirectory()) Object.assign(out, walkFiles(join(dir, dirent.name), rel));
    else out[rel] = readFileSync(join(dir, dirent.name)).toString("base64");
  }
  return out;
}

function gates(world: EngineWorld, lowConfidencePresent: boolean): GateRequest {
  return {
    applyFlag: true,
    confirmationKey: world.config.confirmationKey,
    acceptLowConfidence: lowConfidencePresent,
  };
}

test("engine spec-kitty world: plan/apply/re-plan/rollback match the pre-existing worlds' results shape (SC-005)", async () => {
  const w = await buildWorld("spec-kitty-basic");
  try {
    const preRunFiles = walkFiles(w.repositoryRoot);
    const engine = attachEngine(w, createSyncEngine, { keyProvider: w.keyProvider });

    // 1. PLAN — bootstrap: the eight printed subtasks, claimed as spec-kitty.
    const plan = await engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot });
    assert.equal(plan.entries.length, 8, "both missions — all eight subtasks planned");
    assert.ok(plan.entries.every((e) => e.frameworkId === "spec-kitty"));
    assert.ok(plan.entries.every((e) => e.decision === "create"));

    // 2. APPLY — same result fields as every scenario world (status, runId, operations).
    const applied = await engine.applySyncPlan(plan, gates(w, plan.lowConfidencePresent));
    assert.equal(applied.status, "applied");
    assert.equal(typeof applied.runId, "string");
    assert.ok(applied.operations.length > 0, "operations journaled");
    assert.ok(applied.operations.every((o) => o.status !== "failed"));
    assert.equal(callsOf(w, "createIssue").length, 8, "one create per task");

    // 3. RE-PLAN — full sync is a fixpoint (SC-002 currency).
    const engine2 = attachEngine(w, createSyncEngine, { keyProvider: w.keyProvider });
    const plan2 = await engine2.buildSyncPlan({ repositoryRoot: w.repositoryRoot });
    assert.equal(plan2.entries.length, 8);
    assert.deepEqual(
      plan2.entries.filter((e) => e.decision === "create" || e.decision === "update"),
      [],
      "zero pending actions after a full sync",
    );

    // 4. ROLLBACK — total restoration: repo bytes and the tracker return to the seed
    //    (created issues are archived, NEVER deleted — FR-013/016 semantics).
    const rollback = await engine2.rollbackRun(applied.runId);
    assert.ok(rollback.reversedOperations > 0, "journaled operations reversed");
    assert.deepEqual(walkFiles(w.repositoryRoot), preRunFiles, "every repo file byte-equal to the pre-run walk");
    assert.equal(w.fake.world.issues.size, 8, "created issues are never deleted…");
    assert.ok(
      [...w.fake.world.issues.values()].every((i) => i.archived === true),
      "…they are all archived by the rollback (FR-013/016)",
    );
  } finally {
    await w.dispose();
  }
});

test("engine spec-kitty world: results SHAPE equals a pre-existing identity's world (SC-005)", async () => {
  const kitty = await buildWorld("spec-kitty-basic");
  const reference = await buildWorld("first-run-bootstrap");
  try {
    const kittyEngine = attachEngine(kitty, createSyncEngine, { keyProvider: kitty.keyProvider });
    const refEngine = attachEngine(reference, createSyncEngine, { keyProvider: reference.keyProvider });
    const kittyPlan = await kittyEngine.buildSyncPlan({ repositoryRoot: kitty.repositoryRoot });
    const refPlan = await refEngine.buildSyncPlan({ repositoryRoot: reference.repositoryRoot });

    assert.deepEqual(Object.keys(kittyPlan).sort(), Object.keys(refPlan).sort(), "plan shape identical");
    assert.ok(kittyPlan.entries.length > 0 && refPlan.entries.length > 0, "both worlds plan work");
    // Compare like with like: bootstrap CREATE entries against bootstrap CREATE entries.
    const kittyCreate = kittyPlan.entries.find((e) => e.decision === "create");
    const refCreate = refPlan.entries.find((e) => e.decision === "create");
    assert.ok(kittyCreate && refCreate, "both worlds bootstrap with creates");
    assert.deepEqual(
      Object.keys(kittyCreate!).sort(),
      Object.keys(refCreate!).sort(),
      "create-entry shape identical to a pre-existing identity's world",
    );
  } finally {
    await kitty.dispose();
    await reference.dispose();
  }
});

test("engine spec-kitty world: CLI read-only commands accept spec-kitty (plan/inventory/check shapes)", async () => {
  const w = await buildCliWorld(engineWorldDir("spec-kitty-basic"));
  try {
    const { cliContext, stdout, stderr } = w.createContext();

    const inventory = await runCli(["inventory", w.repositoryRoot], cliContext);
    assert.equal(inventory.exitCode, ExitCode.SUCCESS, stderr.join("\n"));
    assert.ok(
      stdout.some((l) => l.startsWith("kitty-specs/001-demo/tasks.md") && /tasks=\d+/.test(l)),
      `inventory lists the roll-up: ${stdout.join("\n")}`,
    );

    const plan = await runCli(["plan", w.repositoryRoot], cliContext);
    assert.equal(plan.exitCode, ExitCode.SUCCESS, stderr.join("\n"));
    const MUTATING = new Set(["createIssue", "updateIssue", "archiveIssue", "upsertAttachmentByUrl", "updateAttachment"]);
    assert.equal(
      w.world.calls.filter((c) => MUTATING.has(c.method) && c.ok !== false).length,
      0,
      "plan stays read-only",
    );

    const checkBefore = stdout.length;
    const check = await runCli(["check", w.repositoryRoot], cliContext);
    assert.ok(
      check.exitCode === ExitCode.SUCCESS || check.exitCode === ExitCode.CHECK_FINDINGS,
      `check returns a standard CI verdict code, got ${check.exitCode}`,
    );
    const summaryLines = stdout.slice(checkBefore);
    assert.equal(summaryLines.length, 1, `one CheckSummary JSON line, got: ${summaryLines.join("\n")}`);
    const summary = JSON.parse(summaryLines[0] as string) as { schemaVersion: number; counts: Record<string, number> };
    assert.equal(summary.schemaVersion, 1);
    for (const key of ["entries", "unmapped", "unresolvedConflicts", "lowConfidence"]) {
      assert.equal(typeof summary.counts[key], "number", `counts.${key}`);
    }
    assert.equal(summary.counts.entries, 8, "eight planned entries under the spec-kitty adapter");
  } finally {
    await w.dispose();
  }
});
