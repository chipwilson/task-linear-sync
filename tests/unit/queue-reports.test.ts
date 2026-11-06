/**
 * T016 — FAILING unit tests for the queue-side run reports (spec 010, FR-022..FR-024,
 * data-model.md Run Report v1). Modules under test: `src/queue/reports.ts` —
 * writeTerminalRunReport / writeDeferredRunReport / writeLockFailureRunReport over the
 * frozen writeRunReports pipeline. Redaction failure must degrade to a minimal failed
 * report with the notification suppressed (FR-021).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  writeDeferredRunReport,
  writeLockFailureRunReport,
  writeTerminalRunReport,
} from "../../src/queue/reports.js";
import { makeQueueHarness, type PendingJobRecord } from "../helpers/queue-harness.js";
import { readLastRunMarker } from "../../src/state/marker.js";

const RUN_ID = "d".repeat(64);

function seedJob(overrides: Partial<PendingJobRecord> = {}): PendingJobRecord {
  return {
    schemaVersion: 1,
    jobId: "a".repeat(16),
    mode: "bootstrap",
    trigger: "manual",
    enqueuedAt: "2025-12-31T23:00:00.000Z",
    updatedAt: "2025-12-31T23:30:00.000Z",
    retryCount: 2,
    claim: null,
    ...overrides,
  };
}

test("terminal report: failed marker paired with the queue report document", async () => {
  const h = await makeQueueHarness();
  try {
    await writeTerminalRunReport(h.store, {
      runId: RUN_ID,
      job: seedJob(),
      errorCode: "RETRY_LIMIT",
      message: "giving up after 2 attempts",
    });

    const marker = await readLastRunMarker(h.store);
    assert.ok(marker);
    assert.ok(marker.reportPaths);
    assert.equal(marker.runId, RUN_ID);
    assert.equal(marker.outcome, "failed");
    assert.equal(marker.completedAt, h.clock.iso());
    assert.ok(marker.reportPaths.json.endsWith(`reports/${RUN_ID}/report.json`));
    assert.ok(marker.reportPaths.markdown.endsWith(`reports/${RUN_ID}/report.md`));

    const doc = JSON.parse(await readFile(marker.reportPaths.json, "utf8")) as {
      schemaVersion: number;
      outcome: string;
      mode: string;
      jobId: string;
      trigger: string;
      error: { code: string; message: string };
    };
    assert.equal(doc.schemaVersion, 1);
    assert.equal(doc.outcome, "failed");
    assert.equal(doc.mode, "bootstrap", "the report records whether the pass was bootstrap or sync (SC-007)");
    assert.equal(doc.jobId, "a".repeat(16), "the report records the pending job id (SC-007)");
    assert.equal(doc.trigger, "manual");
    assert.equal(doc.error.code, "RETRY_LIMIT");
    assert.match(doc.error.message, /giving up after 2 attempts/);

    const markdown = await readFile(marker.reportPaths.markdown, "utf8");
    assert.match(markdown, /task-linear-sync/);
    assert.match(markdown, /bootstrap/);
    assert.match(markdown, /RETRY_LIMIT/);
  } finally {
    h.dispose();
  }
});

test("deferred report: report-only pass marks the marker aborted without touching the job", async () => {
  const h = await makeQueueHarness();
  try {
    await writeDeferredRunReport(h.store, {
      runId: RUN_ID,
      job: seedJob({ retryCount: 0 }),
      reason: "lock-held",
      message: "sync state lock held by another process",
    });

    const marker = await readLastRunMarker(h.store);
    assert.ok(marker);
    assert.ok(marker.reportPaths);
    assert.equal(marker.outcome, "aborted");
    const doc = JSON.parse(await readFile(marker.reportPaths.json, "utf8")) as Record<string, unknown>;
    assert.equal(doc.outcome, "aborted");
    assert.equal(doc.reason, "lock-held");
    assert.equal(doc.jobId, "a".repeat(16));
    assert.equal(doc.retryCount, 0);
  } finally {
    h.dispose();
  }
});

test("lock-failure report: the giving-up worker emits its own aborted run with a generated run id", async () => {
  const h = await makeQueueHarness();
  try {
    await writeLockFailureRunReport(h.store, {
      reason: "lock-held",
      message: "another worker holds the queue lock past the timeout",
      jobId: "a".repeat(16),
    });

    const marker = await readLastRunMarker(h.store);
    assert.ok(marker);
    assert.ok(marker.reportPaths);
    assert.equal(marker.outcome, "aborted");
    assert.match(marker.runId, /^[0-9a-f]{64}$/);
    const doc = JSON.parse(await readFile(marker.reportPaths.json, "utf8")) as Record<string, unknown>;
    assert.equal(doc.outcome, "aborted");
    assert.equal(doc.reason, "lock-held");
    assert.equal(doc.jobId, "a".repeat(16));
  } finally {
    h.dispose();
  }
});

test("redaction failure: a secret-shaped error message degrades to a minimal failed report, notification suppressed", async () => {
  const h = await makeQueueHarness({ config: { personalKeyPrefix: "linscret_" } });
  try {
    await writeTerminalRunReport(h.store, {
      runId: RUN_ID,
      job: seedJob(),
      errorCode: "APPLY_FAILED",
      message: "Linear rejected the token linscret_SUPERSECRETVALUE",
    });

    const marker = await readLastRunMarker(h.store);
    assert.ok(marker?.reportPaths, "the marker is still written so the hook shows the failure");
    assert.equal(marker.outcome, "failed");
    assert.equal(marker.notificationSuppressed, true, "FR-021: the notification is suppressed on redaction failure");

    const doc = JSON.parse(await readFile(marker.reportPaths.json, "utf8"));
    assert.equal(doc.outcome, "failed");
    assert.ok(!JSON.stringify(doc).includes("linscret_SUPERSECRETVALUE"), "the secret never reaches disk");

    const markdown = await readFile(marker.reportPaths.markdown, "utf8");
    assert.ok(!markdown.includes("linscret_SUPERSECRETVALUE"));
  } finally {
    h.dispose();
  }
});

test("reports never escape the state directory tree", async () => {
  const h = await makeQueueHarness();
  try {
    await writeLockFailureRunReport(h.store, { reason: "lock-held" });
    const marker = await readLastRunMarker(h.store);
    assert.ok(marker);
    assert.ok(marker.reportPaths);
    for (const p of [marker.reportPaths.json, marker.reportPaths.markdown]) {
      assert.ok(p.startsWith(h.store.root), `${p} stays inside the state dir`);
      await readFile(p, "utf8");
    }
  } finally {
    h.dispose();
  }
});
