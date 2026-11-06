/**
 * T032 [US2] — read-only violation aborts (FR-005, SC-003): mutation attempts fired from
 * inside `plan` (an `updateIssue` during a read call) and during report wiring (a
 * `writeJson("sync-state.json")`) meet the ReadOnlyGuard and abort with
 * `ReadOnlyViolationError` naming the attempt (exit 5) — zero fake-port mutations, state
 * dir and repo tree byte-identical. The same attempts on the `inventory` and
 * `discover-metadata` lanes (allowed prefixes `[]`) abort identically; those lanes
 * compose the guard eagerly, so the attempt is refused at engine-wiring time.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { ExitCode, runCli } from "../../src/cli/index.js";
import { createSyncEngine } from "../../src/engine/index.js";
import type { EngineDependencies } from "../../src/ports/engine.js";
import { buildCliWorld, hashTree, makeRoguePort, type CliWorld } from "../helpers/cli-harness.js";

const MUTATING_METHODS = new Set([
  "createIssue",
  "updateIssue",
  "archiveIssue",
  "upsertAttachmentByUrl",
  "updateAttachment",
]);

/** Post-abort assertions: exit 5, attempt named, nothing written or mutated. */
function assertAborted(
  w: CliWorld,
  exitCode: number,
  stderr: readonly string[],
  attempt: string,
  trees: { repo: string; state: string },
): void {
  assert.equal(exitCode, ExitCode.RUN_ABORTED, stderr.join("\n"));
  const err = stderr.join("\n");
  assert.match(err, /read-only/i);
  assert.ok(err.includes(attempt), `stderr names the attempt '${attempt}': ${err}`);
  assert.equal(w.world.calls.filter((c) => MUTATING_METHODS.has(c.method) && c.ok !== false).length, 0);
  assert.equal(hashTree(w.repositoryRoot), trees.repo);
  assert.equal(hashTree(w.stateDir), trees.state);
}

/** `makeEngine` override that captures the GUARDED deps the runCli composition produced. */
function captureEngine(captured: { deps?: EngineDependencies }, w: CliWorld) {
  return (deps: EngineDependencies) => {
    captured.deps = deps;
    return createSyncEngine(deps, { keyProvider: w.keyProvider });
  };
}

async function withWorld<T>(name: string, fn: (w: CliWorld) => Promise<T>): Promise<T> {
  const w = await buildCliWorld(name);
  try {
    return await fn(w);
  } finally {
    await w.dispose();
  }
}

function deps(captured: { deps?: EngineDependencies }): EngineDependencies {
  assert.ok(captured.deps, "runCli must compose guarded deps before building the engine");
  return captured.deps;
}

test("updateIssue attempt from inside a plan read call aborts with exit 5", async () => {
  await withWorld("review-report", async (w) => {
    const trees = { repo: hashTree(w.repositoryRoot), state: hashTree(w.stateDir) };
    const captured: { deps?: EngineDependencies } = {};
    const rogue = makeRoguePort(w.port);
    // At the first READ member the engine invokes (discoverMetadata), attempt a mutation
    // through the GUARDED port — the guard must refuse before the attempt reaches the fake.
    rogue.armOnce(() => {
      deps(captured).port.updateIssue("acme-1", { title: "sneaky" });
    });
    const { cliContext, stderr } = w.createContext({
      makePort: () => rogue,
      makeEngine: captureEngine(captured, w),
    });
    const outcome = await runCli(["plan", w.repositoryRoot], cliContext);
    assert.equal(rogue.attempts, 1, "injection fired exactly once");
    assertAborted(w, outcome.exitCode, stderr, "updateIssue", trees);
  });
});

test("writeJson(sync-state.json) attempt during report wiring aborts with exit 5", async () => {
  await withWorld("review-report", async (w) => {
    const trees = { repo: hashTree(w.repositoryRoot), state: hashTree(w.stateDir) };
    const captured: { deps?: EngineDependencies } = {};
    const rogue = makeRoguePort(w.port);
    rogue.armOnce(() => {
      void deps(captured).state.writeJson("sync-state.json", { sneaky: true });
    });
    const { cliContext, stderr } = w.createContext({
      makePort: () => rogue,
      makeEngine: captureEngine(captured, w),
    });
    const outcome = await runCli(["plan", w.repositoryRoot], cliContext);
    assert.equal(rogue.attempts, 1);
    assertAborted(w, outcome.exitCode, stderr, "writeJson('sync-state.json')", trees);
  });
});

for (const command of ["inventory", "discover-metadata"] as const) {
  test(`${command} (allowed prefixes []) refuses the same attempts identically`, async () => {
    await withWorld("review-report", async (w) => {
      for (const attempt of ["port", "state"] as const) {
        const trees = { repo: hashTree(w.repositoryRoot), state: hashTree(w.stateDir) };
        const { cliContext, stderr } = w.createContext({
          // Read-only lanes compose the guard EAGERLY, so the guard-wrapped deps are
          // visible at engine-wiring time — the attempt there stands in for a mid-run
          // rogue call on a lane whose handler performs no port reads (inventory).
          makeEngine: (d) => {
            if (attempt === "port") {
              d.port.updateIssue("acme-1", { title: "sneaky" });
            } else {
              void d.state.writeJson("sync-state.json", { sneaky: true });
            }
            return createSyncEngine(d, { keyProvider: w.keyProvider });
          },
        });
        const outcome = await runCli([command, w.repositoryRoot], cliContext);
        assertAborted(
          w,
          outcome.exitCode,
          stderr,
          attempt === "port" ? "updateIssue" : "writeJson('sync-state.json')",
          trees,
        );
      }
    });
  });
}
