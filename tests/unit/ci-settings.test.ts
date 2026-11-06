/**
 * T010 — unit tests for `resolveSettings` (data-model §1–§2; research R6/R10).
 * Defaults, closed bool/int/enum parsing, complete-listing problems, precedence,
 * CSV + branch/protected-set resolution order, zero-org-identifier defaults.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveSettings, CiConfigError } from "task-linear-sync/ci";

test("defaults: all toggles true, thresholds 0, command check, null paths (FR-002)", () => {
  const s = resolveSettings({ cwd: "/" });
  assert.equal(s.failOnUnmapped, true);
  assert.equal(s.failOnConflicts, true);
  assert.equal(s.failOnDrift, true);
  assert.equal(s.unmappedThreshold, 0);
  assert.equal(s.driftThreshold, 0);
  assert.equal(s.command, "check");
  assert.equal(s.reportPath, null);
  assert.equal(s.configFile, null);
  assert.equal(s.cliEntry, null);
  assert.equal(s.targetBranch, null);
  assert.deepEqual(s.protectedBranches, []);
});

test("workspace: defaults to cwd, relative resolves against cwd, missing path is a problem", () => {
  const tmp = mkdtempSync(join(tmpdir(), "tls-013-settings-"));
  try {
    const s = resolveSettings({ cwd: tmp });
    assert.equal(s.workspace, tmp);
    const rel = resolveSettings({ cwd: tmp, flags: { workspace: "." } });
    assert.equal(rel.workspace, tmp);
    assert.throws(
      () => resolveSettings({ cwd: tmp, flags: { workspace: join(tmp, "not-here-013") } }),
      (err: unknown) => {
        assert.ok(err instanceof CiConfigError);
        assert.equal(err.name, "CiConfigError");
        assert.equal(err.problems.length, 1);
        assert.match(err.problems[0] ?? "", /^settings\.workspace: path does not exist/);
        assert.ok((err.problems[0] ?? "").includes("not-here-013"));
        return true;
      },
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("booleans: closed set {true,false,1,0} case-insensitive; others are problems", () => {
  for (const [raw, expected] of [
    ["true", true], ["TRUE", true], ["True", true], ["1", true],
    ["false", false], ["FALSE", false], ["0", false],
  ] as const) {
    const s = resolveSettings({ cwd: "/", flags: { "fail-on-unmapped": raw } });
    assert.equal(s.failOnUnmapped, expected, `raw=${raw}`);
  }
  for (const raw of ["yes", "2", "on", "maybe"]) {
    assert.throws(
      () => resolveSettings({ cwd: "/", flags: { "fail-on-drift": raw } }),
      (err: unknown) => {
        assert.ok(err instanceof CiConfigError);
        assert.match(err.problems[0] ?? "", /^settings\.fail-on-drift: not a boolean/);
        return true;
      },
      `raw=${raw} must be rejected`,
    );
  }
});

test("thresholds: Number.isInteger && >= 0", () => {
  assert.equal(resolveSettings({ cwd: "/", flags: { "unmapped-threshold": "0" } }).unmappedThreshold, 0);
  assert.equal(resolveSettings({ cwd: "/", flags: { "drift-threshold": "3" } }).driftThreshold, 3);
  for (const raw of ["-1", "1.5", "x", "NaN"]) {
    assert.throws(
      () => resolveSettings({ cwd: "/", flags: { "drift-threshold": raw } }),
      (err: unknown) => {
        assert.ok(err instanceof CiConfigError);
        assert.match(err.problems[0] ?? "", /^settings\.drift-threshold: not a non-negative integer/);
        return true;
      },
      `raw=${JSON.stringify(raw)} must be rejected`,
    );
  }
});

test("command: closed enum check|plan", () => {
  assert.equal(resolveSettings({ cwd: "/", flags: { command: "plan" } }).command, "plan");
  assert.throws(
    () => resolveSettings({ cwd: "/", flags: { command: "apply" } }),
    (err: unknown) => {
      assert.ok(err instanceof CiConfigError);
      assert.match(err.problems[0] ?? "", /^settings\.command: not one of check,plan/);
      return true;
    },
  );
});

test("invalid inputs: ALL problems collected into ONE dotted-key line (never fail-fast)", () => {
  assert.throws(
    () =>
      resolveSettings({
        cwd: "/",
        flags: { command: "apply", "fail-on-drift": "yes", "drift-threshold": "-2" },
      }),
    (err: unknown) => {
      assert.ok(err instanceof CiConfigError);
      assert.equal(err.problems.length, 3);
      assert.ok(!err.message.includes("\n"), "message must be exactly one line");
      for (const key of ["settings.command:", "settings.fail-on-drift:", "settings.drift-threshold:"]) {
        assert.ok(err.message.includes(key), `missing ${key} in: ${err.message}`);
      }
      return true;
    },
  );
});

test("precedence: flags > TLS_CI_* env > defaults", () => {
  const viaEnv = resolveSettings({
    cwd: "/",
    env: { TLS_CI_UNMAPPED_THRESHOLD: "5", TLS_CI_FAIL_ON_DRIFT: "0", TLS_CI_COMMAND: "plan" },
  });
  assert.equal(viaEnv.unmappedThreshold, 5);
  assert.equal(viaEnv.failOnDrift, false);
  assert.equal(viaEnv.command, "plan");
  const flagWins = resolveSettings({
    cwd: "/",
    env: { TLS_CI_UNMAPPED_THRESHOLD: "5" },
    flags: { "unmapped-threshold": "2" },
  });
  assert.equal(flagWins.unmappedThreshold, 2);
});

test("empty-string values count as unset (Flags Action passes empty defaults)", () => {
  const s = resolveSettings({
    cwd: "/",
    env: { TLS_CI_COMMAND: "", TLS_CI_FAIL_ON_UNMAPPED: "", TLS_CI_PROTECTED_BRANCHES: "" },
  });
  assert.equal(s.command, "check");
  assert.equal(s.failOnUnmapped, true);
  assert.deepEqual(s.protectedBranches, []);
});

test("protected-branches CSV: split on commas, trim, drop empties", () => {
  const s = resolveSettings({ cwd: "/", flags: { "protected-branches": "main, release ,," } });
  assert.deepEqual(s.protectedBranches, ["main", "release"]);
});

test("target branch order: input > GITHUB_BASE_REF > GITHUB_REF_NAME (refs/heads/ stripped) > null", () => {
  const env = { GITHUB_BASE_REF: "base", GITHUB_REF_NAME: "refs/heads/topic" };
  assert.equal(resolveSettings({ cwd: "/", flags: { branch: "explicit" }, env }).targetBranch, "explicit");
  assert.equal(resolveSettings({ cwd: "/", env: { TLS_CI_BRANCH: "via-env", ...env } }).targetBranch, "via-env");
  assert.equal(resolveSettings({ cwd: "/", env }).targetBranch, "base");
  assert.equal(
    resolveSettings({ cwd: "/", env: { GITHUB_REF_NAME: "refs/heads/topic" } }).targetBranch,
    "topic",
  );
  assert.equal(resolveSettings({ cwd: "/", env: {} }).targetBranch, null);
});

test("protected set order: input CSV > {GITHUB_BASE_REF} when non-empty > []", () => {
  assert.deepEqual(
    resolveSettings({ cwd: "/", flags: { "protected-branches": "main" }, env: { GITHUB_BASE_REF: "base" } })
      .protectedBranches,
    ["main"],
  );
  assert.deepEqual(resolveSettings({ cwd: "/", env: { GITHUB_BASE_REF: "base" } }).protectedBranches, ["base"]);
  assert.deepEqual(resolveSettings({ cwd: "/", env: { GITHUB_BASE_REF: "" } }).protectedBranches, []);
  assert.deepEqual(resolveSettings({ cwd: "/", env: { GITHUB_REF_NAME: "refs/heads/main" } }).protectedBranches, []);
});

test("resolved defaults carry zero org identifiers (defaults-scan posture)", () => {
  const rendered = JSON.stringify(resolveSettings({ cwd: "/" }));
  assert.ok(!/contoso|globex|initech|umbrella|hooli|vandelay|acme|example\.com|lin_api_/i.test(rendered), rendered);
});
