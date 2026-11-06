/**
 * T004 [P] — argv parser unit tests (FR-001/FR-002, data-model §1, research R2).
 * Pure parser: twelve command names, per-command flag schema, complete-offender
 * FR-002 rejection, byte-identical outcomes for identical argv (zero I/O).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { parseInvocation, COMMAND_NAMES } from "../../src/cli/argv.js";

const TWELVE = [
  "inventory",
  "discover-metadata",
  "plan",
  "bootstrap",
  "sync",
  "check",
  "install-hooks",
  "install-agent-hook",
  "enqueue",
  "worker",
  "last-run",
  "rollback",
];

function ok(argv: string[]) {
  const result = parseInvocation(argv);
  assert.ok(result.ok, `expected parse success for ${JSON.stringify(argv)}: ${result.ok ? "" : result.failure.message}`);
  return result.invocation;
}

function fail(argv: string[]) {
  const result = parseInvocation(argv);
  assert.ok(!result.ok, `expected parse failure for ${JSON.stringify(argv)}`);
  return result.failure;
}

test("the twelve command names parse", () => {
  assert.deepEqual([...COMMAND_NAMES], TWELVE);
  for (const command of TWELVE) {
    const invocation = ok(command === "rollback" ? [command, "run-1"] : [command]);
    assert.equal(invocation.command, command);
  }
});

test("unknown command fails naming the unknown token", () => {
  const failure = fail(["frobnicate"]);
  assert.match(failure.message, /frobnicate/);
  assert.equal(failure.flags.length, 0);
});

test("global --config <path> parses for every command; a missing value fails naming it", () => {
  const invocation = ok(["plan", "--config", "/tmp/custom.json"]);
  assert.equal(invocation.flags["config"], "/tmp/custom.json");
  const failure = fail(["plan", "--config"]);
  assert.match(failure.message, /--config/);
});

test("bootstrap/sync accept the apply vocabulary and require --plan (missing ⇒ failure naming --plan)", () => {
  for (const command of ["bootstrap", "sync"]) {
    const invocation = ok([
      command,
      "--plan",
      "abc123",
      "--apply",
      "--confirm",
      "ACME",
      "--accept-low-confidence",
      "--config",
      "cfg.json",
    ]);
    assert.equal(invocation.flags["apply"], true);
    assert.equal(invocation.flags["confirm"], "ACME");
    assert.equal(invocation.flags["accept-low-confidence"], true);
    assert.equal(invocation.flags["plan"], "abc123");

    const missing = fail([command, "--apply"]);
    assert.match(missing.message, /--plan/);

    const noValue = fail([command, "--plan"]);
    assert.match(noValue.message, /--plan/);

    const confirmNoValue = fail([command, "--plan", "p", "--confirm"]);
    assert.match(confirmNoValue.message, /--confirm/);
  }
});

test("rollback requires exactly one positional runId (0 or 3+ positionals fail)", () => {
  const one = ok(["rollback", "run-42"]);
  assert.deepEqual(one.positional, ["run-42"]);
  const two = ok(["rollback", "/repo", "run-42"]);
  assert.deepEqual(two.positional, ["/repo", "run-42"]);
  assert.match(fail(["rollback"]).message, /runId|positional/);
  assert.match(fail(["rollback", "a", "b", "c"]).message, /positional|runId/);
});

test("plan/check/inventory/discover-metadata/bootstrap/sync accept 0-1 repository positionals", () => {
  for (const command of ["plan", "check", "inventory", "discover-metadata", "bootstrap", "sync"]) {
    assert.deepEqual(ok([command]).positional, []);
    assert.deepEqual(ok([command, "/some/repo"]).positional, ["/some/repo"]);
  }
  assert.match(fail(["plan", "one", "two"]).message, /positional|too many/);
});

test("enqueue validates --mode against bootstrap|sync; worker takes --once; last-run --json; install-agent-hook --framework", () => {
  assert.equal(ok(["enqueue", "--mode", "bootstrap"]).flags["mode"], "bootstrap");
  assert.equal(ok(["enqueue", "--mode", "sync"]).flags["mode"], "sync");
  assert.match(fail(["enqueue", "--mode", "sideways"]).message, /--mode/);
  assert.match(fail(["enqueue", "--mode"]).message, /--mode/);
  assert.equal(ok(["worker", "--once"]).flags["once"], true);
  assert.equal(ok(["last-run", "--json"]).flags["json"], true);
  assert.equal(ok(["install-agent-hook", "--framework", "kiro"]).flags["framework"], "kiro");
  assert.match(fail(["install-agent-hook", "--framework"]).message, /--framework/);
});

test("unknown flags fail parsing naming the flag", () => {
  const failure = fail(["plan", "--wat"]);
  assert.match(failure.message, /--wat/);
  assert.deepEqual(failure.flags, ["--wat"]);
  assert.match(fail(["last-run", "--nope", "x"]).message, /--nope/);
});

test("FR-002: plan with apply flags fails naming EVERY offending flag (never fail-fast-on-first)", () => {
  const single = fail(["plan", "--apply"]);
  assert.deepEqual(single.flags, ["--apply"]);
  assert.match(single.message, /--apply/);
  assert.match(single.message, /read-only/);

  const double = fail(["plan", "--apply", "--accept-low-confidence"]);
  assert.deepEqual([...double.flags].sort(), ["--accept-low-confidence", "--apply"]);
  assert.match(double.message, /--apply/);
  assert.match(double.message, /--accept-low-confidence/);

  const triple = fail(["plan", "--confirm", "ACME", "--apply", "--accept-low-confidence"]);
  assert.deepEqual(triple.flags, ["--confirm", "--apply", "--accept-low-confidence"]);
});

test("FR-002: check with apply flags fails identically", () => {
  const failure = fail(["check", "--apply", "--confirm", "ACME"]);
  assert.deepEqual(failure.flags, ["--apply", "--confirm"]);
  assert.match(failure.message, /--apply/);
  assert.match(failure.message, /--confirm/);
  assert.match(failure.message, /read-only/);
});

test("bootstrap/sync KEEP the apply vocabulary (no FR-002 rejection there)", () => {
  const invocation = ok(["sync", "--plan", "p", "--apply", "--confirm", "ACME", "--accept-low-confidence"]);
  assert.equal(invocation.command, "sync");
});

test("the parser is pure: same argv ⇒ byte-identical outcome (zero I/O, JSON-stable)", () => {
  const argv = ["plan", "/tmp/repo", "--config", "x.json"];
  const first = JSON.stringify(parseInvocation(argv));
  const second = JSON.stringify(parseInvocation(argv));
  assert.equal(first, second);
  const failing = ["plan", "--apply", "--confirm", "K", "--accept-low-confidence"];
  assert.equal(JSON.stringify(parseInvocation(failing)), JSON.stringify(parseInvocation(failing)));
});
