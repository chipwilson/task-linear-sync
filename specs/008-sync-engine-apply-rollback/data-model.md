# Phase 1 Data Model: Sync Engine Records and Owned Behavior

**Feature**: `008-sync-engine-apply-rollback` | **Date**: 2026-10-26

008 **consumes** the frozen 002 entities (`Checkpoint`, `ConflictResolutionMap`,
`SyncStatePayload`, `SyncHistoryEvent`, `AuditManifest`, `AuditOperation`, `CreateIntent`,
`Plan`, `PlanTaskEntry`, `RunLockRecord`, `LastRunMarker`, `GateRequest`/`GateFailure` —
see `specs/002-core-domain-contracts/data-model.md`, shapes untouched) and **owns behavior**
plus a small set of 008-local records defined here. TypeScript lives in `src/engine/`
(signatures per contracts/); this document is the readable mirror.

```
Run ──1 AuditManifest (frozen §10) ──* AuditOperation (frozen §10)
 │        └──* JournalStep (008-local, same opIds; before/after guard material)
 ├──1 CheckpointStore (sync-state.json; * Checkpoint frozen §6)
 ├──* CreateIntent (frozen §11; transitions owned here)
 ├──* AppliedAction { ClassificationOutcome + resolved ConflictAction }
 ├──1 EnginePlanRun { mode, ConflictResolutionMap snapshot, * ClassificationOutcome }
 └──1 RunReport (plan/run report artifacts per frozen §15 + last-run marker §13)

Task (frozen §1) ──1 Checkpoint ──1 SyncStatePayload (frozen §8, page 0)
                     │                   └──* SyncHistoryEvent (frozen §8, append-only)
                     └──* HistoryPagePayload (008-local continuation pages 1..n)
```

## 1. CheckpointStore (`sync-state.json`, owner: 008)

File schema (008-local; entries are the frozen `Checkpoint` records):

| Field | Type | Rules |
|---|---|---|
| `schemaVersion` | `1` | Fixed; future versions are amendments |
| `checkpoints` | `Record<taskUuid, Checkpoint>` | One per task with a completed sync; written atomically via `StateStore.writeJson` (owner-only, outside repo) |

Lifecycle: read at plan start (presence ⇒ mode, §2); updated only as the final step of a
successful apply (atomic whole-file write); fully restored/rolled back from
`AuditManifest.checkpointBefore` on rollback (entries absent in the snapshot are **removed**
— FR-013). Rollback of an interrupted apply restores exactly the pre-run map, no partial
entries.

## 2. Mode selection (behavior over frozen config, FR-001)

`selectMode(checkpointStore, hint) → "bootstrap" | "sync"`: `sync` iff the store holds any
checkpoint for the repository; else `bootstrap`. The advisory `BuildPlanOptions.mode` hint
never overrides reality (research R2); a disagreeing hint yields a sanitized diagnostic
reason. Mode selects the active `ConflictResolutionMap` (frozen §7):
`bootstrapConflictMap` / `syncConflictMap`, defaults per FR-004 exported as built-ins
(research R6).

## 3. ClassificationOutcome (008-local, `classify.ts`)

One per task per run; drives plan entries and apply actions.

| Field | Type | Rules |
|---|---|---|
| `taskUuid` | `string` | FK → frozen `Task`/`Checkpoint` |
| `mode` | `"bootstrap" \| "sync"` | §2 |
| `descriptionConflict` | `DescriptionConflictType \| null` | `null` ⇒ no conflict; computed from normalized hash comparison: `specChanged = sha256(normalize(section)) ≠ checkpoint.descriptionContentHash`, `linearChanged = sha256(normalize(issueDescription)) ≠ same` (sync); bootstrap: identical-after-normalization ⇒ `null`, else `both-changed` (FR-002) |
| `titleChanged` | `boolean` | `Task` derived title ≠ `Checkpoint.title`; independent of description machinery |
| `checkedChanged` | `boolean` | `Task.checked` ≠ `Checkpoint.checked` (drives §6 completion op) |
| `stateTypeDrift` | `boolean` | Tracker state ≠ `Checkpoint.issueStateType` (recorded into checkpoint; never pushed back) |
| `unresolvedConflict` | `boolean` | Frozen §1 field true ⇒ plan decision `skip-unresolved` (FR-007 freeze: no reads-writes, no markers, report entry) |
| `reasons` | `string[]` | Machine-readable labels incl. conflict type + resolved action (FR-005) |

Validation: `descriptionConflict` computed only when a checkpoint exists; formatting-only
differences MUST NOT appear on either side (normalization equates the 004/007 round trip —
research R3/R5; SC-002).

## 4. AppliedAction (008-local, `actions.ts`)

`{ taskUuid, conflictType, action: ConflictAction, effect, degraded: boolean, reason }`.
Resolution is the pure function `(mode, conflictType, map) → action`; `effect` is the
concrete mutation (§5 op kinds) or `none` for `report-only`/`skip`. `degraded: true` marks
`prefer-newer → report-only` degradations (recency indeterminable — FR-003, US1 AC6).
`fail` maps to effect `abort-run`: throw before next mutation; journaled steps stay
rollback-able (edge case, research R6).

## 5. Op taxonomy and journal material (008-local, `ops.ts` + `journal.ts`)

Deterministic `opId = sha256(planId ‖ taskUuid ‖ kind ‖ ordinal)` (research R14). Every
produced op lands in the frozen `AuditManifest.operations` (one `AuditOperation` per op,
attachment ops with `attachmentUrl` + `priorMetadata`, FR-015) **and** in the 008-local
`JournalStep` carrying guard material:

| JournalStep field | Type | Rules |
|---|---|---|
| `opId` | `string` | Matches the frozen `AuditOperation.opId` |
| `kind` | enum below | |
| `targetIssueId` / `filePath` | `string` | Mutated target |
| `beforeSnapshot` | kind-specific | Rollback restore material |
| `afterSnapshot` | kind-specific | Result-state guard material (FR-014) |
| `intentId?` | `string` | Create ops only; FK → frozen `CreateIntent` |
| `stepState` | `AuditStepState` (frozen) | `pending → applied → rolled-back \| conflict-halted` |

Storage: `runs/<runId>/journal.json`, sealed with the frozen AES-256-GCM envelope
(`src/state/manifest.ts`), same key provider and expiry rules; rewritten atomically after
every step (resumability). Deferred amendment candidate to `AuditOperation` documented in
research R9.

Op kinds (mutation vocabulary; emitted in apply order — parents before children, siblings
of one parent in **reverse** working order, FR-011):

| Kind | Mutation | beforeSnapshot | afterSnapshot | Inverse (rollback) | History event |
|---|---|---|---|---|---|
| `create-issue` | `port.createIssue` (never auto-retried) | — | created `IssueView` snapshot; else reconcile outcome via `findIssuesByAttachmentUrl` | `archiveIssue` (created issues archived, never deleted) | `issue-created` |
| `update-issue` | `port.updateIssue` (title/description/stateTypeId patch) | prior field values | patched field values | restore each patched field to prior value | `title-updated` / `description-updated` / `checkbox-changed` (per field) |
| `upsert-attachment` | `port.upsertAttachmentByUrl` (page 0 payload and/or history pages) | prior metadata (`null` if none existed) | resulting metadata | re-upsert prior metadata, or skip when no prior attachment existed (page-0 created during run is **retained**, FR-016) | rides in the appended event itself |
| `render-file` | 004 `renderTaskLines` + atomic file write (full before content in frozen `fileBackups`) | file content hash | rendered content hash | restore from `fileBackups.beforeContent` | none (render is local mirror; task-level events already recorded) |
| `write-checkpoint` | checkpoint store update (final step) | — (frozen `checkpointBefore` snapshot is the material) | written store hash | restore/remove entries to match `checkpointBefore` | none |

Screening: every string entering `update-issue`, `upsert-attachment`, and `render-file`
output passed the screener pre-journaling; blocked content never becomes a step (§ contract:
`contracts/engine-pipeline.md`).

## 6. Completion mapping (behavior over frozen config, FR-006, `completion.ts`)

`checkedChanged ∧ ¬descriptionConflict ⇒ desiredStateType = checked ? configured done state
: configured backlog state` (per-team workflow identities from consumer config — no built-in
default, constitution III; name→id via 007 `discoverMetadata` snapshot, re-fetched pre-
mutation; unknown name ⇒ plan-time validation failure). Independent of the description
conflict machinery (US1 AC5); produced as an `update-issue(stateTypeId)` op +
`checkbox-changed` event.

## 7. History pages on the attachment chain (008-local continuation shape, `payload.ts`/`history-page.ts`)

Page 0 (canonical URL): frozen `SyncStatePayload` — non-history members
(`taskUuid`, `frameworkMetadata`, `descriptionContentHash`, `cursors`) rewritten
authoritatively per apply after screening; `history` = page-0 slice of the log (FR-008).

Continuation pages `n ≥ 1` (deterministic continuation URLs; no local index stored):

| Field | Type | Rules |
|---|---|---|
| `taskUuid` | `string` | Chain key |
| `page` | `integer ≥ 1` | Matches the page segment of the addressing URL |
| `history` | `SyncHistoryEvent[]` (frozen) | Chronological slice; entries moved onto a page are never re-edited |

Serialized with the frozen canonical serializer under the same
`metadataNamespaceKey`. **Rollover** (FR-010): an append that would exceed
`historyLogMaxEntries` (default 50) or `historyLogMaxBytes` moves only the new event(s) to
page `n+1` (create-or-update by URL), preserving every prior entry on its page —
no rewriting, no compaction, no deletion. One event per sync-affecting action (FR-009);
`rollback` events reference reversed `opId`s.

## 8. Create-intent lifecycle (behavior owner: 008; shape frozen §11)

```
(none) ──writeCreateIntentBeforeAttempt──▶ pending
pending ──create succeeds────────────────▶ confirmed-created
pending ──create errors, identity-reconcile finds exactly 1──▶ confirmed-created → reconciled
pending ──create errors, reconcile finds 0 or >1────────────▶ indeterminate   (terminal for the run;
                                                               never auto-replayed; further creation
                                                               for the task aborts — FR-012)
```

Crash after `pending` (intent file exists, no transition) is the reconciliation signal for
later runs: identity lookup classifies as above; `indeterminate` is never replayed — a
subsequent plan may include a fresh create (new intent) only after reconciliation adopted
nothing, and >1 identity matches is surfaced as the Principle II hard integrity failure.

## 9. Run lifecycle and rollback step-state (behavior owners: 008)

Apply: `start → gates (all-or-refuse with frozen GateFailure codes) → locked → guards-re-
checked (+issue snapshots) → journaled (manifest + step journal complete) → mutating* →
completed | failed | aborted(fail-action) → last-run marker + report`.

Rollback (reverse op order, per-step guard):

```
step pending/applied ── current == after ────▶ inverse executed ─▶ rolled-back
step *               ── current == before ──▶ nothing to undo ──▶ rolled-back   (resume: no repeat, FR-014)
step *               ── matches neither ────▶ conflict-halted   (HALT; status "partial";
                                               resume re-evaluates after external fix)
```

Refusals: `MANIFEST_UNJOURNALED` (journaling off / no journal), `MANIFEST_EXPIRED`
(frozen `isManifestExpired`, encryption-independent header). Tamper (tag check) ⇒ refusal,
no plaintext. Rollback always appends the `rollback` history event and never removes
history, pages, or the identity anchor (FR-016). `last-run.json` outcome marker written for
applies and rollbacks (frozen §13).

## 10. Traceability to spec entities

| Spec Key Entity | Where |
|---|---|
| Checkpoint (owned) | §1, §2, §9; frozen shape §6(002) |
| Conflict Resolution Map (owned) | §2, §4; frozen shape §7(002); defaults FR-004 |
| Sync State Payload / Sync History Event (write semantics owned) | §5, §7; frozen shapes §8(002) |
| Audit Manifest / Create Intent (journaling rules owned) | §5, §8, §9; frozen shapes §10–11(002) |
