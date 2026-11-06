/**
 * T017 [US1] — twelve-command exit-status matrix through `runCli` over the hermetic
 * CLI world (FR-001, SC-002, quickstart 1+7). Fake `LinearPort` + `RecordingQueueSurface`
 * everywhere; the default `QueueSurface` (real `src/queue/`-absent world) exercised for
 * the exit-7 posture. Every assertion of "zero effects" uses tree hashes / port request
 * logs, never output scraping alone.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { ExitCode, runCli } from "../../src/cli/index.js";
import {
  buildCliWorld,
  hashTree,
  makeWriteDroppingStore,
  type CliWorld,
} from "../helpers/cli-harness.js";

const pkgRoot = fileURLToPath(new URL("../../../", import.meta.url));
const engineWorld = (name: string): string => join(pkgRoot, "tests", "fixtures", "engine", "worlds", name);

const MUTATING_METHODS = new Set([
  "createIssue",
  "updateIssue",
  "archiveIssue",
  "upsertAttachmentByUrl",
  "updateAttachment",
]);

/** Successful-mutation calls reaching the fake port (zero-mutation proofs). */
function mutatingCalls(w: CliWorld): string[] {
  return w.world.calls.filter((c) => MUTATING_METHODS.has(c.method) && c.ok !== false).map((c) => c.method);
}

async function withWorld<T>(nameOrDir: string, fn: (w: CliWorld) => Promise<T>): Promise<T> {
  const w = await buildCliWorld(nameOrDir);
  try {
    return await fn(w);
  } finally {
    await w.dispose();
  }
}

test("inventory exits 0 with deterministic per-file listing and zero writes", async () => {
  await withWorld("review-report", async (w) => {
    const repoBefore = hashTree(w.repositoryRoot);
    const stateBefore = hashTree(w.stateDir);
    const { cliContext, stdout, stderr } = w.createContext();
    const outcome = await runCli(["inventory", w.repositoryRoot], cliContext);
    assert.equal(outcome.exitCode, ExitCode.SUCCESS, stderr.join("\n"));
    assert.ok(stdout.some((l) => /tasks=\d+/.test(l) && l.startsWith("specs/")), stdout.join("\n"));
    assert.equal(stdout.join(""), [...stdout].sort().join("")); // deterministic ordering
    assert.equal(mutatingCalls(w).length, 0);
    assert.equal(hashTree(w.repositoryRoot), repoBefore);
    assert.equal(hashTree(w.stateDir), stateBefore); // allowed write prefixes [] — nothing written
  });
});

test("discover-metadata exits 0, screens every printed line, performs zero mutations", async () => {
  await withWorld("review-report", async (w) => {
    const repoBefore = hashTree(w.repositoryRoot);
    const stateBefore = hashTree(w.stateDir);
    const { cliContext, stdout, stderr } = w.createContext();
    const outcome = await runCli(["discover-metadata", w.repositoryRoot], cliContext);
    assert.equal(outcome.exitCode, ExitCode.SUCCESS, stderr.join("\n"));
    const text = stdout.join("\n");
    assert.match(text, /TEAM-A/);
    assert.match(text, /proj-alpha/);
    assert.match(text, /Backlog/);
    // The harness screener redacts SECRET\d+ non-blockingly: the raw name never prints.
    assert.doesNotMatch(text, /SECRET\d+/);
    assert.match(text, /\[REDACTED\]/);
    assert.equal(mutatingCalls(w).length, 0);
    assert.equal(hashTree(w.repositoryRoot), repoBefore);
    assert.equal(hashTree(w.stateDir), stateBefore);
  });
});

test("plan exits 0 and prints both state-dir artifact paths; repo tree byte-identical", async () => {
  await withWorld("zero-task", async (w) => {
    const repoBefore = hashTree(w.repositoryRoot);
    const { cliContext, stdout, stderr } = w.createContext();
    const outcome = await runCli(["plan", w.repositoryRoot], cliContext);
    assert.equal(outcome.exitCode, ExitCode.SUCCESS, stderr.join("\n"));
    const json = join(w.stateDir, "reports");
    assert.ok(stdout.some((l) => l.startsWith("report ") && l.endsWith("report.json")));
    assert.ok(stdout.some((l) => l.startsWith("report ") && l.endsWith("report.md")));
    assert.ok(existsSync(json));
    assert.ok(existsSync(join(w.stateDir, "plans")));
    assert.ok(!existsSync(join(w.stateDir, "last-run.json"))); // plan runs never mark last-run
    assert.equal(hashTree(w.repositoryRoot), repoBefore);
  });
});

test("FR-002: plan with apply flags exits 2 naming every offending flag with zero effects", async () => {
  await withWorld("zero-task", async (w) => {
    const repoBefore = hashTree(w.repositoryRoot);
    const stateBefore = hashTree(w.stateDir);
    const { cliContext, stdout, stderr } = w.createContext();
    const outcome = await runCli(["plan", w.repositoryRoot, "--apply", "--accept-low-confidence"], cliContext);
    assert.equal(outcome.exitCode, ExitCode.USAGE_ERROR);
    assert.equal(stdout.length, 0);
    const err = stderr.join("\n");
    assert.match(err, /--apply/);
    assert.match(err, /--accept-low-confidence/);
    assert.equal(w.requests().length, 0);
    assert.equal(hashTree(w.repositoryRoot), repoBefore);
    assert.equal(hashTree(w.stateDir), stateBefore);
  });
});

test("FR-002: check --confirm exits 2 naming --confirm", async () => {
  await withWorld("zero-task", async (w) => {
    const { cliContext, stderr } = w.createContext();
    const outcome = await runCli(["check", w.repositoryRoot, "--confirm", "ACME"], cliContext);
    assert.equal(outcome.exitCode, ExitCode.USAGE_ERROR);
    assert.match(stderr.join("\n"), /--confirm/);
  });
});

test("check exits 0 on the clean world with exactly one CheckSummary JSON object", async () => {
  await withWorld("zero-task", async (w) => {
    const { cliContext, stdout, stderr } = w.createContext();
    const outcome = await runCli(["check", w.repositoryRoot], cliContext);
    assert.equal(outcome.exitCode, ExitCode.SUCCESS, stderr.join("\n"));
    assert.equal(stdout.length, 1, `expected one JSON line, got: ${stdout.join("\n")}`);
    const summary = JSON.parse(stdout[0] as string) as {
      schemaVersion: number;
      planId: string;
      reportJson: string;
      reportMarkdown: string;
      counts: Record<string, number>;
    };
    assert.equal(summary.schemaVersion, 1);
    assert.match(summary.planId, /^[0-9a-f]{64}$/);
    assert.ok(summary.reportJson.startsWith(join(w.stateDir, "reports")) && summary.reportJson.endsWith("report.json"));
    assert.ok(summary.reportMarkdown.startsWith(join(w.stateDir, "reports")) && summary.reportMarkdown.endsWith("report.md"));
    for (const key of ["entries", "unmapped", "unresolvedConflicts", "lowConfidence"]) {
      assert.equal(typeof summary.counts[key], "number", `counts.${key}`);
    }
  });
});

test("check exits 8 on the review-report world (unresolved-conflict entry)", async () => {
  await withWorld("review-report", async (w) => {
    const { cliContext, stdout, stderr } = w.createContext();
    const outcome = await runCli(["check", w.repositoryRoot], cliContext);
    assert.equal(outcome.exitCode, ExitCode.CHECK_FINDINGS, stderr.join("\n"));
    assert.equal(stdout.length, 1);
    const summary = JSON.parse(stdout[0] as string) as { counts: { unresolvedConflicts: number } };
    assert.ok(summary.counts.unresolvedConflicts >= 1);
  });
});

test("check with a vanished report artifact exits 5 naming it (never a silent 0)", async () => {
  await withWorld("zero-task", async (w) => {
    const dropping = makeWriteDroppingStore(w.state, (rel) => rel.startsWith("reports/"));
    const { cliContext, stderr } = w.createContext({ makeState: () => dropping });
    const outcome = await runCli(["check", w.repositoryRoot], cliContext);
    assert.equal(outcome.exitCode, ExitCode.RUN_ABORTED);
    assert.match(stderr.join("\n"), /reports\//);
  });
});

test("bootstrap refuses without --plan (2), with a wrong --confirm (4), succeeds with the trio (0)", async () => {
  await withWorld(engineWorld("first-run-bootstrap"), async (w) => {
    // 1 — missing --plan: usage error naming the flag, nothing executed.
    {
      const { cliContext, stdout, stderr } = w.createContext();
      const outcome = await runCli(["bootstrap", w.repositoryRoot, "--apply", "--confirm", "ACME"], cliContext);
      assert.equal(outcome.exitCode, ExitCode.USAGE_ERROR);
      assert.match(stderr.join("\n"), /--plan/);
      assert.equal(stdout.length, 0);
    }
    // plan first so a stored plan exists.
    {
      const { cliContext, stderr } = w.createContext();
      const planned = await runCli(["plan", w.repositoryRoot], cliContext);
      assert.equal(planned.exitCode, ExitCode.SUCCESS, stderr.join("\n"));
    }
    const planId = onlyPlanId(w);
    // 2 — wrong confirmation key: gate refusal (4) naming the frozen code.
    {
      const { cliContext, stderr } = w.createContext();
      const outcome = await runCli(
        ["bootstrap", w.repositoryRoot, "--plan", planId, "--apply", "--confirm", "WRONG"],
        cliContext,
      );
      assert.equal(outcome.exitCode, ExitCode.GATE_REFUSED, stderr.join("\n"));
      assert.match(stderr.join("\n"), /CONFIRMATION_KEY_MISMATCH/);
      assert.equal(mutatingCalls(w).length, 0); // refusals mutate nothing
    }
    // 3 — the frozen gate trio succeeds; marker + report paths appear.
    {
      const { cliContext, stdout, stderr } = w.createContext();
      const outcome = await runCli(
        ["bootstrap", w.repositoryRoot, "--plan", planId, "--apply", "--confirm", "ACME", "--accept-low-confidence"],
        cliContext,
      );
      assert.equal(outcome.exitCode, ExitCode.SUCCESS, stderr.join("\n"));
      const text = stdout.join("\n");
      assert.match(text, /applied run [0-9a-f]{64}/);
      assert.match(text, /report .*report\.json/);
      assert.ok(mutatingCalls(w).length > 0);
      assert.ok(existsSync(join(w.stateDir, "last-run.json")));
    }
  });
});

test("sync applies a reviewed plan through the same engine path (exit 0)", async () => {
  await withWorld(engineWorld("first-run-bootstrap"), async (w) => {
    {
      const { cliContext, stderr } = w.createContext();
      assert.equal((await runCli(["plan", w.repositoryRoot], cliContext)).exitCode, 0, stderr.join("\n"));
      const planId = onlyPlanId(w);
      assert.equal(
        (
          await runCli(
            ["bootstrap", w.repositoryRoot, "--plan", planId, "--apply", "--confirm", "ACME", "--accept-low-confidence"],
            cliContext,
          )
        ).exitCode,
        0,
        stderr.join("\n"),
      );
    }
    {
      const { cliContext, stdout, stderr } = w.createContext();
      const planned = await runCli(["plan", w.repositoryRoot], cliContext);
      assert.equal(planned.exitCode, ExitCode.SUCCESS, stderr.join("\n"));
      // A second plan after the bootstrap stores a SECOND plan file — read the fresh
      // plan id off the `plan` output rather than the plans/ directory.
      const planId = /plan ([0-9a-f]{64})/.exec(stdout.join("\n"))?.[1];
      assert.ok(planId, stdout.join("\n"));
      const outcome = await runCli(
        ["sync", w.repositoryRoot, "--plan", planId as string, "--apply", "--confirm", "ACME", "--accept-low-confidence"],
        cliContext,
      );
      assert.equal(outcome.exitCode, ExitCode.SUCCESS, stderr.join("\n"));
      assert.match(stdout.join("\n"), /applied run [0-9a-f]{64}/);
    }
  });
});

test("queue commands present fake outcomes (installed/enqueued/stopped → 0, refused → 4)", async () => {
  await withWorld("zero-task", async (w) => {
    const { cliContext, stdout, stderr } = w.createContext();

    let outcome = await runCli(["install-hooks", w.repositoryRoot], cliContext);
    assert.equal(outcome.exitCode, ExitCode.SUCCESS, stderr.join("\n"));
    assert.match(stdout.join("\n"), /installed/);
    assert.equal(w.queue?.records.installHooks.length, 1);
    assert.equal(w.queue?.records.installHooks[0]?.repositoryRoot, w.repositoryRoot);

    outcome = await runCli(["enqueue", w.repositoryRoot, "--mode", "sync"], cliContext);
    assert.equal(outcome.exitCode, ExitCode.SUCCESS, stderr.join("\n"));
    assert.match(stdout.join("\n"), /enqueued/);
    assert.equal(w.queue?.records.enqueue[0]?.mode, "sync");

    outcome = await runCli(["worker", w.repositoryRoot, "--once"], cliContext);
    assert.equal(outcome.exitCode, ExitCode.SUCCESS, stderr.join("\n"));
    assert.match(stdout.join("\n"), /stopped/);
    assert.equal(w.queue?.records.runWorker[0]?.once, true);

    w.queue?.inject("enqueue", { status: "refused", detail: "a job is already pending" });
    const before = stdout.length;
    outcome = await runCli(["enqueue", w.repositoryRoot, "--mode", "bootstrap"], cliContext);
    assert.equal(outcome.exitCode, ExitCode.GATE_REFUSED);
    assert.match(stderr.join("\n"), /a job is already pending/);
    assert.equal(stdout.length, before); // refusals print nothing on stdout
  });
});

test("install-agent-hook scaffolds with zero tracker network and never overwrites", async () => {
  await withWorld("zero-task", async (w) => {
    const requestsBefore = w.requests().length;
    const { cliContext, stdout, stderr } = w.createContext();
    const outcome = await runCli(["install-agent-hook", w.repositoryRoot, "--framework", "kiro"], cliContext);
    assert.equal(outcome.exitCode, ExitCode.SUCCESS, stderr.join("\n"));
    assert.match(stdout.join("\n"), /kiro\/hooks|hooks/);
    assert.equal(w.requests().length, requestsBefore); // FR-003: zero network through the seam
    // Second run: the fake refuses to overwrite → exit 4 (contract §1 rule 2).
    const second = await runCli(["install-agent-hook", w.repositoryRoot, "--framework", "kiro"], cliContext);
    assert.equal(second.exitCode, ExitCode.GATE_REFUSED);
  });
});

test("T026: queue commands on the DEFAULT surface run through the real 010 module (frozen default semantics)", async () => {
  await withWorld("zero-task", async (w) => {
    const stateBefore = hashTree(w.stateDir);
    const { createDefaultQueueSurface } = await import("../../src/cli/index.js");

    // install-hooks: real 010 refusal (this world has no .git) — exit 4, no unavailability talk.
    {
      const { cliContext, stderr, stdout } = w.createContext({ queueSurface: createDefaultQueueSurface() });
      const outcome = await runCli(["install-hooks", w.repositoryRoot], cliContext);
      assert.equal(outcome.exitCode, ExitCode.GATE_REFUSED, stderr.join("\n"));
      assert.match(stderr.join("\n"), /\.git/);
      assert.doesNotMatch(stderr.join("\n"), /task-linear-sync\/queue/);
      assert.equal(stdout.length, 0, "refusals print nothing on stdout");
    }
    // install-agent-hook: real scaffold write, still zero tracker network (FR-003).
    {
      const { cliContext, stdout } = w.createContext({ queueSurface: createDefaultQueueSurface() });
      const outcome = await runCli(["install-agent-hook", w.repositoryRoot], cliContext);
      assert.equal(outcome.exitCode, ExitCode.SUCCESS, stdout.join("\n"));
      assert.match(stdout.join("\n"), /hooks/);
      assert.ok(existsSync(join(w.repositoryRoot, ".kiro", "hooks")));
    }
    // worker --once on the empty slot BEFORE any enqueue: stopped, nothing written.
    {
      const { cliContext, stdout } = w.createContext({ queueSurface: createDefaultQueueSurface() });
      const outcome = await runCli(["worker", w.repositoryRoot, "--once"], cliContext);
      assert.equal(outcome.exitCode, ExitCode.SUCCESS, stdout.join("\n"));
      assert.match(stdout.join("\n"), /stopped/);
      assert.equal(hashTree(w.stateDir), stateBefore, "an empty-slot pass writes nothing");
    }
    // enqueue: the durable fast path lands the pending job through the real module.
    {
      const { cliContext, stdout } = w.createContext({ queueSurface: createDefaultQueueSurface() });
      const outcome = await runCli(["enqueue", w.repositoryRoot, "--mode", "sync"], cliContext);
      assert.equal(outcome.exitCode, ExitCode.SUCCESS, stdout.join("\n"));
      assert.match(stdout.join("\n"), /enqueued/);
      assert.ok(existsSync(join(w.stateDir, "pending-job.json")), "the job is durable in the state dir");
    }
    assert.equal(w.requests().length, 0); // no queue command touches the tracker
  });
});

test("last-run reports no marker cleanly (0) and an engine-written marker in human and --json modes", async () => {
  await withWorld("zero-task", async (w) => {
    const { cliContext, stdout, stderr } = w.createContext();
    const outcome = await runCli(["last-run", w.repositoryRoot], cliContext);
    assert.equal(outcome.exitCode, ExitCode.SUCCESS, stderr.join("\n"));
    assert.match(stdout.join("\n"), /no run recorded yet/);

    const jsonRun = await runCli(["last-run", w.repositoryRoot, "--json"], cliContext);
    assert.equal(jsonRun.exitCode, ExitCode.SUCCESS);
    assert.equal(stdout.length, 2); // the human line above + exactly one JSON line
    assert.deepEqual(JSON.parse(stdout[1] as string), { found: false });
  });
  await withWorld(engineWorld("first-run-bootstrap"), async (w) => {
    const { cliContext, stdout, stderr } = w.createContext();
    assert.equal((await runCli(["plan", w.repositoryRoot], cliContext)).exitCode, 0, stderr.join("\n"));
    const planId = onlyPlanId(w);
    assert.equal(
      (
        await runCli(
          ["bootstrap", w.repositoryRoot, "--plan", planId, "--apply", "--confirm", "ACME", "--accept-low-confidence"],
          cliContext,
        )
      ).exitCode,
      0,
      stderr.join("\n"),
    );
    const found = await runCli(["last-run", w.repositoryRoot], cliContext);
    assert.equal(found.exitCode, ExitCode.SUCCESS);
    assert.match(stdout.join("\n"), /last run [0-9a-f]{64}/);

    const before = stdout.length;
    const asJson = await runCli(["last-run", w.repositoryRoot, "--json"], cliContext);
    assert.equal(asJson.exitCode, ExitCode.SUCCESS);
    assert.equal(stdout.length, before + 1);
    const doc = JSON.parse(stdout[before] as string) as { found: boolean; marker?: { runId: string } };
    assert.equal(doc.found, true);
    assert.match(doc.marker?.runId ?? "", /^[0-9a-f]{64}$/);
  });
});

test("rollback exits 4 for an unknown run (frozen MANIFEST_UNJOURNALED) and 0 after a journaled apply", async () => {
  await withWorld(engineWorld("first-run-bootstrap"), async (w) => {
    // Unknown runId — refusal, zero mutations.
    {
      const { cliContext, stderr } = w.createContext();
      const outcome = await runCli(["rollback", w.repositoryRoot, "f".repeat(64)], cliContext);
      assert.equal(outcome.exitCode, ExitCode.GATE_REFUSED, stderr.join("\n"));
      assert.match(stderr.join("\n"), /MANIFEST_UNJOURNALED/);
      assert.equal(mutatingCalls(w).length, 0);
    }
    // Apply, then roll the run back through the engine (SC-002 rollback row).
    const { cliContext, stdout, stderr } = w.createContext();
    assert.equal((await runCli(["plan", w.repositoryRoot], cliContext)).exitCode, 0, stderr.join("\n"));
    const planId = onlyPlanId(w);
    assert.equal(
      (
        await runCli(
          ["bootstrap", w.repositoryRoot, "--plan", planId, "--apply", "--confirm", "ACME", "--accept-low-confidence"],
          cliContext,
        )
      ).exitCode,
      0,
      stderr.join("\n"),
    );
    const runId = /applied run ([0-9a-f]{64})/.exec(stdout.join("\n"))?.[1];
    assert.ok(runId, stdout.join("\n"));
    const outcome = await runCli(["rollback", w.repositoryRoot, runId as string], cliContext);
    assert.equal(outcome.exitCode, ExitCode.SUCCESS, stderr.join("\n"));
    assert.match(stdout.join("\n"), /rolled back run [0-9a-f]{64}/);
  });
});

test("every printed line is screened: a blocking finding maps the outcome to 5", async () => {
  await withWorld("review-report", async (w) => {
    const blockingScreener = {
      screen: (text: string) => ({
        output: text,
        blocked: text.includes("TEAM-A") ? ["blocking-secret"] : [],
        findings: [] as string[],
      }),
    };
    const { cliContext, stdout, stderr } = w.createContext({ makeScreener: () => blockingScreener });
    const outcome = await runCli(["discover-metadata", w.repositoryRoot], cliContext);
    assert.equal(outcome.exitCode, ExitCode.RUN_ABORTED, stderr.join("\n"));
    assert.ok(stdout.every((l) => !l.includes("TEAM-A")));
    assert.ok(stdout.some((l) => l.includes("[output blocked by security screening:")));
  });
});

/** The single stored planId in the world's plans/ directory (exactly one plan). */
function onlyPlanId(w: CliWorld): string {
  const plans = readdirSync(join(w.stateDir, "plans"));
  assert.equal(plans.length, 1, `expected one stored plan, found: ${plans.join(", ")}`);
  const id = (plans[0] as string).replace(/\.json$/, "");
  assert.match(id, /^[0-9a-f]{64}$/);
  const stored = JSON.parse(readFileSync(join(w.stateDir, "plans", `${id}.json`), "utf8")) as {
    plan: { planId: string };
  };
  assert.equal(stored.plan.planId, id);
  return id;
}
