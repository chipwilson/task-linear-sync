# Phase 1 Data Model: Matching-Local Entities

**Feature**: `006-task-issue-matching` | **Date**: 2026-10-22

This document defines **only** the 006-local records that *compose* the frozen 002 entities.
Frozen shapes (`Task`, `Match`, `MatchAlternative`, `Confidence`, `RoutingResolution`,
`IssueView`, `AttachmentView`, `SyncStatePayload`, `ResolvedConfig` matching keys) are
referenced by link and **never restated as new definitions** — canonical sources:
[`specs/002-core-domain-contracts/data-model.md`](../002-core-domain-contracts/data-model.md)
(§1, §4, §5, §8, §17) and `src/domain`, `src/config`, `src/ports`. Where this file names a
frozen field, it is quoting, not redefining.

Relationship overview (frozen shapes in ⟦brackets⟧):

```
⟦Task⟧ ──1── TaskMatchInput ──┐
⟦RoutingResolution⟧(005, data)┘│  *          * ┌── ⟦Match⟧ (shape frozen in 002 §5; computed here)
⟦IssueView⟧ ──1── MatchCandidate ─┴─ PairScore ─┤
⟦AttachmentView⟧(page 0) ──1..0..1 durableTaskUuid
MatchingResult 1 ── * Match, * UnresolvedTask
PairScore 1 ── * SignalContribution
```

## 1. TaskMatchInput (006-local envelope)

One task plus the gating data 005 produces — passed as **data**, never imported from 005
(research R6).

| Field | Type | Rules |
|---|---|---|
| `task` | ⟦`Task`⟧ (002 §1) | `stableUuid` is the durable anchor compared against candidate `durableTaskUuid` |
| `routing` | ⟦`RoutingResolution`⟧ (002 §4) \| `undefined` | Routed team/project for FR-003 gating; `undefined` or `unassigned: true` ⇒ team/project gates skipped for this task (R6) |

Validation: `task.stableUuid` unique within one matching input set; duplicate task UUIDs on
the *task side* are a discovery-layer concern of 004/008 and out of 006 scope (the durable
collision rule below concerns **issue-side** duplicates only).

## 2. MatchCandidate (006-local projection of frozen tracker views)

Deterministic projection of an already-fetched candidate issue into the fields matching reads
(projection rules normative in [contracts/candidate-projection.md](./contracts/candidate-projection.md)).

| Field | Type | Projection source | Rules |
|---|---|---|---|
| `issueId` | `string` | ⟦`IssueView.id`⟧ | Canonical ordering key (ascending) |
| `issueKey` | `string` | `IssueView.key` | Numeric suffix `-(\d+)$` feeds signal 2 (`issue-ref-exact`); absent suffix ⇒ signal scores 0 |
| `teamKey` | `string` | `IssueView.teamKey` | FR-003 team gate |
| `projectRef` | `string` | `IssueView.projectId` | Compared as-is to routed project (research R5; identity-space alignment is the provider's contract) |
| `title` | `string` | `IssueView.title` | Title signals 4–6 |
| `durableTaskUuid` | `string \| undefined` | page-0 canonical attachment → `metadata[metadataNamespaceKey]` → ⟦`parseSyncStatePayload`⟧ → `taskUuid` | Present ⇒ `durableIdentity: true` for every pair with that task; bypasses gating + downgrade (constitution II) |
| `frameworkId` | `FrameworkId \| undefined` | page-0 payload `frameworkMetadata.frameworkId` | "known framework" for the both-known gate (R5 c5) |
| `featureName` | `string \| undefined` | page-0 payload `frameworkMetadata.featureName` | Prefix-aware title normalization (research R2 step 2) |
| `filePath` | `string \| undefined` | page-0 payload `frameworkMetadata.filePath` | Context/reasons only; **not** an independent signal (R1 rejected substitutes) |

Integrity rule (constitution II; 001 R5 c3): if two candidates share the same
`durableTaskUuid`, projection throws `DurableIdentityCollisionError` (§6) — hard abort, no
result emitted. Continuation-page attachments never set `durableTaskUuid`.

## 3. SignalContribution and PairScore (scoring intermediates)

| Field | Type | Rules |
|---|---|---|
| `SignalContribution.signal` | `string` | One of the eight reason labels in [contracts/confidence-scoring.md](./contracts/confidence-scoring.md) §1 |
| `SignalContribution.points` | `integer ≥ 0` | Weight (or scaled/derived value) awarded; fuzzy points `round(titleTokenOverlap × overlapRatio)` |
| `SignalContribution.weight` | `integer ≥ 0` | The resolved weight (frozen, derived, or overridden) for the signal |
| `PairScore.taskUuid` / `PairScore.issueId` | `string` | Join keys to §1 / §2 |
| `PairScore.total` | `integer ≥ 0` | "unbounded weighted integer sum" (FR-001); title credit taken as exact ⊕ contained ⊕ fuzzy — strictest satisfied form only (R1) |
| `PairScore.contributions` | `SignalContribution[]` | Ordered by signal-table order (deterministic) |
| `PairScore.durableIdentity` | `boolean` | `task.stableUuid === candidate.durableTaskUuid` |
| `PairScore.usable` | `boolean` | `total ≥ confidenceFloors.plausible` ∧ passes FR-003 gating (durable bypasses gating) |
| `PairScore.exclusion` | `"below-plausible" \| "gated-team" \| "gated-project" \| "gated-framework" \| undefined` | Machine-readable reason for non-usability (diagnostics for 009/013; never a selection input) |

## 4. MatchingResult and UnresolvedTask (output records)

| Field | Type | Rules |
|---|---|---|
| `matches` | ⟦`Match`⟧[] (002 §5 — shape frozen there) | Globally one-to-one (FR-004); ordered by task `stableUuid` ascending; `margin`, `confidence`, `durableIdentity`, `reasons`, `alternatives` filled per §7; `reasons` = signal labels + `ambiguous-margin` when downgraded |
| `unresolved` | `UnresolvedTask[]` | Every task with no assigned real pair |
| `UnresolvedTask.taskUuid` | `string` | |
| `UnresolvedTask.band` | `"unmatched"` | Fixed value (spec edge case: "Empty candidate pool: every task bands `unmatched`; output remains deterministic") |
| `UnresolvedTask.bestScore` | `integer \| undefined` | Best **usable** pair total (absent when none usable); diagnostic only |
| `unmappedIssues` | `string[]` (issueIds) | Candidates not selected for any task — input to 013 drift/unmapped classification |

`serializeMatchingResult(result): string` — stable key-sorted JSON (002 `canonicalizePlanJson`
discipline); byte-for-byte identity across runs **and input permutations** is the SC-002
artifact.

## 5. MatchingWeightOverrides (programmatic weight overrides)

006-local deep-partial for the weights the frozen `ScoringWeights` does not cover (plan.md
Complexity Tracking; research R1): `{ localTaskId?: integer ≥ 0; titleContainedRatio?:
number ∈ [0, 1]; sameProject?: integer ≥ 0; sameFramework?: integer ≥ 0 }`. Applied after the
frozen config is read; validated by §6 rules; frozen keys are **not** overridable here (they
already flow through the frozen config layering defaults → file → programmatic, 002).

## 6. Errors (typed abort surface)

| Type | Raised by | Payload / rule |
|---|---|---|
| `MatchingConfigError` | `checkMatchingConfig` (entry of every public call) | `key`, `value`, `rule` — weights integer ≥ 0; floors integer ≥ 0, `medium ≥ plausible`; `minimumMatchMargin` integer ≥ 1 (research R9) |
| `DurableIdentityCollisionError` | `projectCandidates` integrity scan | `taskUuid`, `issueIds` (all conflicting, sorted ascending) — "abort the run, apply no changes, and report the task UUID and the identifiers of all conflicting issues" (001 R5 c3; constitution II). Purity ⇒ "no changes" structurally holds |

Both extend `Error` with fixed `name` fields; no secret-shaped content (values are ids/keys).

## 7. Band / lifecycle rules (state transitions of one pair and one run)

Pair banding pipeline (normative detail:
[contracts/confidence-scoring.md](./contracts/confidence-scoring.md)):

```
projected pair ──gate(FR-003, durable bypass)──► excluded(gated-*) ── (not selectable, may appear as alternative)
      │ pass
      ├─score < plausible──► unmatched ──(alternative candidate only, mapped:false)
      └─score ≥ plausible──► usable ──solver(FR-004)──► selected ─► raw band: high(score ≥ medium floor) | low
                                                                    │
                                 non-durable ∧ raw=high ∧ margin < minimumMatchMargin
                                                                    └─► medium + reason `ambiguous-margin` (FR-005)
                                 durable ∨ margin ≥ minimumMatchMargin ─► high (unchanged)
```

Run lifecycle: `checkMatchingConfig → projectCandidates (duplicate-UUID scan ⇒ ABORT
DurableIdentityCollisionError, no result) → score → gate → assign → band/alternatives →
MatchingResult`. The abort is the only terminal failure; it precedes any output — "no
changes" is structural for a pure function.

## What this file does NOT define

- ⟦`Match`⟧ / ⟦`MatchAlternative`⟧ / ⟦`Confidence`⟧ — frozen in 002 (`src/domain/match.ts`,
  data-model §5); 006 only *computes* them.
- ⟦`Task`⟧, ⟦`RoutingResolution`⟧, ⟦`IssueView`⟧/⟦`AttachmentView`⟧, ⟦`SyncStatePayload`⟧ —
  frozen in 002; consumed as inputs.
- Config keys `scoringWeights`, `confidenceFloors`, `minimumMatchMargin` — frozen in
  002 `src/config/schema.ts`; 006 reads and validates, never redefines.
