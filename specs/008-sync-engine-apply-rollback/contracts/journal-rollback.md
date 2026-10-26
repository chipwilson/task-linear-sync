# Contract: Journal Artifacts & Rollback Lifecycle

Normative behavior behind `src/engine/journal.ts` + `rollback.ts`. The frozen
`Audit_Manifest` shape/crypto/expiry (002 §10, `src/state/manifest.ts`) is used verbatim;
the 008-local **step journal** extends it with guard material under the identical envelope
posture (research R9; deferred amendment candidate documented there).

## 1. Journal artifacts (complete-before-first-mutation)

| Artifact | Path (state dir) | Content | Encryption/expiry |
|---|---|---|---|
| Audit manifest | `manifests/<runId>.json` | Frozen shape: `runId`, `createdAt`, `repoRoot`, `planId`, `fileBackups` (full before content + hash), `checkpointBefore`, `operations` (one per planned op, attachment ops with `attachmentUrl` + `priorMetadata` — FR-015), `stepState` | Sealed envelope (AES-256-GCM versioned, key from configured env-name/keyProvider, never with ciphertext); `createdAt` in unencrypted header drives expiry (frozen `isManifestExpired`) |
| Step journal (008-local) | `runs/<runId>/journal.json` | `JournalStep[]` (data-model §5): `opId` ↔ manifest alignment, kind, target, `beforeSnapshot`/`afterSnapshot`, `intentId?`, `stepState` | Same envelope functions, same key provider, same expiry rules |

Writes: materialized **complete** (every planned op with before-snapshots pre-read) before
the first mutation; re-sealed and atomically rewritten after **every** step transition —
a crash at any point leaves an exact resume input. Journaling disabled by config ⇒ neither
artifact exists ⇒ applies proceed unjournaled and `rollbackRun` MUST refuse
(constitution I; frozen `MANIFEST_UNJOURNALED`).

`opId = sha256(planId ‖ taskUuid ‖ kind ‖ ordinal)`; `runId = sha256(planId ‖
clock.now().iso ‖ seq)` — deterministic under the injected clock (research R14).

## 2. Rollback entry and refusals

`rollbackRun(runId)` is itself a mutating run: acquires the advisory lock (frozen
semantics) and writes a run report + `last-run.json` outcome marker.

| Condition | Outcome |
|---|---|
| No manifest/step journal, or journaling disabled | `RollbackResult{ status: "refused", refusal: MANIFEST_UNJOURNALED }` |
| Header `createdAt` age > `manifestExpiryDays` (clock-injected, encryption-independent) | refuse `MANIFEST_EXPIRED` |
| Envelope tag-check failure | refuse; **no plaintext returned**; `JournalError` diagnostic only |
| Valid journal | proceed to §3 |

## 3. Step-state machine and guards (FR-013/014)

Walk `operations` in **reverse** op order. Per step, re-fetch live state
(file content / `port.getIssue` / `port.getAttachmentByUrl`) and compare against the
snapshots:

```
                 ┌ current == afterSnapshot ─▶ execute inverse ─▶ stepState := rolled-back
pending/applied ─┼ current == beforeSnapshot ─▶ nothing to undo ─▶ stepState := rolled-back  (no repeat)
                 └ matches neither ───────────▶ stepState := conflict-halted, HALT
                                               (RollbackResult.status "partial"; resume re-evaluates)
rolled-back ─────▶ skip (interrupted-rollback resume never repeats completed steps)
```

Inverses by kind (data-model §5): restore file from `fileBackups`; restore each patched
issue field to its before value (`update-issue`); `archiveIssue` for issues created during
the run (**never** delete); re-upsert `priorMetadata` by URL, or no-op where none existed;
`rollback`-append history per history-log.md §4 (attachments and pages are never removed;
page-0 canonical created during the run retained — FR-016).

After all steps: checkpoint store restored from `checkpointBefore` — entries present are
rewritten, entries absent are **removed** (FR-013 "restore or remove"), non-history payload
adjustments mirror the restored issue state (FR-016).

## 4. Preservation invariants (verified by SC-003 assertions)

- Sync history: event count after rollback = count before rollback + `rollback` events;
  **zero** prior events lost or altered; zero continuation pages removed.
- Durable identity: page-0 canonical attachments (including ones first created by the
  rolled-back run) retained; the task UUID remains resolvable by identity lookup.
- Files, issue fields, checkpoints: byte/value-equal to their pre-run state for every
  journaled op whose inverse executed.
- Issues created during the run: `archived === true`; no created issue remains active.
- The rolled-back run's `CreateIntent` records are never rewritten to `pending` or
  replayed; `indeterminate`/`confirmed-created` history of attempts is audit-visible.

## 5. Interaction with `fail`-aborted and crashed runs

A run aborted by the `fail` action or crashed mid-mutation leaves steps in
`pending`/`applied` states; the same rollback walk applies — `pending` steps whose live
state never moved match `beforeSnapshot` ⇒ marked `rolled-back` without action; partially
applied file writes are restored from `fileBackups` (whole-file granularity is the
rollback unit). No automatic rollback is performed by the engine itself: aborting reports
and returns; the operator decides (spec edge case: "already-applied journal steps remain
rollback-able").
