# 013-ci-enforcement-layer fixture corpus (T011)

Placeholder conventions — ZERO real organization identifiers, secrets, or UUIDs
(contract scan `tests/contract/ci-defaults-scan.test.ts` enforces):

- `planId` / hashes: 64-hex of a single repeated char (`"a".repeat(64)`, …).
- Task UUIDs: `ac000000-0000-4000-8000-<12 zeros+digits>` (never RFC-random).
- Issue keys: `TLS-<n>`; team `tls`; project `tlsproj`; repo root `/fixture/tls-demo`.
- File paths: `specs/demo/task-NN.md`; framework `spec-kit`; feature `demo-feature`.
- Timestamps fixed at `2026-11-06T00:00:00.000Z` — regeneration is byte-identical.
- Sentinel bodies/descriptions: reports carry NO body/description fields at all
  (frozen structural exclusion); the strings `body` / `description` never appear
  as content, so the summary tests can assert no output line carries report content.
- Entry field set mirrors `src/engine/report.ts` `toReportEntry` exactly.

Regenerate with `node tests/fixtures/ci/build-fixture-reports.mjs` (deterministic).

## Corpus (expected condition counts a/b/c at the predicates of data-model §3)

| File | a | b | c | Purpose |
|---|---|---|---|---|
| `clean.json` | 0 | 0 | 0 | matched/no-op/create/unmatched/low-confidence decoys + one `unmapped[]` row (never read) |
| `violates-all-three.json` | 1 | 2 | 3 | one trigger per condition, one group each |
| `conflict-blocks.json` | 0 | 2 | 0 | condition (b) only — gated on branch classification (R6) |
| `drift-spec-changed.json` | 0 | 0 | 2 | skip-recorded `conflict:spec-changed` `no-change` + `linear-changed` conflict w/ `changedFields` |
| `drift-boundaries.json` | 1 | 0 | 1 | counts EXACTLY at threshold 1 (passes) / above threshold 0 (fails) |
| `high-band-null-issue.json` | 1 | 0 | 0 | one (a) hit + band/issue decoys |
| `unmatched-not-high.json` | 0 | 0 | 0 | create/unmatched band + `conflict` decision WITHOUT the `unresolvedConflict` flag — (a)/(b)/(c) must ignore |
| `malformed.json` | — | — | — | structural violation: `schemaVersion: 2` + non-array `groups` (⇒ `CiArtifactError`) |
| `not-report.json` | — | — | — | valid JSON, not a report (⇒ `CiArtifactError`) |
