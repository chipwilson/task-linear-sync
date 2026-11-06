/**
 * T021 — unit tests for artifact loading + CLI output locators
 * (data-model §5–§6; research R4). Structural read set, frozen-schema
 * agreement, error taxonomy naming the artifact/command.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { CiArtifactError, loadReportArtifact, parseLocator } from "task-linear-sync/ci";

import type { SecurityScreener } from "task-linear-sync/ports";

import type { LocatorRequest } from "../../src/ci/report-input.js";

import { fixtureReport } from "../helpers/ci-harness.js";
import { collectSchemaErrors } from "../helpers/json-schema-mini.js";
import { makeScreener } from "../helpers/test-utils.js";

const VALID_FIXTURES = [
  "clean.json",
  "violates-all-three.json",
  "conflict-blocks.json",
  "drift-spec-changed.json",
  "drift-boundaries.json",
  "high-band-null-issue.json",
  "unmatched-not-high.json",
] as const;

const FROZEN_SCHEMA = JSON.parse(
  readFileSync(
    // compiled tests live at build/tests/unit → repository root is three levels up
    fileURLToPath(new URL("../../../specs/002-core-domain-contracts/contracts/plan-report.schema.json", import.meta.url)),
    "utf8",
  ),
);

function withTmp<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "tls-013-load-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("every VALID fixture loads with the §5 read set", () => {
  for (const name of VALID_FIXTURES) {
    const parsed = loadReportArtifact(fixtureReport(name));
    assert.match(parsed.planId, /^[0-9a-f]{64}$/, name);
    assert.equal(parsed.path, fixtureReport(name), name);
    assert.ok(Array.isArray(parsed.entries) && parsed.entries.length > 0, name);
    for (const e of parsed.entries) {
      assert.ok(e.issueId === null || typeof e.issueId === "string", name);
      assert.equal(typeof e.confidence, "string", name);
      assert.ok(Array.isArray(e.reasons), name);
      assert.ok(Array.isArray(e.changedFields), name);
      assert.ok(Array.isArray(e.expectedMarkdownChanges), name);
      assert.equal(typeof e.unresolvedConflict, "boolean", name);
    }
  }
});

test("every VALID fixture also validates against the FROZEN 002 plan-report schema", () => {
  for (const name of VALID_FIXTURES) {
    const doc = JSON.parse(readFileSync(fixtureReport(name), "utf8"));
    const errs = collectSchemaErrors(FROZEN_SCHEMA, doc);
    assert.deepEqual(errs, [], `${name}: ${JSON.stringify(errs)}`);
  }
});

test("loaded entries are read in artifact order (groups flattened, array order)", () => {
  const parsed = loadReportArtifact(fixtureReport("violates-all-three.json"));
  assert.equal(parsed.entries.length, 6);
  assert.deepEqual(
    parsed.entries.map((e) => [e.confidence, e.issueId, e.unresolvedConflict]),
    [
      ["high", null, false],
      ["high", "TLS-201", true],
      ["high", "TLS-202", true],
      ["high", "TLS-203", false],
      ["high", "TLS-204", false],
      ["high", "TLS-205", false],
    ],
  );
  assert.deepEqual(parsed.entries[3]?.reasons, ["conflict:spec-changed"]);
  assert.deepEqual(parsed.entries[4]?.changedFields, ["title"]);
  assert.equal(parsed.entries[5]?.expectedMarkdownChanges.length, 1);
});

test("absent file ⇒ CiArtifactError naming the path", () => {
  const missing = join(tmpdir(), "tls-013-definitely-missing-9f3a.json");
  assert.throws(
    () => loadReportArtifact(missing),
    (err: unknown) => {
      assert.ok(err instanceof CiArtifactError);
      assert.equal(err.name, "CiArtifactError");
      assert.ok(err.message.includes(missing), err.message);
      assert.equal(err.artifactPath, missing);
      return true;
    },
  );
});

test("unparseable JSON ⇒ CiArtifactError naming the artifact", () => {
  withTmp((dir) => {
    const p = join(dir, "broken.json");
    writeFileSync(p, "{ this is not json", "utf8");
    assert.throws(
      () => loadReportArtifact(p),
      (err: unknown) => err instanceof CiArtifactError && err.message.includes(p),
    );
  });
});

test("malformed.json (schemaVersion 2 + non-array groups) ⇒ structural violation naming the artifact", () => {
  assert.throws(
    () => loadReportArtifact(fixtureReport("malformed.json")),
    (err: unknown) => {
      assert.ok(err instanceof CiArtifactError);
      assert.ok(err.message.includes(fixtureReport("malformed.json")), err.message);
      return true;
    },
  );
});

test("not-report.json (valid JSON, not a report) ⇒ CiArtifactError", () => {
  assert.throws(
    () => loadReportArtifact(fixtureReport("not-report.json")),
    (err: unknown) => err instanceof CiArtifactError,
  );
});

test("per-entry read-set violations are rejected (bad confidence type, missing unmapped, bad planId)", () => {
  withTmp((dir) => {
    const base = JSON.parse(readFileSync(fixtureReport("clean.json"), "utf8"));
    const badConfidence = JSON.parse(JSON.stringify(base));
    badConfidence.groups[0].entries[0].confidence = 5;
    const p1 = join(dir, "bad-confidence.json");
    writeFileSync(p1, JSON.stringify(badConfidence), "utf8");
    assert.throws(() => loadReportArtifact(p1), (e: unknown) => e instanceof CiArtifactError);

    const noUnmapped = JSON.parse(JSON.stringify(base));
    delete noUnmapped.unmapped;
    const p2 = join(dir, "no-unmapped.json");
    writeFileSync(p2, JSON.stringify(noUnmapped), "utf8");
    assert.throws(() => loadReportArtifact(p2), (e: unknown) => e instanceof CiArtifactError);

    const badPlan = JSON.parse(JSON.stringify(base));
    badPlan.planId = "not-hex";
    const p3 = join(dir, "bad-plan.json");
    writeFileSync(p3, JSON.stringify(badPlan), "utf8");
    assert.throws(() => loadReportArtifact(p3), (e: unknown) => e instanceof CiArtifactError);
  });
});

test("absent unresolvedConflict defaults to false (frozen shape allows omission)", () => {
  withTmp((dir) => {
    const base = JSON.parse(readFileSync(fixtureReport("clean.json"), "utf8"));
    delete base.groups[0].entries[0].unresolvedConflict;
    const p = join(dir, "no-flag.json");
    writeFileSync(p, JSON.stringify(base), "utf8");
    const parsed = loadReportArtifact(p);
    assert.equal(parsed.entries[0]?.unresolvedConflict, false);
  });
});

// ──────────────────────────────────────────────── locators (data-model §6)

function locatorRequest(
  command: "check" | "plan",
  stdout: string,
  screener: SecurityScreener = makeScreener(),
): LocatorRequest {
  return { command, stdout, screener };
}

test("check locator: exactly-one-JSON-object stdout", () => {
  const planId = "b".repeat(64);
  const summary = {
    schemaVersion: 1,
    planId,
    reportJson: "/state/reports/plan-abc.json",
    reportMarkdown: "/state/reports/plan-abc.md",
    counts: { groups: 1, entries: 2, unmapped: 0, conflicts: 0 },
  };
  const r = parseLocator(locatorRequest("check", `  ${JSON.stringify(summary)}\n`));
  assert.equal(r.reportJsonPath, "/state/reports/plan-abc.json");
  assert.equal(r.planId, planId);
});

test("check locator: empty / non-JSON / extra-noise stdout ⇒ error naming the command", () => {
  for (const stdout of [
    "",
    "   ",
    "plain text, no json",
    `warning: something\n{"schemaVersion":1,"planId":"${"c".repeat(64)}","reportJson":"/x.json"}`,
    `{"schemaVersion":1,"planId":"${"c".repeat(64)}","reportJson":""}`,
  ]) {
    assert.throws(
      () => parseLocator(locatorRequest("check", stdout)),
      (err: unknown) => {
        assert.ok(err instanceof CiArtifactError, JSON.stringify(stdout));
        assert.ok(err.message.includes("check"), err.message);
        return true;
      },
      `stdout=${JSON.stringify(stdout)}`,
    );
  }
});

test("plan locator: plan <hex> + FIRST report <path>.json line", () => {
  const planId = "d".repeat(64);
  const stdout = `plan ${planId}\nreport /state/reports/plan-x.json\nreport /state/reports/plan-x.md\n`;
  const r = parseLocator(locatorRequest("plan", stdout));
  assert.equal(r.reportJsonPath, "/state/reports/plan-x.json");
  assert.equal(r.planId, planId);
});

test("plan locator: missing .json report line or malformed plan line ⇒ error naming the command", () => {
  for (const stdout of [
    "",
    `plan ${"d".repeat(64)}\nreport /state/reports/plan-x.md\n`,
    "plan nope\nreport /state/reports/plan-x.json\n",
  ]) {
    assert.throws(
      () => parseLocator(locatorRequest("plan", stdout)),
      (err: unknown) => {
        assert.ok(err instanceof CiArtifactError, JSON.stringify(stdout));
        assert.ok(err.message.includes("plan"), err.message);
        return true;
      },
      `stdout=${JSON.stringify(stdout)}`,
    );
  }
});

test("locator error text passes the screener (screened stdout head, spy-proven)", () => {
  const seen: string[] = [];
  const spy: SecurityScreener = {
    screen(text: string) {
      seen.push(text);
      return { output: text, blocked: [], findings: [] };
    },
  };
  assert.throws(() => parseLocator(locatorRequest("check", "totally unscreened noise", spy)));
  assert.ok(seen.length >= 1, "screener must be consulted before error text surfaces");
});
