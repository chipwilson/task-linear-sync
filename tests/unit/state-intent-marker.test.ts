/**
 * T041 [US2] — intent-before-attempt + run-report/marker unit tests (research R10, R7;
 * FR-004, FR-005; edge cases "crash window before create", "report contains unscreened
 * content"). All lifecycle timestamps flow through the injected clock.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  createStateStore,
  writeCreateIntentBeforeAttempt,
  updateCreateIntentStatus,
  listIntentsByTask,
  writeRunReports,
  readLastRunMarker,
  ReportScreeningError,
} from "task-linear-sync/state";
import type { StateStore } from "task-linear-sync/state";
import { loadConfig } from "task-linear-sync/config";
import { FakeClock, makeScreener } from "../helpers/test-utils.js";

let scratch: string;
const TASK = "5b8f1e2a-3c4d-5e6f-7a8b-9c0d1e2f3a4b";

before(() => {
  scratch = mkdtempSync(join(tmpdir(), "tls-intent-"));
});
after(() => {
  rmSync(scratch, { recursive: true, force: true, maxRetries: 3 });
});

function makeStore(name: string, clock: FakeClock): StateStore {
  const repo = join(scratch, `${name}-repo`);
  mkdirSync(repo, { recursive: true });
  return createStateStore({
    repositoryRoot: repo,
    config: loadConfig({ overrides: { stateDirectory: join(scratch, `${name}-state`) } }),
    clock,
  });
}

test("create intent before attempt: the record is on disk when the promise resolves (crash window)", async () => {
  const clock = new FakeClock("2026-10-22T09:00:00.000Z");
  const store = makeStore("intent", clock);
  await store.ensure();

  const intent = await writeCreateIntentBeforeAttempt(store, {
    intentId: "int-1",
    runId: "run-1",
    taskUuid: TASK,
    targetTeamKey: "acme",
    targetProject: "proj-alpha",
  });
  assert.equal(intent.status, "pending");
  assert.equal(intent.createdAt, "2026-10-22T09:00:00.000Z");

  // Hard rule (R10): stat immediately after await proves intents/<id>.json exists.
  const intentFile = join(store.paths.intents, "int-1.json");
  assert.ok(existsSync(intentFile), "durably stored BEFORE any create attempt");
  if (process.platform !== "win32") {
    assert.equal(statSync(intentFile).mode & 0o777, 0o600, "owner-only");
  }

  // Status transitions.
  clock.advanceMs(1_000);
  await updateCreateIntentStatus(store, "int-1", "confirmed-created");
  const updated = await store.readJson<{ status: string; updatedAt: string }>("intents/int-1.json");
  assert.equal(updated?.status, "confirmed-created");
  assert.equal(updated?.updatedAt, "2026-10-22T09:00:01.000Z");

  // Unknown intent ⇒ loud failure.
  await assert.rejects(() => updateCreateIntentStatus(store, "int-404", "reconciled"), /not found/);

  // taskUuid index: second intent for another task must not appear.
  await writeCreateIntentBeforeAttempt(store, {
    intentId: "int-2",
    runId: "run-1",
    taskUuid: "0a1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d",
    targetTeamKey: "acme",
    targetProject: "proj-beta",
  });
  clock.advanceMs(500);
  await writeCreateIntentBeforeAttempt(store, {
    intentId: "int-0",
    runId: "run-2",
    taskUuid: TASK,
    targetTeamKey: "acme",
    targetProject: "proj-alpha",
  });
  const forTask = await listIntentsByTask(store, TASK);
  assert.deepEqual(forTask.map((i) => i.intentId), ["int-1", "int-0"], "only matching-task intents");

  // Ordering is by createdAt with intentId tie-break, not by id: int-1 createdAt 09:00:00.000
  // precedes int-0 createdAt 09:00:01.500 even though "int-0" < "int-1" lexicographically.
  assert.equal(forTask[0]?.intentId, "int-1", "older createdAt first");
  assert.equal(forTask[1]?.intentId, "int-0");
});

test("listIntentsByTask on a fresh store returns [] (absent directory tolerated)", async () => {
  const clock = new FakeClock("2026-10-22T09:00:00.000Z");
  const store = makeStore("intent-empty", clock);
  assert.deepEqual(await listIntentsByTask(store, TASK), []);
});

const markerBase = {
  runId: "run-7",
  outcome: "completed" as const,
  notificationSuppressed: false,
};

test("run reports + last-run marker: paired artifacts under the state root only", async () => {
  const clock = new FakeClock("2026-10-22T10:00:00.000Z");
  const store = makeStore("marker", clock);
  await store.ensure();
  assert.equal(await readLastRunMarker(store), null, "no marker before the first report");

  const marker = await writeRunReports(
    store,
    "run-7",
    { json: { planId: "f".repeat(64), groups: [] }, markdown: "# Run 7\n\nAll good.\n" },
    makeScreener(),
    markerBase,
  );

  const jsonPath = join(store.root, "reports", "run-7", "report.json");
  const mdPath = join(store.root, "reports", "run-7", "report.md");
  assert.deepEqual(marker.reportPaths, { json: jsonPath, markdown: mdPath });
  assert.equal(marker.completedAt, "2026-10-22T10:00:00.000Z", "clock-stamped completedAt");
  assert.ok(existsSync(jsonPath) && existsSync(mdPath));

  const last = await readLastRunMarker(store);
  assert.deepEqual(last, marker, "last-run.json references the completed run's reports");

  // Nothing was written into the repository tree (SC-003).
  const repoDir = readdirSync(join(scratch, "marker-repo"));
  assert.deepEqual(repoDir, [], "repository tree untouched");
});

test("run reports are sanitized: SECRET findings arrive redacted in the written files", async () => {
  const clock = new FakeClock("2026-10-22T10:00:00.000Z");
  const store = makeStore("sanitized", clock);
  await store.ensure();
  await writeRunReports(
    store,
    "run-8",
    { json: { note: "value SECRET123 seen" }, markdown: "detail SECRET456 here" },
    makeScreener(),
    { ...markerBase, runId: "run-8" },
  );
  const json = readFileSync(join(store.root, "reports", "run-8", "report.json"), "utf8");
  const md = readFileSync(join(store.root, "reports", "run-8", "report.md"), "utf8");
  assert.ok(!json.includes("SECRET123") && json.includes("[REDACTED]"), "json redacted");
  assert.ok(!md.includes("SECRET456") && md.includes("[REDACTED]"), "markdown redacted");
});

test("run reports refusal: blocking findings or secret-keyed material — nothing lands (edge case)", async () => {
  const clock = new FakeClock("2026-10-22T10:00:00.000Z");
  const store = makeStore("blocked", clock);
  await store.ensure();

  // Screener blocking finding.
  await assert.rejects(
    () =>
      writeRunReports(
        store,
        "run-blocked",
        { json: { leak: "BLOCKED-SECRET" }, markdown: "ok" },
        makeScreener(),
        { ...markerBase, runId: "run-blocked" },
      ),
    ReportScreeningError,
  );
  assert.equal(existsSync(join(store.root, "reports", "run-blocked")), false, "no artifacts");
  assert.equal(await readLastRunMarker(store), null, "no marker update");

  // Secret-keyed material survives a non-blocking screener ⇒ built-in guard refuses.
  await assert.rejects(
    () =>
      writeRunReports(
        store,
        "run-keymat",
        { json: { ok: true }, markdown: "token lin_api_AbCdEfGhIjKlMnOp leaked" },
        makeScreener(),
        { ...markerBase, runId: "run-keymat" },
      ),
    ReportScreeningError,
    "configured personal-key-shaped material must be refused outright",
  );
  assert.equal(existsSync(join(store.root, "reports", "run-keymat")), false);

  // Marker shape: outcome/notificationSuppressed carried through.
  const marker = await writeRunReports(
    store,
    "run-ok",
    { json: { fine: true }, markdown: "clean" },
    makeScreener(),
    { runId: "run-ok", outcome: "failed", notificationSuppressed: true },
  );
  assert.equal(marker.outcome, "failed");
  assert.equal(marker.notificationSuppressed, true);
});
