# Contract: Task-Depth Folding (parsing semantics)

The normative behavior of feature 020. Each rule lists the test gate that
enforces it (constitution Principle VI — every rule is gated). Rule text is
binding on every lane (CLI, programmatic API, worker, MCP, CI action) because
all lanes parse through `parseTaskFile`.

**C1 — Key and default posture.** `ResolvedConfig` carries
`maxTaskIssueDepth?: number` whose **built-in default is `1`**, carried by
`builtInDefaults` (flat board; Maintainer Ruling 2026-11-18). An absent key
resolves to that built-in default, so the effective value is never absent
post-`loadConfig`; the key merges as a scalar through the frozen layering
(defaults → file → programmatic). Byte-identical parsing output to the
pre-feature build (I1) is gated at **explicit `maxTaskIssueDepth: 64`**,
never at absence.
*Gate:* unit config round-trip/merge tests (default `1` applied, file and
programmatic layers override, explicit `64` resolves); the existing
parsing/engine fixture suites, pinned at explicit `64` in their fixtures,
pass (SC-001).

**C2 — Depth definition.** Depth is computed over the full draft tree before
folding: heading tasks are depth 1; a checklist task is 1 + depth(nearest
task ancestor), where "nearest task ancestor" is exactly the frozen
indent-stack/orphan parent pointer. A checklist task directly beneath a
heading task is depth 2.
*Gate:* unit `parsing-depth-fold.test.ts` depth-matrix block (headings,
nesting, orphan-under-heading, tab-indent widths).

**C3 — Fold rule.** A task is folded iff `depth > maxTaskIssueDepth`.
Folding removes the draft from `TaskFile.tasks` before uuid assignment;
monotone inheritance folds whole subtrees. Corollary: at cap 1, zero surviving
tasks carry `parentUuid`, so the engine creates zero Linear sub-issues.
*Gate:* unit fold matrix (caps undefined(→1)/1/2/3/64; deep chains; subtree
inheritance); integration plan assertion "no parented entries at cap 1".

**C4 — Verbatim body, span invariance.** For any surviving task, the
`Task_Body` line span MUST NOT depend on the cap (I3); folded subtree lines
are present in the nearest surviving ancestor's body verbatim and in source
order. Folded lines are never assigned, never rewritten, and never receive an
issue reference token (I4).
*Gate:* parsing golden pair (same fixture parsed at caps 1/2/64 — absence
resolves to 1, so it needs no separate run; surviving extents byte-equal;
parent description contains folded lines);
integration description-content check over the fake port.

**C5 — Exclusion recording.** Every folded draft yields exactly one
`ExclusionRecord { lineNumber, kind: "checklist", reason: "depth-folded",
text }`, ascending by line (I5), in addition to grammar exclusions. Precedence
is fixed: fence interior and conflict-frozen lines never draft, so they never
appear as `depth-folded`; `summary-section` and `rollup` exclusions win over
folding.
*Gate:* unit precedence matrix (fence + nested checkbox, conflict block +
over-cap line, rollup line at depth 5); exclusion-union type pin in
`tests/types/parsing.test-d.ts`.

**C6 — Validation and refusal.** At the `parseTaskFile` entry: absent passes
validation and resolves to cap `1` (the built-in default);
integers 1..64 pass; every other value throws `TaskDepthConfigError` naming
`maxTaskIssueDepth` and the offending value with reason
`not-an-integer | below-minimum | above-maximum`; zero parsing, zero
mutations, zero file writes occur. The CLI exits `3`.
*Gate:* unit validation matrix (0, −1, 1.5, 65, NaN, Infinity, non-number);
CLI e2e scenario asserting exit 3 + diagnostic shape; refusal-occurs-before-
any-port-call assertion in the integration harness.

**C7 — Orphans are report-only.** Tightening the cap over a repository with
previously created child issues MUST surface each such issue once in the
existing unmapped-issue report section and MUST execute zero archive or delete
operations (no new mutation vocabulary is introduced anywhere by this
feature).
*Gate:* integration scenario: world with a depth-2 checkpoint replanned at
cap 1 — fake-port script asserts zero `issueArchive`, unmapped section lists
the child issue once (SC-003).

**C8 — Downstream invisibility.** Folded lines never appear as tasks, matches,
plan entries, report task entries, low-confidence gate inputs, or CI
`fail-on-unmapped`/`fail-on-conflicts`/`fail-on-drift` findings; totals in
`check --json` exclude them exactly as all exclusions are excluded today.
*Gate:* integration plan/report structural assertions; CI-action lane test on
the folded fixture (all three gate conditions green).

**C9 — Determinism.** Two consecutive `plan` (or parse) runs with identical
inputs and cap produce byte-identical artifacts (I6), including the exclusions
list ordering.
*Gate:* e2e double-run byte-diff scenario (extends the existing determinism
world).

**C10 — Surface posture.** The frozen-surface deltas are: the optional
`ResolvedConfig` field, the extended exclusion `reason` union, the
`builtInDefaults` value `maxTaskIssueDepth: 1`, and the typed
`TaskDepthConfigError` export from the parsing surface (parsing-surface and
frozen-surface snapshots amended deliberately). No new config validation runs
inside `loadConfig`; the three
config-file failure categories are unchanged.
*Gate:* `tests/contract/parsing-surface.test.ts` + snapshot;
`tests/contract/frozen-surface.test.ts` review; `defaults-scan` verified
green (the added default is a benign integer).
