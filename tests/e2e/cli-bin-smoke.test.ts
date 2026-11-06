/**
 * T019 [US1] — real-process smoke over the published bin (`dist/cli/main.js`,
 * research R8b): `--help` lists the twelve commands with exit 0; an unknown command
 * exits 2; FR-002 refusal exits 2 naming `--apply` with the fixture repo tree left
 * byte-identical — the read-only plan lane guarantee across a true process boundary.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { cliWorldDir, hashTree } from "../helpers/cli-harness.js";

const pkgRoot = fileURLToPath(new URL("../../../", import.meta.url));
const BIN = join(pkgRoot, "dist", "cli", "main.js");

function runBin(args: readonly string[]): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [BIN, ...args], { encoding: "utf8", timeout: 60_000 });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

test("--help exits 0 and lists all twelve commands", () => {
  const r = runBin(["--help"]);
  assert.equal(r.status, 0);
  for (const command of [
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
  ]) {
    assert.match(r.stdout, new RegExp(`^\\s{2}${command}\\s`, "m"), `--help must list '${command}'`);
  }
  assert.match(r.stdout, /exit codes:/);
});

test("unknown command exits 2 naming the unknown token", () => {
  const r = runBin(["frobnicate"]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /frobnicate/);
  assert.equal(r.stdout, "");
});

test("FR-002 across the process boundary: plan --apply exits 2 naming --apply, repo untouched", () => {
  const repo = join(cliWorldDir("review-report"), "repo");
  const before = hashTree(repo);
  const r = runBin(["plan", repo, "--apply"]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--apply/);
  assert.match(r.stderr, /read-only/);
  assert.equal(r.stdout, "");
  assert.equal(hashTree(repo), before, "the fixture repo tree must be byte-identical");
});

test("unknown flag exits 2 with a single one-line stderr message", () => {
  const r = runBin(["plan", "--wat"]);
  assert.equal(r.status, 2);
  assert.equal(r.stderr.trim().split("\n").length, 1);
  assert.match(r.stderr, /--wat/);
});
