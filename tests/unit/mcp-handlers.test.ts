/**
 * T030 [US1] — unit tests for the three read tool cores in `src/mcp/handlers.ts`
 * (FR-001/FR-005; research R4/R7; tool-definitions.md §3). Tests written FIRST.
 */

import assert from "node:assert/strict";
import test from "node:test";

import type { CliContext } from "../../src/cli/index.js";
import { ExitCode } from "../../src/cli/index.js";
import { runCli } from "../../src/cli/index.js";
import { createSyncEngine, derivePlanReportRunId } from "../../src/engine/index.js";
import type { SyncEngine } from "../../src/ports/index.js";
import { createReadHandlers } from "../../src/mcp/handlers.js";
import { createPlanReferenceStore } from "../../src/mcp/plan-store.js";
import { buildCliWorld } from "../helpers/cli-harness.js";


const MUTATING_METHODS = new Set([
  "createIssue",
  "updateIssue",
  "archiveIssue",
  "upsertAttachmentByUrl",
  "updateAttachment",
]);

async function fixture(profile: "zero-task" | "review-report" = "review-report") {
  const world = await buildCliWorld(profile);
  const store = createPlanReferenceStore(world.clock);
  const { cliContext } = world.createContext();
  const handlers = createReadHandlers({
    cliContext: cliContext as unknown as CliContext,
    state: world.state,
    clock: world.clock,
    screener: world.world.screener,
    repositoryRoot: world.repositoryRoot,
    store,
  });
  return { world, store, handlers };
}

function text(payload: unknown): string {
  return JSON.stringify(payload);
}

test("mcp-handlers: task_sync_plan succeeds on the exit-0 lane AND embeds the frozen report verbatim", async () => {
  const fx = await fixture("zero-task");
  try {
    // Pin the lane itself at exit 0 for this world.
    const probe = await runCli(["check"], fx.world.createContext().cliContext as unknown as CliContext);
    assert.equal(probe.exitCode, ExitCode.SUCCESS);

    const outcome = await fx.handlers.task_sync_plan();
    assert.equal(outcome.ok, true, text(outcome as object));
    const payload = (outcome as { payload: Record<string, unknown> }).payload;
    assert.deepEqual(Object.keys(payload), [
      "schemaVersion",
      "planReference",
      "generatedAt",
      "lowConfidencePresent",
      "counts",
      "securityAssertions",
      "report",
    ]);
    assert.match(String(payload.planReference), /^[0-9a-f]{64}$/);
    const report = await fx.world.state.readJson<Record<string, unknown>>(
      `reports/${derivePlanReportRunId(String(payload.planReference), fx.world.clock)}/report.json`,
    );
    assert.ok(report, "report.json exists at the derived path");
    assert.deepEqual(payload.report, report, "report is the frozen PlanReportJson verbatim");
    assert.deepEqual(payload.securityAssertions, report?.securityAssertions);
    assert.equal("reportMarkdown" in payload, false, "the Markdown sibling is never returned");
    assert.equal(fx.store.has(String(payload.planReference)), true, "plan success RECORDS the reference");
  } finally {
    await fx.world.dispose();
  }
});

test("mcp-handlers: task_sync_plan treats CHECK_FINDINGS (exit 8) as SUCCESS — findings are content — and records too", async () => {
  const fx = await fixture("review-report");
  try {
    // Pin the lane itself at exit 8 for this world (the other half of the exit pair).
    const probe = await runCli(["check"], fx.world.createContext().cliContext as unknown as CliContext);
    assert.equal(probe.exitCode, ExitCode.CHECK_FINDINGS);

    const outcome = await fx.handlers.task_sync_plan();
    assert.equal(outcome.ok, true, text(outcome as object));
    const payload = (outcome as { payload: Record<string, unknown> }).payload;
    assert.equal(payload.lowConfidencePresent, true, "the findings world carries low confidence");
    assert.equal(fx.store.has(String(payload.planReference)), true);
  } finally {
    await fx.world.dispose();
  }
});

test("mcp-handlers: a non-zero non-8 lane exit becomes LANE_FAILURE carrying the SCREENED stderr line", async () => {
  const world = await buildCliWorld("review-report");
  try {
    const store = createPlanReferenceStore(world.clock);
    const broken = world.createContext({
      loadConfig: () => {
        throw new Error("config boom for lane-failure unit");
      },
    }).cliContext;
    const handlers = createReadHandlers({
      cliContext: broken as unknown as CliContext,
      state: world.state,
      clock: world.clock,
      screener: world.world.screener,
      repositoryRoot: world.repositoryRoot,
      store,
    });
    const outcome = await handlers.task_sync_plan();
    assert.equal(outcome.ok, false);
    const refusal = (outcome as { refusal: { code: string; detail: string } }).refusal;
    assert.equal(refusal.code, "LANE_FAILURE");
    assert.ok(
      refusal.detail.includes("config boom for lane-failure unit"),
      `detail carries the stderr line, got: ${refusal.detail}`,
    );
    assert.equal(refusal.detail.includes("    at "), false, "never a stack");
    assert.equal(store.size, 0, "a failed lane records nothing");
  } finally {
    await world.dispose();
  }
});

test("mcp-handlers: task_sync_inventory composes files/refusals/warnings — paths + counts only, zero port calls", async () => {
  const fx = await fixture("review-report");
  try {
    const outcome = await fx.handlers.task_sync_inventory();
    assert.equal(outcome.ok, true, text(outcome as object));
    const payload = (outcome as { payload: Record<string, unknown> }).payload;
    assert.deepEqual(Object.keys(payload), ["schemaVersion", "files", "refusals", "warnings"]);
    const files = payload.files as Array<Record<string, unknown>>;
    assert.ok(files.length > 0, "the review-report world carries task files");
    for (const file of files) {
      assert.deepEqual(Object.keys(file), ["filePath", "framework", "taskCount"]);
      assert.equal(typeof file.filePath, "string");
      assert.equal(typeof file.framework, "string");
      assert.equal(typeof file.taskCount, "number");
    }
    assert.ok(Array.isArray(payload.refusals));
    assert.ok(Array.isArray(payload.warnings));
    assert.equal(fx.world.requests().length, 0, "inventory is a zero-port-call lane");
  } finally {
    await fx.world.dispose();
  }
});

test("mcp-handlers: task_sync_status with nothing seeded — lastRun null, empty queue, zero port calls", async () => {
  const fx = await fixture("zero-task");
  try {
    const outcome = await fx.handlers.task_sync_status();
    assert.equal(outcome.ok, true, text(outcome as object));
    const payload = (outcome as { payload: Record<string, unknown> }).payload;
    assert.deepEqual(Object.keys(payload), ["schemaVersion", "lastRun", "queue", "session"]);
    assert.equal(payload.lastRun, null);
    assert.deepEqual(payload.queue, { pendingJob: null, workerRunning: false });
    assert.deepEqual(payload.session, { planReferencesAvailable: 0 });
    assert.equal(fx.world.requests().length, 0);
  } finally {
    await fx.world.dispose();
  }
});

test("mcp-handlers: task_sync_status composes marker + pending job + queue lock + session count", async () => {
  const fx = await fixture("review-report");
  try {
    await fx.world.state.writeJson("last-run.json", {
      runId: "a".repeat(64),
      outcome: "completed",
      completedAt: "2026-01-02T03:04:05.000Z",
      reportPaths: null,
      notificationSuppressed: false,
    });
    await fx.world.state.writeJson("pending-job.json", {
      schemaVersion: 1,
      jobId: "b".repeat(16),
      mode: "sync",
      trigger: "agent-hook",
      enqueuedAt: "2026-01-03T00:00:00.000Z",
      updatedAt: "2026-01-03T00:00:00.000Z",
      retryCount: 0,
      claim: { workerId: "w-1", pid: 4242, claimedAt: "2026-01-03T00:00:01.000Z" },
    });
    const plan = await fx.handlers.task_sync_plan();
    assert.equal(plan.ok, true);

    const outcome = await fx.handlers.task_sync_status();
    assert.equal(outcome.ok, true, text(outcome as object));
    const payload = (outcome as { payload: Record<string, unknown> }).payload;
    assert.equal((payload.lastRun as Record<string, unknown>).runId, "a".repeat(64));
    const queue = payload.queue as Record<string, unknown>;
    assert.equal(queue.workerRunning, true, "claimed job ⇒ worker running");
    const job = queue.pendingJob as Record<string, unknown>;
    assert.deepEqual(job, {
      mode: "sync",
      trigger: "agent-hook",
      queuedAt: "2026-01-03T00:00:00.000Z",
    }, "enqueuedAt maps to queuedAt; no raw job fields leak");
    assert.deepEqual(payload.session, { planReferencesAvailable: 1 });
  } finally {
    await fx.world.dispose();
  }
});

test("mcp-handlers: read cores NEVER reach applySyncPlan/rollbackRun — engine spy proves engine-gates rule 4", async () => {
  const fx = await fixture("review-report");
  try {
    const reached: string[] = [];
    const real = createSyncEngine(fx.world.deps, { keyProvider: fx.world.keyProvider });
    const spy: SyncEngine = {
      ...real,
      applySyncPlan: async () => {
        reached.push("applySyncPlan");
        throw new Error("read lane must never apply");
      },
      rollbackRun: async () => {
        reached.push("rollbackRun");
        throw new Error("read lane must never roll back");
      },
    };
    const { cliContext } = fx.world.createContext({ makeEngine: () => spy });
    const handlers = createReadHandlers({
      cliContext: cliContext as unknown as CliContext,
      state: fx.world.state,
      clock: fx.world.clock,
      screener: fx.world.world.screener,
      repositoryRoot: fx.world.repositoryRoot,
      store: fx.store,
    });
    assert.equal((await handlers.task_sync_plan()).ok, true);
    assert.equal((await handlers.task_sync_inventory()).ok, true);
    assert.equal((await handlers.task_sync_status()).ok, true);
    assert.deepEqual(reached, []);
    for (const call of fx.world.fake.callLog) {
      assert.equal(MUTATING_METHODS.has(call.method), false, `mutation call reached the port: ${call.method}`);
    }
  } finally {
    await fx.world.dispose();
  }
});
