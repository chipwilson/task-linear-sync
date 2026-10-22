/**
 * T039 [US2] — lock-race integration test (edge case "two runs contend on a stale lock":
 * exactly ONE wins). Two child processes contend for an aged dead-pid lock; a third round
 * contends while the holder is ALIVE (both must refuse). Test name contains "lock race".
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const childScript = fileURLToPath(new URL("./lock-race-child.js", import.meta.url));

let scratch: string;

before(() => {
  scratch = mkdtempSync(join(tmpdir(), "tls-race-"));
});
after(() => {
  rmSync(scratch, { recursive: true, force: true, maxRetries: 3 });
});

interface ChildResult {
  runId: string;
  acquired: boolean;
  tookOverStale?: boolean;
  heldBy?: { runId: string };
  reason?: string;
}

function runChild(stateDir: string, runId: string, repoRoot: string, resultPath: string): Promise<number> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [childScript, stateDir, runId, repoRoot, resultPath], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let err = "";
    child.stderr.on("data", (d: Buffer) => (err += d.toString()));
    child.on("error", rejectPromise);
    child.on("exit", (code) => {
      if (code !== 0) rejectPromise(new Error(`child ${runId} exited ${code}: ${err}`));
      else resolvePromise(code ?? 0);
    });
  });
}

function readResult(path: string): ChildResult {
  return JSON.parse(readFileSync(path, "utf8")) as ChildResult;
}

test("state lock matrix race — two contenders on an aged dead-pid lock: EXACTLY ONE acquires", async () => {
  const stateDir = join(scratch, "state-1");
  const repo = join(scratch, "repo-1");
  mkdirSync(repo, { recursive: true });
  mkdirSync(stateDir, { recursive: true });

  // Seed an aged lock recorded by a provably-dead pid: acquiredAt one hour ago.
  const agedIso = new Date(Date.now() - 60 * 60_000).toISOString();
  writeFileSync(
    join(stateDir, "lock.json"),
    JSON.stringify({ runId: "crashed-run", pid: 2_147_483_646, acquiredAt: agedIso }),
  );

  const r1 = join(scratch, "result-1.json");
  const r2 = join(scratch, "result-2.json");
  await Promise.all([
    runChild(stateDir, "run-A", repo, r1),
    runChild(stateDir, "run-B", repo, r2),
  ]);

  const a = readResult(r1);
  const b = readResult(r2);
  const winners = [a, b].filter((r) => r.acquired);
  assert.equal(winners.length, 1, `exactly one winner; got ${JSON.stringify([a, b])}`);
  const loser = winners[0] === a ? b : a;
  // tookOverStale depends on WHICH contender removed the aged record: if the loser
  // unlinks first, the winner's fresh exclusive-create is a clean acquisition. The
  // takeover FLAG itself is asserted deterministically in the unit lock matrix; the
  // race property is exactly-one-winner + refusal of the other.
  assert.ok(winners[0].tookOverStale === true || winners[0].tookOverStale === false);
  assert.equal(loser.acquired, false);
  // The loser either saw the winner's fresh live lock or the sustained-contention path —
  // in both cases it REFUSES with a live-process style reason, never silently proceeds.
  assert.ok(loser.reason === "live-process" || loser.reason === "within-stale-window");

  // Winner's record is the one on disk.
  const onDisk = JSON.parse(readFileSync(join(stateDir, "lock.json"), "utf8")) as { runId: string };
  assert.equal(onDisk.runId, winners[0].runId);
});

test("state lock matrix race — contention on a LIVE holder: both refuse (SC-004 zero takeover)", async () => {
  const stateDir = join(scratch, "state-2");
  const repo = join(scratch, "repo-2");
  mkdirSync(repo, { recursive: true });
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(
    join(stateDir, "lock.json"),
    // pid 1 ⇒ EPERM-or-success ⇒ alive regardless of age.
    JSON.stringify({ runId: "live-holder", pid: 1, acquiredAt: new Date(Date.now() - 3_600_000).toISOString() }),
  );
  const r1 = join(scratch, "live-1.json");
  const r2 = join(scratch, "live-2.json");
  await Promise.all([
    runChild(stateDir, "run-C", repo, r1),
    runChild(stateDir, "run-D", repo, r2),
  ]);
  assert.equal(readResult(r1).acquired, false);
  assert.equal(readResult(r2).acquired, false);
  assert.equal(readResult(r1).reason, "live-process");
  assert.equal(readResult(r2).reason, "live-process");
  assert.ok(readFileSync(join(stateDir, "lock.json"), "utf8").includes("live-holder"), "holder untouched");
});

test("state lock matrix race — fresh (uncontended) lock file absent: child acquires cleanly", async () => {
  const stateDir = join(scratch, "state-3");
  const repo = join(scratch, "repo-3");
  const r1 = join(scratch, "fresh-1.json");
  await runChild(stateDir, "run-E", repo, r1);
  assert.equal(readResult(r1).acquired, true);
  assert.equal(readResult(r1).tookOverStale, false);
  assert.ok(existsSync(join(stateDir, "lock.json")));
});
