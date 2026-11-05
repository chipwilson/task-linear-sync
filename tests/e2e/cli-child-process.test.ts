/**
 * T020 [US1] — child-process drive over `task-linear-sync/cli` (research R8a):
 * `writeDriver`-generated drivers import the real CLI core (absolute dist fallback),
 * wire the fake world hermetically, and propagate the CLI exit code through a real
 * process exit. Covers quickstart plan → bootstrap across two processes sharing one
 * state directory, plus exit-code propagation for a usage error.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { cliWorldDir, writeDriver } from "../helpers/cli-harness.js";

interface DriveResult {
  status: number | null;
  out: string[];
  err: string[];
}

function drive(driverPath: string): DriveResult {
  const r = spawnSync(process.execPath, [driverPath], { encoding: "utf8", timeout: 120_000 });
  const lines = r.stdout.split("\n").filter((l) => l.length > 0);
  return {
    status: r.status,
    out: lines.filter((l) => l.startsWith("OUT|")).map((l) => l.slice(4)),
    err: lines.filter((l) => l.startsWith("ERR|")).map((l) => l.slice(4)),
  };
}

const scratch = mkdtempSync(join(tmpdir(), "tls-009-e2e-"));

test.after(() => {
  rmSync(scratch, { recursive: true, force: true });
});

test("plan → bootstrap through two real processes sharing one state dir; usage error propagates 2", () => {
  const worldDir = cliWorldDir("review-report");
  const stateDir = join(scratch, "shared-state");
  const planDriver = join(scratch, "driver-plan.mjs");
  const applyDriver = join(scratch, "driver-apply.mjs");
  const usageDriver = join(scratch, "driver-usage.mjs");

  // 1 — plan exits 0 and names both state-dir artifact paths on stdout.
  writeDriver({ driverPath: planDriver, worldDir, argv: ["plan"], stateDir });
  const planned = drive(planDriver);
  assert.equal(planned.status, 0, planned.err.join("\n"));
  const jsonPath = planned.out.find((l) => l.startsWith("report ") && l.endsWith("report.json"))?.slice(7) ?? "";
  const mdPath = planned.out.find((l) => l.startsWith("report ") && l.endsWith("report.md"))?.slice(7) ?? "";
  assert.ok(jsonPath.startsWith("/") && jsonPath.includes("/reports/"), `report.json path printed: ${jsonPath}`);
  assert.ok(mdPath.startsWith("/") && mdPath.includes("/reports/"), `report.md path printed: ${mdPath}`);
  const planId = planned.out.find((l) => l.startsWith("plan "))?.slice(5) ?? "";
  assert.match(planId, /^[0-9a-f]{64}$/);

  // 2 — bootstrap applies the stored plan from the SHARED state dir (process 2 sees
  // process 1's plan) and exits 0 with the frozen gate trio.
  writeDriver({
    driverPath: applyDriver,
    worldDir,
    argv: ["bootstrap", "--plan", planId as string, "--apply", "--confirm", "ACME", "--accept-low-confidence"],
    stateDir,
  });
  const applied = drive(applyDriver);
  assert.equal(applied.status, 0, applied.err.join("\n"));
  assert.ok(applied.out.some((l) => /applied run [0-9a-f]{64}/.test(l)), applied.out.join("\n"));

  // 3 — a usage error propagates exit code 2 through the real process exit.
  writeDriver({ driverPath: usageDriver, worldDir, argv: ["plan", "--apply"] });
  const usage = drive(usageDriver);
  assert.equal(usage.status, 2);
  assert.ok(usage.err.some((l) => l.includes("--apply")));
  assert.equal(usage.out.length, 0);
});
