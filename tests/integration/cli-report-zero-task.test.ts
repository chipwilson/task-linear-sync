/**
 * T031 [US2] — zero-task spec edge case (spec 009 §Edge cases): on the `zero-task/`
 * world both artifacts render with empty task sections and a PASSING security-assertions
 * block; `plan` exits 0; `check` exits 0 (no findings) and its JSON summary reports
 * zero counts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { ExitCode, runCli } from "../../src/cli/index.js";
import { buildCliWorld, type CliWorld } from "../helpers/cli-harness.js";

interface ReportJson {
  groups: unknown[];
  unmapped: unknown[];
  securityAssertions: { guarantee: string; status: string }[];
  [key: string]: unknown;
}

async function withWorld<T>(fn: (w: CliWorld) => Promise<T>): Promise<T> {
  const w = await buildCliWorld("zero-task");
  try {
    return await fn(w);
  } finally {
    await w.dispose();
  }
}

test("zero-task plan exits 0 and renders both artifacts with empty task sections", async () => {
  await withWorld(async (w) => {
    const { cliContext, stdout, stderr } = w.createContext();
    const outcome = await runCli(["plan", w.repositoryRoot], cliContext);
    assert.equal(outcome.exitCode, ExitCode.SUCCESS, stderr.join("\n"));

    const jsonPath = stdout.find((l) => l.startsWith("report ") && l.endsWith("report.json"))?.slice("report ".length);
    const mdPath = stdout.find((l) => l.startsWith("report ") && l.endsWith("report.md"))?.slice("report ".length);
    assert.ok(jsonPath && mdPath && existsSync(jsonPath) && existsSync(mdPath), stdout.join("\n"));

    const report = JSON.parse(readFileSync(jsonPath as string, "utf8")) as ReportJson;
    assert.deepEqual(report.groups, [], "no project groups");
    assert.deepEqual(report.unmapped, [], "no unmapped issues");
    assert.ok(report.securityAssertions.length >= 1);
    assert.deepEqual(
      report.securityAssertions.filter((a) => a.status !== "pass"),
      [],
      "security-assertions block passes on the zero-task pair",
    );

    const md = readFileSync(mdPath as string, "utf8");
    assert.ok(md.includes("_Grouped by project, then milestone."), "task-entries section present");
    assert.ok(md.includes("_(no task entries — zero-task plan)_"), md);
    assert.ok(md.includes("## Unresolved Conflicts"));
    assert.ok(md.includes("## Unmapped Issues"));
  });
});

test("zero-task check exits 0 with a zero-count CheckSummary (no findings)", async () => {
  await withWorld(async (w) => {
    const { cliContext, stdout, stderr } = w.createContext();
    const outcome = await runCli(["check", w.repositoryRoot], cliContext);
    assert.equal(outcome.exitCode, ExitCode.SUCCESS, stderr.join("\n"));
    assert.equal(stdout.length, 1);
    const summary = JSON.parse(stdout[0] as string) as { counts: Record<string, number> };
    assert.deepEqual(summary.counts, { entries: 0, unmapped: 0, unresolvedConflicts: 0, lowConfidence: 0 });
  });
});
