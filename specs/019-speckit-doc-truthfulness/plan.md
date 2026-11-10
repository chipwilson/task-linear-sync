# Implementation Plan: Documentation Truthfulness — Framework Behavior Claims

**Branch**: `019-speckit-doc-truthfulness` | **Date**: 2026-11-09 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/019-speckit-doc-truthfulness/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command; its definition describes the execution workflow.

## Summary

The README (and adjacent docs) still assert framework behavior the code does not
implement — most concretely the Spec Kit "`[P]/[US<n>]` tags and 'Preceded by' edges
recorded on the issue" sentence, the out-of-the-box `T001`-from-checkbox claim, the
`📋 Task [T###]` in-file "marker line" claim, and the "sections map 1:1 to Linear
milestones" claim. This feature (1) audits every framework-behavior statement in the
audited document set claim by claim, persisting verdict + evidence in `audit.md` inside
this feature directory, (2) corrects every false/ambiguous claim to as-built truth
(with genuine implementation gaps routed to `defects.md` instead of being implemented
or silently deleted), and (3) pins the corrected wording with a new contract suite
(`tests/contract/doc-truthfulness.test.ts`) written test-first, extending the
doc-pinning pattern established by feature 016
(`tests/contract/framework-support-consistency.test.ts`). No sync behavior changes:
the diff touches documents, tests, and the changelog only.

## Technical Context

<!--
  ACTION REQUIRED: Replace the content in this section with the technical details
  for the project. The structure here is presented in advisory capacity to guide
  the iteration process.
-->

**Language/Version**: TypeScript 5.x, ES modules, Node.js ≥ 20.0.0 (unchanged package constraint)

**Primary Dependencies**: none added — the feature is Markdown artifacts plus contract
tests over Node built-ins only (`node:test`, `node:assert/strict`, `node:fs`), matching
the zero-runtime-dependency package constraint; the feature ships no runtime code.

**Storage**: N/A — the audit record and defect log are Markdown files in this feature
directory (`audit.md`, `defects.md`); no database, no run state.

**Testing**: `node:test` via `scripts/run-tests.mjs` (`npm run test:contract` for the new
suite; full `npm test` gate in CI). Contract tests read documents with `readFileSync`
and assert regex match/no-match, exactly like feature 016's
`framework-support-consistency.test.ts`.

**Target Platform**: any Node ≥ 20 host; the regression guards execute in the GitHub
Actions merge-blocking pipeline (`--tier contract` runs inside the full suite).

**Project Type**: library/CLI npm package — this feature changes only its user-facing
documentation, its contract-test suite, and the CHANGELOG.

**Performance Goals**: N/A for behavior (zero code paths added); the new contract file
must stay a fast static-text check (file reads + regex, well under 1 s).

**Constraints**: zero sync-behavior change (FR-005/SC-003 — the diff is docs + tests +
changelog only); test-first per Constitution VI (guards written before corrections
land); every example identifier in corrected text remains fictional/placeholder-grade
(FR-008, Constitution Principle III); corrections must not reassert an in-file identity
marker (Constitution Principle II: the durable anchor lives in `Sync_Attachment`
metadata, never in the spec file).

**Scale/Scope**: audited document set ≈ 1,183 lines — `README.md` (378),
`docs/framework-adapters.md` (108), `docs/discovery.md` (81), and the framework-related
text of `specs/requirements.md` (Requirement 2 parsing, Requirement 7 adapters, glossary
entries); expected corrections concentrate in `README.md:7`, `README.md:9`,
`README.md:186-201` (Spec Kit section); artifacts: `audit.md`, `defects.md`, one new
contract test file, one CHANGELOG entry.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate result | Notes |
|---|---|---|
| I. Safety First | **PASS** | Read-only work: no tracker calls, no state directory, no repo writes beyond docs/tests; no new surface. |
| II. Durable Identity | **PASS (drives a correction)** | The README:7/README:200 `📋 Task [T###]` "persistent marker line" claim contradicts the frozen model ("never as an in-file marker"; requirements R2.9 parses no in-file identity marker). Correction must describe the as-built anchors: the visible `[KEY-N]` reference token on the task line plus the `Sync_Attachment` metadata UUID. |
| III. Intelligent Defaults / no org literals | **PASS** | FR-008: corrected examples stay placeholder-grade; defaults-scan contract suites (`ci-defaults-scan`, `defaults-scan`) continue to guard the shipped text. |
| IV. Determinism and Idempotency | **PASS** | No engine/parser/renderer change; the new contract test is deterministic static-text assertion. |
| V. One Engine, Additive Surfaces | **PASS** | No surface added or altered; documentation must keep describing the one engine honestly. |
| VI. Test-First and Quality Gates | **PASS (execution obligation)** | FR-006: the guard suite is authored before the corrections, verified red against the current false claims and green after correction; zero existing behavior tests modified (SC-003). |
| Additional constraint: Technology stack | **PASS** | Adds no dependencies; tests use Node built-ins only. |
| Development Workflow: Documentation duty | **PASS (execution obligation)** | FR-007: corrected docs + CHANGELOG `## [Unreleased]` entry + requirements-consistency land in the same change; the existing `changelog.test.ts` contract pins changelog hygiene. |
| Governance | **PASS** | Where the audit finds requirements asserting behavior the code lacks, record in `defects.md` (tracked follow-up) rather than editing the requirement away — spec "Requirements versus README conflict" edge case. |

**Gate decision: PASS — no violations, Complexity Tracking not required.**

## Project Structure

### Documentation (this feature)

```text
specs/019-speckit-doc-truthfulness/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
│   ├── audit-record-format.md      # contract: shape of audit.md / defects.md entries
│   └── doc-truthfulness-guards.md  # contract: the CI guard checks and their pins
├── audit.md             # implementation artifact (P1): claim-by-claim verdict record
└── defects.md           # implementation artifact (P1/P2): tracked follow-up log
```

### Source Code (repository root)

```text
README.md                                   # corrections: intro (L7, L9) + Spec Kit section (L186–L201)
CHANGELOG.md                                # ## [Unreleased] entry recording the correction (FR-007)
docs/framework-adapters.md                  # audited; corrected only where the audit finds false/ambiguous text
docs/discovery.md                           # audited; expected largely truthful (safety/determinism claims have code evidence)
docs/parsing.md                             # audited as adjacent parsing-behavior text (identifier grammar wording)
specs/requirements.md                       # framework-related text audited (R2, R7, glossary); edits ONLY for ambiguity,
                                            #   never to erase an unimplemented mandate (that becomes defects.md)

tests/contract/
├── framework-support-consistency.test.ts   # feature 016 suite — extended only if a pin belongs there
└── doc-truthfulness.test.ts                # NEW (test-first): per-claim regression guards + audit-record self-checks
```

**Structure Decision**: single package, no new directories under `src/` or `tests/`
beyond the one contract file. The feature's "implementation" lives in this feature
directory (`audit.md`, `defects.md`), the corrected documents at their existing paths,
and the regression guards in `tests/contract/` — the established home for doc-pinning
contract tests (016's suite, `changelog.test.ts`, `stability-docs.test.ts`,
`tracker-doc-allowlist.test.ts`).

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

No violations — section intentionally empty.
