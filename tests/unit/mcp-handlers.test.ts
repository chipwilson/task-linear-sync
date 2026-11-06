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
import { createReadHandlers, createApplyHandler } from "../../src/mcp/handlers.js";
import { createAgentToolServer } from "../../src/mcp/index.js";
import type { AgentToolServerApp } from "../../src/mcp/index.js";
import type { ServerBag } from "../../src/mcp/create.js";
import { createPlanReferenceStore } from "../../src/mcp/plan-store.js";
import { buildCliWorld } from "../helpers/cli-harness.js";
import { validateToolArguments } from "../../src/mcp/tools.js";


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

// ───────────────────────── T040 [US2] — the apply pipeline (apply-gating.md §1–§2) ──

const WRONG_KEY = "wrong-confirmation-key";

interface ApplyCall {
  readonly plan: unknown;
  readonly gates: Record<string, unknown>;
}

interface ApplyFixture {
  readonly world: Awaited<ReturnType<typeof buildCliWorld>>;
  readonly app: AgentToolServerApp & { readonly bag: ServerBag };
  readonly applyCalls: ApplyCall[];
  readonly stateReads: string[];
}

async function applyFixture(settings: Record<string, unknown> = {}): Promise<ApplyFixture> {
  const world = await buildCliWorld("review-report");
  const applyCalls: ApplyCall[] = [];
  const stateReads: string[] = [];
  const state = new Proxy(world.state, {
    get(target, prop: string | symbol) {
      if (prop === "readJson") {
        return (path: string, ...rest: unknown[]) => {
          stateReads.push(path);
          return (target.readJson as (p: string, ...r: unknown[]) => unknown)(path, ...rest);
        };
      }
      const value = Reflect.get(target, prop) as unknown;
      return typeof value === "function" ? (value as CallableFunction).bind(target) : value;
    },
  });
  const app = createAgentToolServer({
    config: world.config,
    env: world.env,
    clock: world.clock,
    state,
    port: world.port,
    screener: world.world.screener,
    repositoryRoot: world.repositoryRoot,
    settings: { transport: "stdio", enabled: true, ...settings } as never,
  });
  // Wrap the app's OWN engine so the test observes the EXACT applySyncPlan call; the
  // real engine runs underneath (gate vocabulary + refusals stay genuine).
  const realEngine = app.bag.engine;
  const spyEngine = Object.create(realEngine as object, {
    applySyncPlan: {
      value: async (
        plan: Parameters<typeof realEngine.applySyncPlan>[0],
        gates: Parameters<typeof realEngine.applySyncPlan>[1],
      ) => {
        applyCalls.push({ plan, gates: gates as unknown as Record<string, unknown> });
        return realEngine.applySyncPlan(plan, gates);
      },
    },
  });
  // Register the apply core over the app's OWN store + the spying engine (US2 wiring).
  const applyCore = createApplyHandler({
    settings: app.settings,
    store: app.store,
    state,
    engine: spyEngine,
    screener: world.world.screener,
    config: world.config,
  });
  app.bag.registerCore("task_sync_apply", (args: unknown) => {
    const outcome = applyCore((args ?? {}) as never);
    return outcome.then((res) =>
      res.ok
        ? { content: [{ type: "text" as const, text: JSON.stringify(res.payload) }] }
        : "gateFailures" in res
          ? { content: [{ type: "text" as const, text: JSON.stringify({ schemaVersion: 1, status: "refused", error: res.gateFailures }) }], isError: true as const }
          : { content: [{ type: "text" as const, text: JSON.stringify({ schemaVersion: 1, status: "refused", error: res.refusal.code, failures: [res.refusal] }) }], isError: true as const },
    );
  });
  return { world, app, applyCalls, stateReads };
}

async function session(app: ReturnType<typeof createAgentToolServer>): Promise<void> {
  const init = await app.handleMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  assert.ok(init);
  await app.handleMessage({ jsonrpc: "2.0", method: "notifications/initialized" });
}

async function callTool(app: ReturnType<typeof createAgentToolServer>, id: number, name: string, args: unknown) {
  const reply = await app.handleMessage({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });
  assert.ok(reply && "result" in reply, `expected a result for ${name}, got ${JSON.stringify(reply)}`);
  return reply.result as { isError?: true; content: Array<{ text: string }> };
}

function refusalText(result: { content: Array<{ text: string }> }): Record<string, unknown> {
  return JSON.parse(result.content[0]!.text) as Record<string, unknown>;
}

function planArgs(world: Awaited<ReturnType<typeof buildCliWorld>>, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    planReference: "d".repeat(64),
    confirmationKey: world.config.confirmationKey,
    ...overrides,
  };
}

test("mcp-apply: enabled:false ⇒ MUTATING_TOOLS_DISABLED naming mcp.enabled with ZERO state/port/engine touch", async () => {
  const fx = await applyFixture({ enabled: false });
  try {
    await session(fx.app);
    const result = await callTool(fx.app, 41, "task_sync_apply", planArgs(fx.world));
    assert.equal(result.isError, true);
    const body = refusalText(result);
    assert.equal(body.error, "MUTATING_TOOLS_DISABLED");
    assert.ok(JSON.stringify(body).includes("mcp.enabled"), "names the config key");
    assert.deepEqual(fx.applyCalls, [], "engine untouched");
    assert.deepEqual(fx.stateReads, [], "state spy: ZERO reads");
    assert.equal(fx.world.requests().length, 0, "zero port calls");
  } finally {
    await fx.world.dispose();
  }
});

test("mcp-apply: argument-shape faults ⇒ INVALID_ARGUMENTS listing ALL problems BEFORE the store is consulted", async () => {
  const fx = await applyFixture();
  try {
    await session(fx.app);
    const result = await callTool(fx.app, 41, "task_sync_apply", {
      planReference: "ZZZ-not-hex",
      acceptLowConfidence: "yes",
      surprise: 1,
    });
    assert.equal(result.isError, true);
    const raw = result.content[0]!.text;
    const body = refusalText(result);
    assert.equal(body.error, "INVALID_ARGUMENTS");
    const issues = JSON.stringify(body.issues);
    for (const expected of ["planReference", "confirmationKey", "acceptLowConfidence", "surprise"]) {
      assert.ok(issues.includes(expected), `issue listing names ${expected}: ${raw}`);
    }
    assert.equal(fx.stateReads.length, 0, "the store/state was never consulted");
    assert.deepEqual(fx.applyCalls, []);
    // The validator is the SAME predicate the inputSchema advertises (tools.ts).
    const schemaIssues = validateToolArguments("task_sync_apply", {
      planReference: "ZZZ-not-hex",
      acceptLowConfidence: "yes",
      surprise: 1,
    });
    assert.ok(schemaIssues.length >= 4);
  } finally {
    await fx.world.dispose();
  }
});

test("mcp-apply: a reference NOT produced this session ⇒ PLAN_REFERENCE_UNKNOWN with zero state reads and zero port calls", async () => {
  const fx = await applyFixture();
  try {
    await session(fx.app);
    const result = await callTool(fx.app, 41, "task_sync_apply", planArgs(fx.world));
    assert.equal(result.isError, true);
    const body = refusalText(result);
    const failures = JSON.stringify(body);
    assert.ok(failures.includes("PLAN_REFERENCE_UNKNOWN"), failures);
    assert.ok(failures.includes("no plan reference produced in this session; run task_sync_plan"), failures);
    assert.equal(fx.stateReads.length, 0, "step 3 short-circuits BEFORE any state read");
    assert.deepEqual(fx.applyCalls, []);
    assert.equal(fx.world.requests().length, 0);
  } finally {
    await fx.world.dispose();
  }
});

test("mcp-apply: session-recorded reference whose stored plan is missing ⇒ PLAN_REFERENCE_UNKNOWN, zero port calls", async () => {
  const fx = await applyFixture();
  try {
    fx.app.store.record("d".repeat(64)); // session membership WITHOUT a stored plan
    await session(fx.app);
    const result = await callTool(fx.app, 41, "task_sync_apply", planArgs(fx.world));
    assert.equal(result.isError, true);
    assert.ok(JSON.stringify(refusalText(result)).includes("PLAN_REFERENCE_UNKNOWN"));
    assert.deepEqual(fx.stateReads, [`plans/${"d".repeat(64)}.json`], "exactly the plan read");
    assert.deepEqual(fx.applyCalls, []);
    assert.equal(fx.world.requests().length, 0);
  } finally {
    await fx.world.dispose();
  }
});

test("mcp-apply: happy path — ONE engine call with EXACTLY the frozen GateRequest fields; §4 payload", async () => {
  const fx = await applyFixture();
  try {
    await session(fx.app);
    const planCall = await callTool(fx.app, 2, "task_sync_plan", {});
    const planPayload = refusalText(planCall);
    const planReference = String(planPayload.planReference);

    const result = await callTool(fx.app, 3, "task_sync_apply", planArgs(fx.world, { planReference, acceptLowConfidence: true }));
    assert.notEqual(result.isError, true, `apply refused: ${result.content[0]!.text}`);
    const engineCall = fx.applyCalls[0];
    assert.ok(engineCall, "exactly ONE engine call");
    const gates = engineCall.gates;
    assert.deepEqual(Object.keys(gates).sort(), ["acceptLowConfidence", "applyFlag", "confirmationKey", "planReference"]);
    assert.deepEqual(gates, {
      applyFlag: true,
      confirmationKey: fx.world.config.confirmationKey,
      acceptLowConfidence: true,
      planReference,
    });
    const payload = refusalText(result);
    assert.deepEqual(Object.keys(payload), ["schemaVersion", "runId", "status", "counts", "reportPaths"]);
    assert.equal(payload.schemaVersion, 1);
    assert.equal(payload.status, "applied");
    assert.equal(typeof payload.runId, "string");
    const counts = payload.counts as Record<string, unknown>;
    assert.deepEqual(Object.keys(counts), ["applied", "skipped", "failed"]);
    const reportPaths = payload.reportPaths as Record<string, unknown>;
    assert.equal(typeof reportPaths.json, "string");
    assert.equal(typeof reportPaths.markdown, "string");
    assert.ok(
      fx.world.fake.callLog.some((c) => MUTATING_METHODS.has(String(c.method))),
      "the fake port saw mutations",
    );
  } finally {
    await fx.world.dispose();
  }
});

test("mcp-apply: tools/list at defaults hides task_sync_apply (SC-003 registration gate)", async () => {
  const fx = await applyFixture({ enabled: false });
  try {
    await session(fx.app);
    const listing = await fx.app.handleMessage({ jsonrpc: "2.0", id: 9, method: "tools/list" });
    assert.ok(listing && "result" in listing);
    const names = (listing.result as { tools: Array<{ name: string }> }).tools.map((t) => t.name);
    assert.deepEqual(names.sort(), ["task_sync_inventory", "task_sync_plan", "task_sync_status"]);
    assert.equal(names.includes("task_sync_apply"), false, "disabled apply is INVISIBLE in the listing");
  } finally {
    await fx.world.dispose();
  }
});

test("mcp-apply: engine refusal ⇒ isError listing EVERY gateFailure verbatim, never echoing the presented key", async () => {
  const fx = await applyFixture();
  try {
    await session(fx.app);
    const planCall = await callTool(fx.app, 2, "task_sync_plan", {});
    const planReference = String(refusalText(planCall).planReference);

    const result = await callTool(fx.app, 3, "task_sync_apply", planArgs(fx.world, { planReference, confirmationKey: WRONG_KEY }));
    assert.equal(result.isError, true);
    const raw = result.content[0]!.text;
    assert.ok(raw.includes("CONFIRMATION_KEY_MISMATCH"), raw);
    assert.equal(raw.includes(WRONG_KEY), false, "the presented confirmation key is NEVER echoed");
    assert.equal(fx.applyCalls.length, 1, "the refusal came FROM the engine");
  } finally {
    await fx.world.dispose();
  }
});

test("mcp-apply: fresh store (restart posture) refuses an older process's stored plan — never wall-clock/TTL", async () => {
  const fx = await applyFixture();
  try {
    await session(fx.app);
    const planCall = await callTool(fx.app, 2, "task_sync_plan", {});
    const planReference = String(refusalText(planCall).planReference);

    // A FRESH store — new session, same world (the restart rule, apply-gating §2.2).
    const fresh = await applyFixture();
    try {
      await session(fresh.app);
      const result = await callTool(fresh.app, 3, "task_sync_apply", planArgs(fresh.world, { planReference }));
      assert.equal(result.isError, true);
      assert.ok(JSON.stringify(refusalText(result)).includes("PLAN_REFERENCE_UNKNOWN"));
      assert.equal(fresh.stateReads.length, 0, "refused at step 3 — before the state read");
      assert.deepEqual(fresh.applyCalls, []);
    } finally {
      await fresh.world.dispose();
    }
  } finally {
    await fx.world.dispose();
  }
});
