#!/usr/bin/env node
/**
 * 013 fixture corpus generator (T011). Emits the report JSON artifacts under
 * `tests/fixtures/ci/reports/`. Deterministic: fixed timestamps, placeholder
 * identities only (see tests/fixtures/ci/README.md for the conventions).
 *
 * Entry FIELD SET mirrors `src/engine/report.ts` `toReportEntry` exactly, so
 * the corpus is byte-shaped like real CLI output (the wrapper consumes the
 * frozen artifact shape, nothing else).
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "reports");

const HEX = (c) => c.repeat(64);
const UUID = (n) => `ac000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function entry(opts) {
  return {
    taskUuid: UUID(opts.n),
    issueId: opts.issueId ?? null,
    decision: opts.decision ?? "update",
    framework: "spec-kit",
    featureName: "demo-feature",
    filePath: `specs/demo/task-${String(opts.n).padStart(2, "0")}.md`,
    confidence: opts.confidence ?? "high",
    score: opts.score ?? 120,
    margin: opts.margin ?? 40,
    reasons: opts.reasons ?? [],
    alternatives: opts.alternatives ?? [],
    changedFields: opts.changedFields ?? [],
    descriptionContentHash: HEX("d"),
    expectedMarkdownChanges: opts.expectedMarkdownChanges ?? [],
    lowConfidenceGateStatus: opts.lowConfidenceGateStatus ?? "passed",
    unresolvedConflict: opts.unresolvedConflict ?? false,
    routing: { teamKey: "tls", project: "tlsproj", matchedPrefix: "specs/demo", defaulted: false },
  };
}

function report(planHex, groups, unmapped = []) {
  return {
    schemaVersion: 1,
    planId: HEX(planHex),
    generatedAt: "2026-11-06T00:00:00.000Z",
    repositoryRoot: "/fixture/tls-demo",
    guards: {
      fileHashes: { "specs/demo/task-01.md": HEX("f") },
      headCommit: HEX("e"),
    },
    lowConfidencePresent: false,
    securityAssertions: [
      { guarantee: "read-only-plan-zero-mutations", status: "pass" },
      { guarantee: "no-raw-body-or-description-fields", status: "pass" },
    ],
    groups,
    unmapped,
  };
}

const GROUP = (entries, name = "tlsproj") => ({
  project: name,
  milestone: "M1",
  entries,
});

const UNMAPPED_ROW = {
  issueId: "TLS-9999",
  teamKey: "tls",
  project: "tlsproj",
  title: "Orphan placeholder issue",
  parentMapped: false,
};

const fixtures = {};

// clean.json — matched/no-op/create/unmatched entries, zero condition hits.
fixtures["clean.json"] = report(
  "a",
  [
    GROUP([
      entry({ n: 1, issueId: "TLS-101", reasons: ["title-exact"] }),
      entry({ n: 2, issueId: "TLS-102", decision: "no-change" }),
    ]),
    GROUP([
      entry({ n: 3, decision: "create", confidence: "medium" }),
      entry({ n: 4, decision: "create", confidence: "unmatched", score: 10, margin: 0 }),
      entry({ n: 5, issueId: "TLS-105", confidence: "low", lowConfidenceGateStatus: "failed" }),
    ]),
  ],
  [UNMAPPED_ROW],
);

// violates-all-three.json — a:1 (high band, null issue), b:2 (conflict blocks), c:3 (drift).
fixtures["violates-all-three.json"] = report("b", [
  GROUP([
    entry({ n: 1, decision: "create", confidence: "high" }), // (a): high + issueId null
    entry({ n: 2, issueId: "TLS-201", decision: "conflict", unresolvedConflict: true, reasons: ["conflict:linear-changed"] }),
    entry({ n: 3, issueId: "TLS-202", decision: "conflict", unresolvedConflict: true, reasons: ["conflict:linear-changed"] }),
  ]),
  GROUP([
    entry({ n: 4, issueId: "TLS-203", reasons: ["conflict:spec-changed"] }), // (c) via reasons
    entry({ n: 5, issueId: "TLS-204", changedFields: ["title"] }), // (c) via changedFields
    entry({ n: 6, issueId: "TLS-205", expectedMarkdownChanges: ["- [ ] Task 6.1 -> - [x] Task 6.1"] }), // (c) via markdown
  ]),
]);

// conflict-blocks.json — ONLY condition (b) signal (branch-context gated).
fixtures["conflict-blocks.json"] = report("c", [
  GROUP([
    entry({ n: 1, issueId: "TLS-301", reasons: ["title-exact"] }),
    entry({ n: 2, issueId: "TLS-302", decision: "conflict", unresolvedConflict: true, reasons: ["conflict:linear-changed"] }),
    entry({ n: 3, issueId: "TLS-303", decision: "conflict", unresolvedConflict: true, reasons: ["conflict:linear-changed"] }),
  ]),
]);

// drift-spec-changed.json — skip-recorded spec-changed + linear-changed conflict.
fixtures["drift-spec-changed.json"] = report("d", [
  GROUP([
    entry({ n: 1, issueId: "TLS-401", decision: "no-change", reasons: ["conflict:spec-changed"] }),
    entry({ n: 2, issueId: "TLS-402", decision: "conflict", changedFields: ["description"], reasons: ["conflict:linear-changed"] }),
  ]),
]);

// drift-boundaries.json — counts EXACTLY 1 for (a) and (c): threshold 1 passes, 0 fails.
fixtures["drift-boundaries.json"] = report("e", [
  GROUP([
    entry({ n: 1, decision: "create", confidence: "high" }), // (a): 1
    entry({ n: 2, issueId: "TLS-502", reasons: ["conflict:both-changed"] }), // (c): 1
    entry({ n: 3, issueId: "TLS-503", reasons: ["title-exact"] }),
  ]),
]);

// high-band-null-issue.json — exactly one (a) hit + band/issue decoys.
fixtures["high-band-null-issue.json"] = report("f", [
  GROUP([
    entry({ n: 1, decision: "create", confidence: "high" }), // (a): 1
    entry({ n: 2, confidence: "medium" }),
    entry({ n: 3, issueId: "TLS-603", confidence: "high" }),
    entry({ n: 4, decision: "create", confidence: "unmatched" }),
  ]),
]);

// unmatched-not-high.json — create/unmatched/no-flag-conflict decoys: ZERO hits.
fixtures["unmatched-not-high.json"] = report("0", [
  GROUP([
    entry({ n: 1, decision: "create", confidence: "unmatched", reasons: ["unmatched"] }),
    entry({ n: 2, decision: "create", confidence: "low", reasons: [] }),
    entry({ n: 3, issueId: "TLS-703", decision: "conflict", unresolvedConflict: false, reasons: ["ambiguous-match"] }),
  ]),
]);

// malformed.json — structural violations (schemaVersion 2 + non-array groups).
fixtures["malformed.json"] = {
  schemaVersion: 2,
  planId: HEX("1"),
  generatedAt: "2026-11-06T00:00:00.000Z",
  groups: { notAnArray: true },
  unmapped: [],
};

// not-report.json — valid JSON, not a plan report at all.
fixtures["not-report.json"] = { hello: "placeholder", items: [1, 2, 3] };

for (const [name, value] of Object.entries(fixtures)) {
  writeFileSync(join(OUT, name), `${JSON.stringify(value, null, 2)}\n`);
}
console.log(`wrote ${Object.keys(fixtures).length} fixtures to ${OUT}`);
