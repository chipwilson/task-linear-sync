/**
 * T018 [US1] — rollback refusal posture (FR-004): unjournaled rollbacks REFUSE with the
 * frozen `MANIFEST_UNJOURNALED` code, zero mutations, and byte-identical repo + state
 * trees — whether journaling is disabled via engine options or the run was never
 * journaled. A journaled apply then rolls back cleanly through the engine (SC-002).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { createSyncEngine } from "task-linear-sync/engine";
import type { EngineDependencies } from "task-linear-sync/ports";
import { ExitCode, runCli } from "../../src/cli/index.js";
import { buildCliWorld, hashTree, type CliWorld } from "../helpers/cli-harness.js";

const pkgRoot = fileURLToPath(new URL("../../../", import.meta.url));
const engineWorld = (name: string): string => join(pkgRoot, "tests", "fixtures", "engine", "worlds", name);

const MUTATING_METHODS = new Set([
  "createIssue",
  "updateIssue",
  "archiveIssue",
  "upsertAttachmentByUrl",
  "updateAttachment",
]);

function mutatingCalls(w: CliWorld): number {
  return w.world.calls.filter((c) => MUTATING_METHODS.has(c.method) && c.ok !== false).length;
}

async function withWorld<T>(nameOrDir: string, fn: (w: CliWorld) => Promise<T>): Promise<T> {
  const w = await buildCliWorld(nameOrDir);
  try {
    return await fn(w);
  } finally {
    await w.dispose();
  }
}

function onlyPlanId(w: CliWorld): string {
  const plans = readdirSync(join(w.stateDir, "plans"));
  assert.equal(plans.length, 1);
  return (plans[0] as string).replace(/\.json$/, "");
}

test("journaling disabled: the apply proceeds unjournaled but rollback refuses 4 with zero effects", async () => {
  await withWorld(engineWorld("first-run-bootstrap"), async (w) => {
    // Engine override: journaling off (frozen MANIFEST_UNJOURNALED posture).
    const { cliContext, stdout, stderr } = w.createContext({
      makeEngine: (deps: EngineDependencies) =>
        createSyncEngine(deps, { keyProvider: w.keyProvider, journalingEnabled: false }),
    });
    assert.equal((await runCli(["plan", w.repositoryRoot], cliContext)).exitCode, ExitCode.SUCCESS, stderr.join("\n"));
    const planId = onlyPlanId(w);
    assert.equal(
      (
        await runCli(
          ["bootstrap", w.repositoryRoot, "--plan", planId, "--apply", "--confirm", "ACME", "--accept-low-confidence"],
          cliContext,
        )
      ).exitCode,
      ExitCode.SUCCESS,
      stderr.join("\n"),
    );
    const runId = /applied run ([0-9a-f]{64})/.exec(stdout.join("\n"))?.[1];
    assert.ok(runId, stdout.join("\n"));

    const repoBefore = hashTree(w.repositoryRoot);
    const stateBefore = hashTree(w.stateDir);
    const mutationsBefore = mutatingCalls(w);
    const outcome = await runCli(["rollback", w.repositoryRoot, runId as string], cliContext);
    assert.equal(outcome.exitCode, ExitCode.GATE_REFUSED, stderr.join("\n"));
    assert.match(stderr.join("\n"), /MANIFEST_UNJOURNALED/);
    assert.equal(mutatingCalls(w), mutationsBefore, "refused rollback must not touch the tracker");
    assert.equal(hashTree(w.repositoryRoot), repoBefore, "refused rollback must not touch the repo");
    assert.equal(hashTree(w.stateDir), stateBefore, "refused rollback must not touch the state dir");
  });
});

test("journaling enabled but the runId has no journal: refusal 4 naming MANIFEST_UNJOURNALED", async () => {
  await withWorld("review-report", async (w) => {
    const repoBefore = hashTree(w.repositoryRoot);
    const stateBefore = hashTree(w.stateDir);
    const { cliContext, stderr } = w.createContext();
    const outcome = await runCli(["rollback", w.repositoryRoot, "a".repeat(64)], cliContext);
    assert.equal(outcome.exitCode, ExitCode.GATE_REFUSED, stderr.join("\n"));
    assert.match(stderr.join("\n"), /MANIFEST_UNJOURNALED/);
    assert.equal(mutatingCalls(w), 0);
    assert.equal(hashTree(w.repositoryRoot), repoBefore);
    assert.equal(hashTree(w.stateDir), stateBefore);
  });
});

test("SC-002: a journaled apply then `rollback <runId>` exits 0 through the engine reversal", async () => {
  await withWorld(engineWorld("rollback-full"), async (w) => {
    const { cliContext, stdout, stderr } = w.createContext();
    assert.equal((await runCli(["plan", w.repositoryRoot], cliContext)).exitCode, ExitCode.SUCCESS, stderr.join("\n"));
    const planId = onlyPlanId(w);
    assert.equal(
      (
        await runCli(
          ["bootstrap", w.repositoryRoot, "--plan", planId, "--apply", "--confirm", "ACME", "--accept-low-confidence"],
          cliContext,
        )
      ).exitCode,
      ExitCode.SUCCESS,
      stderr.join("\n"),
    );
    const runId = /applied run ([0-9a-f]{64})/.exec(stdout.join("\n"))?.[1];
    assert.ok(runId);
    const mutationsAfterApply = mutatingCalls(w);
    assert.ok(mutationsAfterApply > 0);

    const outcome = await runCli(["rollback", w.repositoryRoot, runId as string], cliContext);
    assert.equal(outcome.exitCode, ExitCode.SUCCESS, stderr.join("\n"));
    assert.match(stdout.join("\n"), /rolled back run [0-9a-f]{64}/);
    assert.ok(mutatingCalls(w) > mutationsAfterApply, "the reversal itself mutates via the engine");
  });
});
