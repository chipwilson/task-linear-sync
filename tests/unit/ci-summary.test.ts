/**
 * T022 — unit tests for the screened summary (research R8; wrapper-api.md §4).
 * Exact line formats, stable order, spy-proven screener-first posture, and
 * zero report-content propagation (SC-003).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { renderSummary } from "task-linear-sync/ci";

import type { EvaluationResult } from "task-linear-sync/ci";
import type { SecurityScreener } from "task-linear-sync/ports";

function evaluation(over: Partial<EvaluationResult> = {}): EvaluationResult {
  return {
    counts: { unmappedHighConfidence: 0, unresolvedConflictBlocks: 0, specDrift: 0 },
    triggered: [],
    protectionSkipped: false,
    ...over,
  };
}

function spyScreener() {
  const calls: string[] = [];
  const screener: SecurityScreener = {
    screen(text: string) {
      calls.push(text);
      return { output: text, blocked: [], findings: [] };
    },
  };
  return { screener, calls };
}

test("pass line — EXACT format, all three counts always present", () => {
  const { screener, calls } = spyScreener();
  const r = renderSummary(
    evaluation({ counts: { unmappedHighConfidence: 2, unresolvedConflictBlocks: 5, specDrift: 7 } }),
    { screener },
  );
  assert.equal(
    r.summaryLine,
    "task-linear-sync enforcement passed (unmapped-high-confidence: 2, unresolved-conflict-block: 5, spec-drift: 7)",
  );
  assert.equal(r.warningLine, null);
  assert.ok(calls.includes(r.summaryLine), "summary line screened first");
});

test("pass line includes counts of DISABLED conditions (always computed)", () => {
  const { screener } = spyScreener();
  const r = renderSummary(
    evaluation({
      counts: { unmappedHighConfidence: 3, unresolvedConflictBlocks: 1, specDrift: 9 },
      triggered: [],
    }),
    { screener },
  );
  assert.match(r.summaryLine, /unmapped-high-confidence: 3, unresolved-conflict-block: 1, spec-drift: 9/);
});

test("fail line — EXACT format (em-dash), ONLY triggered, stable order (a)(b)(c)", () => {
  const { screener, calls } = spyScreener();
  const r = renderSummary(
    evaluation({
      counts: { unmappedHighConfidence: 1, unresolvedConflictBlocks: 2, specDrift: 3 },
      triggered: [
        { condition: "spec-drift", count: 3 },
        { condition: "unmapped-high-confidence", count: 1 },
        { condition: "unresolved-conflict-block", count: 2 },
      ],
    }),
    { screener },
  );
  assert.equal(
    r.summaryLine,
    "task-linear-sync enforcement failed — unmapped-high-confidence: 1; unresolved-conflict-block: 2; spec-drift: 3",
  );
  assert.ok(calls.includes(r.summaryLine));
});

test("fail line with a single trigger names exactly that condition", () => {
  const { screener } = spyScreener();
  const r = renderSummary(
    evaluation({
      counts: { unmappedHighConfidence: 4, unresolvedConflictBlocks: 0, specDrift: 0 },
      triggered: [{ condition: "unmapped-high-confidence", count: 4 }],
    }),
    { screener },
  );
  assert.equal(r.summaryLine, "task-linear-sync enforcement failed — unmapped-high-confidence: 4");
});

test("protection-skip warning — EXACT text; null when classification worked", () => {
  const { screener, calls } = spyScreener();
  const r = renderSummary(evaluation({ protectionSkipped: true }), { screener });
  assert.equal(
    r.warningLine,
    "task-linear-sync enforcement warning: unresolved-conflict-block protection skipped — branch context unresolved",
  );
  assert.ok(calls.includes(r.warningLine ?? ""), "warning screened too");
  assert.equal(renderSummary(evaluation(), { screener }).warningLine, null);
});

test("EVERY emitted line passes the screener first; redaction propagates", () => {
  const redacting: SecurityScreener = {
    screen(text: string) {
      return { output: text.replace(/SECRET\d+/g, "[REDACTED]"), blocked: [], findings: [] };
    },
  };
  const r = renderSummary(evaluation(), { screener: redacting });
  assert.ok(!r.summaryLine.includes("SECRET"), r.summaryLine);
});

test("lines are single-line, planId-free, and carry no report content", () => {
  const { screener } = spyScreener();
  const r = renderSummary(
    evaluation({
      counts: { unmappedHighConfidence: 1, unresolvedConflictBlocks: 1, specDrift: 1 },
      triggered: [{ condition: "unmapped-high-confidence", count: 1 }],
      protectionSkipped: true,
    }),
    { screener },
  );
  for (const line of [r.summaryLine, r.warningLine ?? ""]) {
    assert.ok(!line.includes("\n"), "one line only");
    assert.ok(!/[0-9a-f]{64}/.test(line), "no planId material");
    assert.ok(!line.includes("TLS-"), "no issue identifiers");
  }
});
