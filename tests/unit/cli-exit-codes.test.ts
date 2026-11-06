/**
 * T005 [P] — exit mapping unit tests (FR-001, research R3, data-model §3).
 * `exitCodeForError` is a total pure function over the taxonomy + the frozen
 * `GateFailureCode` union; no code outside the documented 0–8 table is producible.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { ConfigFileError, MissingIdentityError } from "task-linear-sync/config";
import { StatePlacementError, ReportScreeningError } from "task-linear-sync/state";
import { EngineError, EngineFailError, IntegrityError, JournalError } from "task-linear-sync/engine";
import type { GateFailure, GateFailureCode } from "task-linear-sync/gates";

import { ExitCode, exitCodeForError, exitCodeForGateFailureCode } from "../../src/cli/exit-codes.js";
import {
  UsageError,
  QueueSurfaceUnavailableError,
  ReadOnlyViolationError,
  RunAbortedError,
  GateRefusalError,
} from "../../src/cli/errors.js";

const refusal = (code: GateFailureCode): GateFailure => ({ code, detail: `detail for ${code}` });

test("parse/usage failures map to 2", () => {
  assert.equal(exitCodeForError(new UsageError("unknown flag --wat", ["--wat"])), ExitCode.USAGE_ERROR);
  assert.equal(exitCodeForError(new UsageError("bad usage")), 2);
});

test("configuration errors map to 3", () => {
  assert.equal(exitCodeForError(new ConfigFileError("invalid-json", "/repo/task-linear-sync.json")), 3);
  assert.equal(exitCodeForError(new MissingIdentityError(["toolId"])), 3);
  assert.equal(exitCodeForError(new StatePlacementError("inside the repo")), 3);
  // Credential-preflight diagnostics surface as the tracker's named config error.
  const preflight = Object.assign(new Error("credential env var TASK_LINEAR_SYNC_API_KEY is not set"), {
    name: "TrackerConfigError",
  });
  assert.equal(exitCodeForError(preflight), 3);
});

test("every frozen GateFailureCode except LOCK_HELD maps to 4; LOCK_HELD maps to 6", () => {
  const codes: GateFailureCode[] = [
    "APPLY_FLAG_MISSING",
    "CONFIRMATION_KEY_MISMATCH",
    "LOW_CONFIDENCE_NOT_ACCEPTED",
    "PLAN_REFERENCE_UNKNOWN",
    "PLAN_REFERENCE_STALE",
    "MANIFEST_UNJOURNALED",
    "MANIFEST_EXPIRED",
  ];
  for (const code of codes) {
    assert.equal(exitCodeForError(new GateRefusalError([refusal(code)])), 4, code);
    assert.equal(exitCodeForGateFailureCode(code), 4, code);
  }
  assert.equal(exitCodeForError(new GateRefusalError([refusal("LOCK_HELD")])), 6);
  assert.equal(exitCodeForGateFailureCode("LOCK_HELD"), 6);
  // Complete listing wins: LOCK_HELD alongside others still signals retry-later.
  assert.equal(exitCodeForError(new GateRefusalError([refusal("APPLY_FLAG_MISSING"), refusal("LOCK_HELD")])), 6);
});

test("aborts and engine failures map to 5", () => {
  assert.equal(exitCodeForError(new RunAbortedError("report artifact missing")), 5);
  assert.equal(exitCodeForError(new IntegrityError("task-uuid-1", ["issue-1", "issue-2"])), 5);
  assert.equal(exitCodeForError(new EngineFailError("stage failed", "details")), 5);
  assert.equal(exitCodeForError(new EngineError("engine base failure")), 5);
  assert.equal(exitCodeForError(new JournalError("journal unreadable")), 5);
  assert.equal(exitCodeForError(new ReportScreeningError("blocked report")), 5);
  assert.equal(exitCodeForError(new ReadOnlyViolationError("attempted updateIssue during read-only command")), 5);
});

test("queue-surface unavailability maps to 7", () => {
  assert.equal(
    exitCodeForError(new QueueSurfaceUnavailableError("enqueue", "task-linear-sync/queue")),
    7,
  );
});

test("anything unmapped maps to 1 (totality)", () => {
  assert.equal(exitCodeForError(new Error("boom")), 1);
  assert.equal(exitCodeForError(new TypeError("bad")), 1);
  assert.equal(exitCodeForError("string throw"), 1);
  assert.equal(exitCodeForError(undefined), 1);
  assert.equal(exitCodeForError(null), 1);
  assert.equal(exitCodeForError({ rethrow: true }), 1);
});

test("the mapping is a pure function — same error value ⇒ same code, and only table codes are producible", () => {
  const error = new UsageError("x", ["--x"]);
  assert.equal(exitCodeForError(error), exitCodeForError(error));
  const samples: unknown[] = [
    new Error("e"),
    new UsageError("u"),
    new ConfigFileError("missing", "p"),
    new MissingIdentityError(["a"]),
    new StatePlacementError("s"),
    new GateRefusalError([refusal("LOCK_HELD")]),
    new GateRefusalError([refusal("MANIFEST_EXPIRED")]),
    new EngineError("engine"),
    new ReportScreeningError("screen"),
    new ReadOnlyViolationError("ro"),
    new QueueSurfaceUnavailableError("worker", "task-linear-sync/queue"),
    42,
    null,
  ];
  const produced = samples.map(exitCodeForError);
  for (const code of produced) {
    assert.ok(
      [1, 2, 3, 4, 5, 6, 7, 8].includes(code),
      `code ${String(code)} outside the documented table`,
    );
    assert.notEqual(code, 0, "exit mapping never signals success");
  }
});
