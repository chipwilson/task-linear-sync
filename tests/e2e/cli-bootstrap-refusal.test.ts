/**
 * T012 [P] [US2] — real-process proof that the bootstrap state-mapping refusal
 * surfaces through the CLI as exit 3 (feature 024; C4.6, R6): a mis-configured
 * mapping name aborts BEFORE any mutation, the operator-facing stderr names the
 * offending entry, the team's available states (`name (type)`, no ids) and the
 * correction steps — and fixing the config makes the identical drive exit 0.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { cliWorldDir, writeDriver } from "../helpers/cli-harness.js";

function drive(driverPath: string): { status: number | null; out: string[]; err: string[] } {
  const r = spawnSync(process.execPath, [driverPath], { encoding: "utf8", timeout: 120_000 });
  const lines = r.stdout.split("\n").filter((l) => l.length > 0);
  return {
    status: r.status,
    out: lines.filter((l) => l.startsWith("OUT|")).map((l) => l.slice(4)),
    err: lines.filter((l) => l.startsWith("ERR|")).map((l) => l.slice(4)),
  };
}

const scratch = mkdtempSync(join(tmpdir(), "tls-024-e2e-"));

test.after(() => {
  rmSync(scratch, { recursive: true, force: true });
});

/** Same TEAM-A workflow as the world, except the `done` LANE points at a name that does not exist. */
const brokenConfig = {
  teams: {
    "TEAM-A": {
      projects: ["proj-alpha", "proj-beta", "proj-secret"],
      workflowStates: {
        backlog: "Backlog",
        todo: "Todo",
        done: "Done",
        lanes: { done: "Shipped" },
      },
    },
  },
} as const;

test("bootstrap plan refuses a phantom lane target with exit 3, one grouped report, no mutation", () => {
  const driverPath = join(scratch, "driver-broken.mjs");
  writeDriver({ driverPath, worldDir: cliWorldDir("review-report"), argv: ["plan"], config: brokenConfig });
  const run = drive(driverPath);

  assert.equal(run.status, 3, `expected CONFIGURATION_ERROR, got ${String(run.status)}\n${run.err.join("\n")}`);
  const stderr = run.err.join("\n");
  assert.match(stderr, /task state mapping validation failed/u);
  assert.match(stderr, /teams\[TEAM-A\]\.workflowStates\.lanes\.done = 'Shipped'/u);
  assert.match(stderr, /Team workflow states available: .+\(.*\)/u);
  assert.match(stderr, /Corrections:/u);
  assert.ok(!/ac000000/u.test(stderr), "state ids never reach the operator-facing error");
  assert.equal(run.out.filter((l) => /^plan /u.test(l)).length, 0, "no plan was built — nothing to apply");
});

test("the corrected configuration makes the identical drive succeed (SC-004 through the real CLI)", () => {
  const fixed = structuredClone(JSON.parse(JSON.stringify(brokenConfig)) as {
    teams: Record<string, { projects: string[]; workflowStates: Record<string, unknown> }>;
  });
  delete fixed.teams["TEAM-A"].workflowStates.lanes; // absent ⇒ the default table (done → "Done", which exists)
  const driverPath = join(scratch, "driver-fixed.mjs");
  writeDriver({ driverPath, worldDir: cliWorldDir("review-report"), argv: ["plan"], config: fixed });
  const run = drive(driverPath);
  assert.equal(run.status, 0, run.err.join("\n"));
  assert.ok(run.out.some((l) => l.startsWith("plan ")), "the plan builds once every mapped name exists");
});
