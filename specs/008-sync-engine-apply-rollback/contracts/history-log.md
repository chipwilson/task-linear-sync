# Contract: Sync-State & History Log Write Protocol (attachment chain)

Normative behavior behind `src/engine/payload.ts` + `history-page.ts`. Shapes stay frozen
(002 §8: `SyncStatePayload`, `SyncHistoryEvent`, canonical serializer, namespace key, URL
scheme). All attachment access is via the frozen `Linear_Port` URL-idempotent ops —
attachment ids are never stored (frozen invariant), so every write below is a
create-or-update by deterministic URL: repeated, resumed, or re-run applies MUST NOT
duplicate (FR-015, Principle IV).

## 1. Page-0 canonical rewrite (FR-008)

On **every applied run** for a task with a landed action, the engine rewrites the
page-0 attachment at `canonicalAttachmentUrl(cfg, taskUuid)`:

- Non-history members — `taskUuid`, `frameworkMetadata`, `descriptionContentHash` (hash of
  the *normalized mirrored* content), `cursors.lastSyncAt` (injected clock) — are written
  **authoritatively** (full replacement of the previous value, not a merge), after the
  screener pass.
- `history` holds the page-0 slice of the log per §3 (the payload is one canonical-serialized
  string under `metadataNamespaceKey`).
- The conflict-marker text written by `overwrite-spec` lives in the **spec file only**; the
  payload is never the carrier of markers, and no action may modify the synced state
  payload as a conflict effect (FR-003).

## 2. Exactly-one append per affecting action (FR-009)

One `SyncHistoryEvent` per sync-affecting action that *lands* (screened description;
`at` from injected clock):

| Affecting action | `kind` | Typical `references` |
|---|---|---|
| bootstrap seed of a task | `discovered` | — |
| issue created (incl. adopted via reconciliation) | `issue-created` | issue id |
| task↔issue matched on a later run (first durable record) | `matched` | issue id |
| title update | `title-updated` | issue id |
| description update (any `overwrite-linear` effect) | `description-updated` | content hash |
| checkbox/workflow state change | `checkbox-changed` | state name |
| conflict detection (`report-only`, `skip` excluded, `overwrite-spec`, degraded `prefer-newer`) | `conflict-detected` | conflict type + action |
| rollback | `rollback` | reversed `opId`s |

Zero events for non-affecting outcomes (`no-change`, skipped-unresolved tasks, refused
gates, aborted pre-mutation stages). An op that fails mid-run records an event only if its
mutation actually landed (journal step state is the authority for "landed").

## 3. Rollover (FR-010)

Pages are addressed purely by URL: page 0 canonical; page `n ≥ 1` at
`continuationAttachmentUrl(cfg, taskUuid, n)` carrying the page record
`{ taskUuid, page, history }` (data-model §7) under the same namespace key.

Append algorithm (per task run):

1. Walk `page 0, 1, … n` via `getAttachmentByUrl` until first absent page ⇒ `n` = last
   existing; chain state is never cached locally.
2. Candidate append = `history(n) + [event]`. If
   `len(candidate) > historyLogMaxEntries` (default 50) **or**
   `bytes(canonicalSerialize(candidate)) > historyLogMaxBytes` (when configured):
   roll the overflowing tail to page `n+1` (create-or-update); page `n` receives only its
   within-threshold head. Existing entries never move *backwards* or get rewritten.
3. All writes are URL-idempotent upserts; a resumed apply re-deriving the same chain state
   lands byte-identical pages (SC-001/FR-015).

**Append-only invariants (Principle IV, FR-009/016)**: entries on a page, once written,
are never edited, reordered, or removed; rollover only *adds* pages; rollback never
rewinds — it appends a `rollback` event (references the reversed `opId`s).

## 4. Rollback-time interaction (FR-013/015/016)

- Attachment ops journal `priorMetadata` (or explicit "none existed") **for every planned
  attachment create-or-update — canonical and continuation pages** — with the target issue
  and addressed URL (FR-015).
- Rollback restores prior metadata via the same URL upsert; where no prior attachment
  existed the step is a no-op: a page-0 canonical attachment first created during the
  rolled-back run is **retained** (identity anchor, FR-016); continuation pages created
  during the run are likewise **retained**, entries and all.
- The non-history payload of retained page-0 attachments MAY (and does) get adjusted to
  mirror the restored issue state (e.g. `descriptionContentHash` back to the restored
  checkpoint value) — this adjustment is *state mirroring*, not history editing.
- Net rollback history effect: exactly one appended `rollback` event per task with
  reversed actions; `prior event count` is unchanged + 0 removed.
