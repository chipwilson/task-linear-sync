// <NAMEFILE> tests/e2e/ci-enforcement-action.test.ts
//
// US2 (plan-report mode, T031) + US1 through the BUILT wrapper entry point
// (T034): the real `dist/ci/main.js` spawns fake published-CLI entries
// (FR-0012) that run the REAL CLI core + engine behind a fake tracker,
// exactly like a CI runner invoking the composite action.
//
// Provenance of expectations: condition buckets per world were derived from
// the frozen evaluate() predicates over the real reports, not copied from a
// run.

import { strict as assert } from "node:assert";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  CI_MAIN_PATH,
  copyFixtureReport,
  githubEnv,
  hashTree,
  runWrapper,
  writeCliEntry,
  type WrapperRunResult,
} from "../helpers/ci-harness.js";

const engineWorldDir = (name: string): string =>
  fileURLToPath(new URL(`../../../tests/fixtures/engine/worlds/${name}/`, import.meta.url));

interface Harness {
  readonly dir: string;
  readonly workspace: string;
  readonly entry: string;
  readonly census: string;
  readonly out: string;
}

function makeHarness(worldName: string): Harness {
  const dir = mkdtempSync(join(tmpdir(), "tls-013-e2e-"));
  const workspace = join(dir, "ws");
  mkdirSync(workspace, { recursive: true });
  const entry = join(dir, "cli-entry.mjs");
  const census = join(dir, "census.jsonl");
  writeCliEntry(entry, { entryPath: entry, worldDir: engineWorldDir(worldName), censusPath: census });
  return { dir, workspace, entry, census, out: join(dir, "gh-output") };
}

function censusArgv(h: Harness): string[][] {
  if (!existsSync(h.census)) return [];
  return readFileSync(h.census, "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as string[]);
}

const PASS_SUMMARY =
  "task-linear-sync enforcement passed (unmapped-high-confidence: 0, unresolved-conflict-block: 0, spec-drift: 0)";

test("ci-e2e US2: clean world passes with exact zero counts and exactly one check invocation", async () => {
  const h = makeHarness("formatting-noise");
  const result = await runWrapper(
    ["--workspace", h.workspace, "--cli-entry", h.entry],
    { env: githubEnv({ eventName: "pull_request", output: h.out }) },
  );
  assert.equal(result.exitCode, 0, `stderr: ${result.stderr.slice(0, 400)}`);
  assert.deepEqual(censusArgv(h), [["check", h.workspace]]);
  assert.ok(result.outputs !== null);
  assert.equal(result.outputs["status"], "pass");
  assert.equal(result.outputs["summary"], PASS_SUMMARY);
  assert.equal(result.outputs["unmapped-count"], "0");
  assert.equal(result.outputs["conflict-count"], "0");
  assert.equal(result.outputs["drift-count"], "0");
  assert.match(result.outputs["report-json"], /report\.json$/);
});

test("ci-e2e US2: pull_request base-ref fallback protects the conflict condition with no flags", async () => {
  const h = makeHarness("unresolved-block");
  const result = await runWrapper(
    ["--workspace", h.workspace, "--cli-entry", h.entry],
    { env: githubEnv({ eventName: "pull_request", baseRef: "main", output: h.out }) },
  );
  assert.equal(result.exitCode, 1);
  assert.ok(result.outputs !== null);
  assert.match(result.outputs["summary"], /enforcement failed — unresolved-conflict-block: 1/);
  assert.equal(result.stderr.includes("protection skipped"), false);
});

test("ci-e2e US2: push with no protected set passes with the protection-skip warning", async () => {
  const h = makeHarness("unresolved-block");
  const result = await runWrapper(
    ["--workspace", h.workspace, "--cli-entry", h.entry],
    { env: githubEnv({ eventName: "push", refName: "feature/unscoped", output: h.out }) },
  );
  assert.equal(result.exitCode, 0);
  assert.equal(result.outputs?.["status"], "pass");
  assert.match(
    result.stderr,
    /task-linear-sync enforcement warning: unresolved-conflict-block protection skipped — branch context unresolved/,
  );
});

test("ci-e2e US2: fail-on-conflicts false never fails and still reports counts", async () => {
  const h = makeHarness("unresolved-block");
  const result = await runWrapper(
    [
      "--workspace", h.workspace, "--cli-entry", h.entry,
      "--protected-branches", "main", "--branch", "main",
      "--fail-on-conflicts", "false",
    ],
    { env: githubEnv({ eventName: "pull_request", output: h.out }) },
  );
  assert.equal(result.exitCode, 0);
  assert.equal(result.outputs?.["status"], "pass");
  assert.equal(result.outputs?.["conflict-count"], "1", "counts still reported when disabled");
});

test("ci-e2e US2: blocking flags trip only the conflict condition", async () => {
  const h = makeHarness("unresolved-block");
  const result = await runWrapper(
    ["--workspace", h.workspace, "--cli-entry", h.entry, "--protected-branches", "main", "--branch", "main"],
    { env: githubEnv({ eventName: "pull_request", output: h.out }) },
  );
  assert.equal(result.exitCode, 1);
  assert.ok(result.outputs !== null);
  assert.equal(result.outputs["conflict-count"], "1");
  assert.equal(result.outputs["drift-count"], "0");
  assert.match(result.outputs["summary"], /enforcement failed — unresolved-conflict-block: 1/);
});

test("ci-e2e US2: no world issue title or body leaks into any wrapper surface (SC-003)", async () => {
  const h = makeHarness("unresolved-block");
  const result = await runWrapper(
    ["--workspace", h.workspace, "--cli-entry", h.entry, "--protected-branches", "main", "--branch", "main"],
    { env: githubEnv({ eventName: "pull_request", output: h.out }) },
  );
  assert.equal(result.exitCode, 1);
  const worldDoc = JSON.parse(
    readFileSync(join(engineWorldDir("unresolved-block"), "world.json"), "utf8"),
  ) as { issues: { title?: string; body?: string }[] };
  const sentinels = worldDoc.issues
    .flatMap((issue) => [issue.title ?? "", issue.body ?? ""])
    .map((text) => text.trim())
    .filter((text) => text.length > 12)
    .slice(0, 3);
  assert.ok(sentinels.length > 0, "fixture must carry sentinel text");
  const surfaces = [result.stdout, result.stderr, result.outputRaw ?? ""].join("\n");
  for (const sentinel of sentinels) {
    assert.equal(surfaces.includes(sentinel), false, `surface must not contain: ${sentinel.slice(0, 30)}`);
  }
});

test("ci-e2e US2: the passed workspace tree is byte-identical before and after (SC-002)", async () => {
  const h = makeHarness("spec-changed");
  const before = hashTree(h.workspace);
  const result = await runWrapper(
    ["--workspace", h.workspace, "--cli-entry", h.entry],
    { env: githubEnv({ eventName: "pull_request", baseRef: "main", output: h.out }) },
  );
  assert.equal(result.exitCode, 1);
  assert.deepEqual(hashTree(h.workspace), before);
  assert.equal(existsSync(join(h.workspace, "reports")), false);
});

test("ci-e2e US2: spec drift fails only the drift condition and the CLI exit code never leaks", async () => {
  const h = makeHarness("spec-changed");
  const result = await runWrapper(
    ["--workspace", h.workspace, "--cli-entry", h.entry],
    { env: githubEnv({ eventName: "pull_request", output: h.out }) },
  );
  // CLI exited 8; the wrapper's decision is its own mapping (1), never 8.
  assert.equal(result.exitCode, 1);
  assert.deepEqual(censusArgv(h), [["check", h.workspace]]);
  assert.ok(result.outputs !== null);
  assert.equal(result.outputs["status"], "fail");
  assert.equal(result.outputs["drift-count"], "1");
  assert.equal(result.outputs["conflict-count"], "0");
  assert.equal(result.outputs["unmapped-count"], "0");
  assert.match(result.outputs["summary"], /enforcement failed — spec-drift: 1/);
  for (const argv of censusArgv(h)) {
    assert.equal(["check", "plan"].includes(argv[0] ?? ""), true);
  }
});

test("ci-e2e US2: command plan routes through the plan command surface exactly once", async () => {
  const h = makeHarness("formatting-noise");
  const result = await runWrapper(
    ["--workspace", h.workspace, "--cli-entry", h.entry, "--command", "plan"],
    { env: githubEnv({ eventName: "pull_request", output: h.out }) },
  );
  assert.equal(result.exitCode, 0);
  assert.deepEqual(censusArgv(h), [["plan", h.workspace]]);
  assert.equal(result.outputs?.["status"], "pass");
});

test("ci-e2e US2: a failing CLI run reports exit 3, names the command, and screens secrets", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tls-013-e2e-fail-"));
  const workspace = join(dir, "ws");
  mkdirSync(workspace, { recursive: true });
  const entry = join(dir, "cli-entry.mjs");
  writeFileSync(
    entry,
    "#!/usr/bin/env node\nconsole.error('tracker exploded for lin_api_secrettoken123');\nprocess.exit(5);\n",
    "utf8",
  );
  const out = join(dir, "gh-output");
  const result = await runWrapper(
    ["--workspace", workspace, "--cli-entry", entry],
    { env: githubEnv({ eventName: "push", output: out }) },
  );
  assert.equal(result.exitCode, 3);
  assert.match(result.stderr, /check/);
  assert.equal(result.stderr.includes("lin_api_secrettoken123"), false);
  assert.equal(existsSync(out), false, "no outputs are emitted on infrastructure failure");
});

test("ci-e2e US2: the fixture world on disk is byte-for-byte untouched by an enforcement run", async () => {
  const world = engineWorldDir("both-changed");
  const before = hashTree(world);
  const h = makeHarness("both-changed");
  const result = await runWrapper(
    ["--workspace", h.workspace, "--cli-entry", h.entry],
    { env: githubEnv({ eventName: "pull_request", output: h.out }) },
  );
  assert.equal(result.exitCode, 1); // drift condition at the default threshold
  assert.deepEqual(hashTree(world), before);
});

async function runOnFixture(fixture: string, flags: readonly string[], env: Record<string, string>): Promise<WrapperRunResult> {
  const dir = mkdtempSync(join(tmpdir(), "tls-013-e2e-art-"));
  const reportPath = copyFixtureReport(fixture, dir);
  const out = join(dir, "gh-output");
  return runWrapper(["--workspace", dir, "--report", reportPath, ...flags], {
    env: { ...env, GITHUB_OUTPUT: out },
  });
}

test("ci-e2e US1: drives the three-condition decision from a written report file", async () => {
  const result = await runOnFixture(
    "violates-all-three.json",
    ["--protected-branches", "main"],
    githubEnv({ eventName: "pull_request", refName: "main" }),
  );
  assert.equal(result.exitCode, 1);
  assert.ok(result.outputs !== null);
  assert.equal(result.outputs["status"], "fail");
  assert.equal(result.outputs["unmapped-count"], "1");
  assert.equal(result.outputs["conflict-count"], "2");
  assert.equal(result.outputs["drift-count"], "3");
  assert.equal(
    result.outputs["summary"],
    "task-linear-sync enforcement failed — unmapped-high-confidence: 1; unresolved-conflict-block: 2; spec-drift: 3",
  );
});

test("ci-e2e US1: a missing report artifact fails with exit 2 naming the path and emits no outputs", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tls-013-e2e-miss-"));
  const missing = join(dir, "nope.json");
  const out = join(dir, "gh-output");
  const result = await runWrapper(["--workspace", dir, "--report", missing], {
    env: { ...githubEnv({ eventName: "push" }), GITHUB_OUTPUT: out },
  });
  assert.equal(result.exitCode, 2);
  assert.ok(result.stderr.includes(missing));
  assert.equal(result.stderr.includes("task-linear-sync enforcement failed"), true);
  assert.equal(existsSync(out), false);
});

test("ci-e2e US1: the built entry point is directly invocable and writes no output file without GITHUB_OUTPUT", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tls-013-e2e-inv-"));
  const reportPath = copyFixtureReport("clean.json", dir);
  const result = await runWrapper(
    ["--workspace", dir, "--report", reportPath],
    { entry: CI_MAIN_PATH, env: githubEnv({ eventName: "push" }) },
  );
  assert.equal(result.exitCode, 0);
  assert.equal(result.outputs, null, "no GITHUB_OUTPUT set means no output file is written");
  assert.match(result.stdout, /enforcement passed/);
});
