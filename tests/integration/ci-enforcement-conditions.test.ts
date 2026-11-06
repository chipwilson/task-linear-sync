/**
 * T023 — integration: `runEnforcement` artifact-direct over the fixture corpus
 * (SC-001; quickstart Scenarios 1–3). 0 FN / 0 FP at defaults, toggle matrix,
 * thresholds, outputs map, artifact-error taxonomy, branch-classification env.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  CiArtifactError,
  resolveSettings,
  runEnforcement,
} from "task-linear-sync/ci";

import type { EnforcementDeps, EnforcementOutcome, EnforcementSettings } from "task-linear-sync/ci";
import type { SecurityScreener } from "task-linear-sync/ports";

import { copyFixtureReport } from "../helpers/ci-harness.js";
import { makeScreener } from "../helpers/test-utils.js";

function deps(log: string[][] = []): EnforcementDeps {
  return {
    screener: makeScreener() as unknown as SecurityScreener,
    env: {},
    log: (line, stream) => log.push([stream, line]),
  };
}

function settingsFor(reportPath: string, extra: Record<string, string> = {}): EnforcementSettings {
  return resolveSettings({ cwd: reportPath ? reportPath.replace(/\/[^/]+$/, "/") : "/", flags: { report: reportPath, ...extra } });
}

async function withCorpus<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "tls-013-enf-"));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const PASS_RE = /^task-linear-sync enforcement passed \(unmapped-high-confidence: \d+, unresolved-conflict-block: \d+, spec-drift: \d+\)$/;
const FAIL_RE = /^task-linear-sync enforcement failed — /;
const WARNING = "task-linear-sync enforcement warning: unresolved-conflict-block protection skipped — branch context unresolved";

test("defaults fail EXACTLY the violating fixtures and pass all clean ones (0 FN / 0 FP)", async () => {
  await withCorpus(async (dir) => {
    const expectations: Record<string, { status: "pass" | "fail"; a: number; b: number; c: number }> = {
      "clean.json": { status: "pass", a: 0, b: 0, c: 0 },
      "violates-all-three.json": { status: "fail", a: 1, b: 2, c: 3 },
      "conflict-blocks.json": { status: "pass", a: 0, b: 2, c: 0 },
      "drift-spec-changed.json": { status: "fail", a: 0, b: 0, c: 2 },
      "drift-boundaries.json": { status: "fail", a: 1, b: 0, c: 1 },
      "high-band-null-issue.json": { status: "fail", a: 1, b: 0, c: 0 },
      "unmatched-not-high.json": { status: "pass", a: 0, b: 0, c: 0 },
    };
    for (const [name, exp] of Object.entries(expectations)) {
      const path = copyFixtureReport(name, dir);
      const log: string[][] = [];
      const outcome = await runEnforcement(settingsFor(path), deps(log));
      assert.equal(outcome.status, exp.status, name);
      assert.deepEqual(
        outcome.evaluation.counts,
        { unmappedHighConfidence: exp.a, unresolvedConflictBlocks: exp.b, specDrift: exp.c },
        name,
      );
      const emitted = log.map(([, line]) => line);
      if (exp.status === "pass") {
        assert.match(emitted[0] ?? "", PASS_RE, name);
      } else {
        assert.match(emitted[0] ?? "", FAIL_RE, name);
      }
    }
  });
});

test("pass emits the screened pass line on stdout; fail emits the fail line on stderr", async () => {
  await withCorpus(async (dir) => {
    const passLog: string[][] = [];
    const pass = await runEnforcement(settingsFor(copyFixtureReport("clean.json", dir)), deps(passLog));
    assert.equal(passLog[0]?.[0], "stdout");
    assert.match(passLog[0]?.[1] ?? "", PASS_RE);
    assert.equal(pass.summaryLine, passLog[0]?.[1]);

    const failLog: string[][] = [];
    const fail = await runEnforcement(settingsFor(copyFixtureReport("violates-all-three.json", dir)), deps(failLog));
    const failLine = failLog.find(([stream]) => stream === "stderr");
    assert.equal(failLine?.[0], "stderr");
    assert.equal(
      failLine?.[1],
      "task-linear-sync enforcement failed — unmapped-high-confidence: 1; spec-drift: 3",
      "(b) is enabled but untargeted at defaults — skipped, not triggered",
    );
    assert.equal(fail.summaryLine, failLine?.[1]);
  });
});

test("branch classification: PR-shaped context fires (b); push-shaped passes with protectionSkipped warning", async () => {
  await withCorpus(async (dir) => {
    const path = copyFixtureReport("conflict-blocks.json", dir);

    const prLog: string[][] = [];
    const pr = await runEnforcement(
      settingsFor(path, { "protected-branches": "main", branch: "main" }),
      deps(prLog),
    );
    assert.equal(pr.status, "fail");
    assert.deepEqual(pr.evaluation.triggered, [{ condition: "unresolved-conflict-block", count: 2 }]);
    assert.equal(
      pr.summaryLine,
      "task-linear-sync enforcement failed — unresolved-conflict-block: 2",
    );

    const pushLog: string[][] = [];
    const push = await runEnforcement(settingsFor(path), deps(pushLog));
    assert.equal(push.status, "pass");
    assert.equal(push.evaluation.protectionSkipped, true);
    assert.equal(push.evaluation.counts.unresolvedConflictBlocks, 2);
    assert.ok(pushLog.some(([, line]) => line === WARNING), pushLog.map((l) => l[1]).join("\n"));

    // settings resolved from PR-shaped GITHUB_* env carry the same classification.
    const envSettings = resolveSettings({
      cwd: dir,
      flags: { report: path },
      env: { GITHUB_BASE_REF: "main", GITHUB_EVENT_NAME: "pull_request" },
    });
    const viaEnv = await runEnforcement(envSettings, deps());
    assert.equal(viaEnv.status, "fail", "GITHUB_BASE_REF alone protects the target");
  });
});

test("all toggles off: pass despite full-signal fixture, counts still reported", async () => {
  await withCorpus(async (dir) => {
    const path = copyFixtureReport("violates-all-three.json", dir);
    const outcome = await runEnforcement(
      settingsFor(path, {
        "fail-on-unmapped": "false",
        "fail-on-conflicts": "0",
        "fail-on-drift": "false",
        "protected-branches": "main",
        branch: "main",
      }),
      deps(),
    );
    assert.equal(outcome.status, "pass");
    assert.deepEqual(outcome.evaluation.counts, { unmappedHighConfidence: 1, unresolvedConflictBlocks: 2, specDrift: 3 });
    assert.deepEqual(outcome.evaluation.triggered, []);
  });
});

test("thresholds via settings: at-threshold passes, exceeding fails", async () => {
  await withCorpus(async (dir) => {
    const path = copyFixtureReport("drift-boundaries.json", dir);
    const at = await runEnforcement(
      settingsFor(path, { "unmapped-threshold": "1", "drift-threshold": "1" }),
      deps(),
    );
    assert.equal(at.status, "pass");
    const above = await runEnforcement(settingsFor(path), deps());
    assert.equal(above.status, "fail");
    assert.deepEqual(above.evaluation.triggered, [
      { condition: "unmapped-high-confidence", count: 1 },
      { condition: "spec-drift", count: 1 },
    ]);
  });
});

test("outcome.outputs carries the six action.md outputs", async () => {
  await withCorpus(async (dir) => {
    const path = copyFixtureReport("violates-all-three.json", dir);
    const outcome: EnforcementOutcome = await runEnforcement(settingsFor(path), deps());
    assert.deepEqual(Object.keys(outcome.outputs).sort(), [
      "conflict-count",
      "drift-count",
      "report-json",
      "status",
      "summary",
      "unmapped-count",
    ]);
    assert.equal(outcome.outputs["status"], "fail");
    assert.equal(outcome.outputs["unmapped-count"], "1");
    assert.equal(outcome.outputs["conflict-count"], "2");
    assert.equal(outcome.outputs["drift-count"], "3");
    assert.equal(outcome.outputs["summary"], outcome.summaryLine);
    assert.equal(outcome.outputs["report-json"], path);
    assert.equal(outcome.reportJsonPath, path);
    assert.equal(outcome.planId, "b".repeat(64));
  });
});

test("malformed / not-report / missing artifacts THROW CiArtifactError naming the artifact (never a pass)", async () => {
  await withCorpus(async (dir) => {
    for (const name of ["malformed.json", "not-report.json"]) {
      const path = copyFixtureReport(name, dir);
      await assert.rejects(
        () => runEnforcement(settingsFor(path), deps()),
        (err: unknown) => {
          assert.ok(err instanceof CiArtifactError);
          assert.ok(err.message.includes(path), err.message);
          return true;
        },
        name,
      );
    }
    const missing = join(dir, "absent-report.json");
    await assert.rejects(
      () => runEnforcement(settingsFor(missing), deps()),
      (err: unknown) => err instanceof CiArtifactError && err.message.includes(missing),
    );
  });
});

test("artifact-direct mode spawns nothing: no cliInvoker in deps is sufficient", async () => {
  await withCorpus(async (dir) => {
    const outcome = await runEnforcement(
      settingsFor(copyFixtureReport("high-band-null-issue.json", dir)),
      { screener: makeScreener() as unknown as SecurityScreener, env: {}, log: () => undefined },
    );
    assert.equal(outcome.status, "fail");
  });
});

test("deterministic: identical settings + bytes ⇒ identical outcomes", async () => {
  await withCorpus(async (dir) => {
    const path = copyFixtureReport("violates-all-three.json", dir);
    const first = await runEnforcement(settingsFor(path), deps());
    const second = await runEnforcement(settingsFor(path), deps());
    assert.deepEqual(second, first);
  });
});
