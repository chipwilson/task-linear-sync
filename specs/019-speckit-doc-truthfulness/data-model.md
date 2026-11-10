# Phase 1 Data Model: Documentation Truthfulness

**Feature**: `019-speckit-doc-truthfulness` | **Date**: 2026-11-10

This feature has no runtime entities: its "data" is the persisted audit record
(`audit.md`), the follow-up log (`defects.md`), and the guard checks that pin them.
The machine-checkable field shapes below are normative and enforced by the
audit-record self-check guards ([contracts/doc-truthfulness-guards.md](./contracts/doc-truthfulness-guards.md)
G-family 3); the file layout each entity maps to is specified in
[contracts/audit-record-format.md](./contracts/audit-record-format.md).

## Entity overview

```text
Claim 1──1 EvidenceEntry ──decides──> Verdict ──0..1── Correction (required iff verdict ≠ true)
  │                                                    │
  └── referenced-by 0..* GuardRule (pin)              └──0..* FollowUpEntry (only when the
                            │                             evidence shows a requirements gap)
                     asserts-on README/docs text
```

## Entities

### Claim

One framework-behavior statement extracted from an audited document.

| Field | Type | Rules |
|---|---|---|
| `id` | `C-\d{3}` | Unique within `audit.md`; never reused; ids are appended, never renumbered (append-only record). |
| `document` | enum | `README.md` \| `docs/framework-adapters.md` \| `docs/discovery.md` \| `docs/parsing.md` \| `specs/requirements.md`. |
| `location` | string | Section heading + line range at the audit's baseline commit, e.g. `## Using it with your SDD framework → ### GitHub Spec Kit (README.md:186-201)`. |
| `claim` | string | The **exact** sentence or table cell, quoted verbatim (guards key off this text). |
| `frameworkScope` | `FrameworkId` \| `all` \| `sync-core` | Which frameworks the sentence purports to describe; `all` requires per-framework adjudication when evidence differs (spec edge case). |

Validation: one entry per framework-behavior sentence in the four audited document sets
(SC-001 coverage); the coverage table in `audit.md` must account for every `###`-level
framework subsection and the README intro sentence block.

### EvidenceEntry

The code location, test name, or demonstration that decides the claim.

| Field | Type | Rules |
|---|---|---|
| `kind` | enum | `source` \| `test` \| `demo` \| `absence-search`. |
| `pointer` | string | `file:line` or `tests/**/*.test.ts::test name` — must be cheaply re-verifiable (spec edge case "Evidence that ages"). |
| `demonstration` | string, optional | For `demo` entries: the concrete input + observed output, e.g. parsing `- [ ] T001 Create the scaffold` yields `localTaskId: <absent>` (US1-AS2). |
| `searchScope` | string, required for `absence-search` | What was searched and where (e.g. "no tag/label extraction or dependency-edge construction anywhere in `src/`; issue mutation surface `src/tracker/operations/mutations.ts` admits title/description/state/parent only") — required by US1-AS1. |

### Verdict

| Field | Type | Rules |
|---|---|---|
| `status` | enum | `true` \| `false` \| `ambiguous` \| `true-no-claim-present` (the R4 vacuous form, kept as `true` for gate counting). |
| `reasoning` | string | One short paragraph tied to the EvidenceEntry. |
| `requirementsCheck` | enum | `requirements-silent` \| `requirements-agree` \| `requirements-mandate-code-lacks` — the third value is the **only** trigger that may create a FollowUpEntry of category `defect` (FR-005; governance: never delete an unimplemented mandate to make docs match). |

### Correction

Replacement wording for a `false` or `ambiguous` claim. Required iff
`verdict.status ≠ true` (SC-001: zero open false/ambiguous at feature close).

| Field | Type | Rules |
|---|---|---|
| `action` | enum | `rewrite` \| `remove` \| `label-planned`. `label-planned` requires the target document to carry an explicit "planned" label (spec edge case on future work). |
| `newText` | string | The corrected wording; MUST be backed by this claim's EvidenceEntry (FR-004) and MUST keep example identifiers fictional/placeholder-grade (FR-008). |
| `evidenceRef` | `C-\d{3}` → EvidenceEntry | Traceability: every corrected passage cites the evidence entry that justifies it (US2 Independent Test). |
| `landing` | string | File + section where the correction lands; for corrections in `specs/requirements.md`, the CHANGELOG entry and consistency check are mandatory in the same change (FR-007). |

### FollowUpEntry (`defects.md`)

Tracked record of a genuine implementation gap; nothing in this feature implements it.

| Field | Type | Rules |
|---|---|---|
| `id` | `FU-\d{3}` | Unique, append-only. |
| `category` | enum | `defect` (requirements mandate, code lacks) \| `enhancement` (e.g. FU-001 separator-free checklist id capture, research R3). |
| `sourceClaim` | `C-\d{3}` | The audit entry that surfaced it. |
| `expectation` / `asBuilt` | string | What the document/requirement expects vs what the code does. |
| `suggestedHome` | string | Feature/roadmap entry where the behavior should be specified. |
| `status` | enum | `open` \| `mirrored-issue:<url>` \| `absorbed-into:<feature>` — the only mutable field (append-only log otherwise). |

### GuardRule (`tests/contract/doc-truthfulness.test.ts`)

The CI pin that keeps a decided claim decided.

| Field | Type | Rules |
|---|---|---|
| `id` | `GUARD-\d{2}` | Unique per check; the failure diagnostic must name it. |
| `family` | enum | `forbidden-phrasing` \| `required-wording` \| `record-selfcheck`. |
| `sourceClaim` | `C-\d{3}` \| `record` | Traceability to the audit entry (or to the record itself for self-checks). |
| `pattern` | RegExp | For `forbidden-phrasing`: must match the *original* false sentence on the pre-correction baseline (guard verified red first — FR-006 test-first) and must target phrasing patterns, not general English (spec Assumption). |
| `documents` | path set | Audited documents the pattern is checked against. |

## Relationships and invariants

1. **Coverage**: every framework-behavior sentence in the audited documents ↔ exactly
   one Claim (SC-001).
2. **Adjudication completeness**: all six FR-002 named suspects (C-001…C-005 plus the
   `[DEP:]` vacuous entry) carry explicit verdicts (SC-002).
3. **No false close-out**: no Claim ends the feature `false`/`ambiguous` (SC-001), so
   each has a Correction; each Correction has ≥1 `forbidden-phrasing` GuardRule keyed
   to its exact original wording.
4. **Behavioral purity**: no Claim, Correction, or GuardRule may assert or alter sync
   behavior; the delivered diff touches documents, tests, and CHANGELOG only (SC-003).
5. **Non-duplication with 016**: Claims already pinned by
   `framework-support-consistency.test.ts` (C-004, C-005) get **no** new GuardRule —
   evidence pointer to the existing pin instead (spec "extend rather than duplicate").

## Claim lifecycle (state transitions)

```text
extracted ──adjudicated──> true ────────────────> (terminal; evidence pointer only)
                 │
                 ├───────> false ──corrected──> corrected ──guarded──> guarded (terminal)
                 └───────> ambiguous ──┬──rewritten──> corrected ──guarded──> guarded
                                       └──re-scoped per framework (edge case) ─┘
requirementsCheck = requirements-mandate-code-lacks additionally spawns FollowUpEntry(open)
```

Guards run on every CI pass; a `guarded` claim whose sentence is reintroduced flips
the CI run red (US3) but never mutates the record — record repair stays human-owned.
