# Phase 0 Research: Sync Engine — Conflict Resolution, State Persistence, Apply, Rollback

**Feature**: `008-sync-engine-apply-rollback` | **Date**: 2026-10-26

Resolves every Technical Context unknown and every dependency/integration question.
No NEEDS CLARIFICATION remains in plan.md. Each entry: **Decision / Rationale /
Alternatives considered**.

## R1. Module placement and dependency budget

- **Decision**: New disjoint `src/engine/` module group implementing the frozen `SyncEngine`
  interface, exposed through one additive `./engine` subpath export. Zero new runtime
  dependencies; engine code imports Node built-ins plus `src/{domain,config,state,urls,
  gates,ports,discovery,parsing,routing,titles,matching,tracker}` only.
- **Rationale**: 002's plan pre-reserved `src/engine` for this feature; ROADMAP rule 2
  forbids editing frozen or other-wave modules; constitution V demands exactly one engine
  implementation, and a dedicated module group with an import-scan contract test makes
  "no parallel path, no port bypass" structurally checkable. The zero-dependency posture of
  002/007 is preserved (the transport allowance is a ceiling, not a quota).
- **Alternatives considered**: (a) implementing the engine inside `src/ports/` — rejected,
  ports are frozen type-only contracts; (b) a separate workspace package — rejected, the
  constitution ships one publishable package; (c) pulling in a diff library (e.g.
  `jsdiff`) for classification — rejected, normalized hashing (R3) needs no diffing, and
  rendering already exists in 004.

## R2. Mode selection and the checkpoint store

- **Decision**: Mode is selected **solely** by checkpoint presence for the repository: no
  checkpoint record for the repo ⇒ `bootstrap`, else `sync` (FR-001). `BuildPlanOptions.mode`
  is an advisory hint: when it agrees with checkpoint reality it no-ops; when it conflicts,
  FR-001 governs (reality wins) and a sanitized diagnostic entry naming the conflict is
  surfaced in the plan reasons. The checkpoint store is `sync-state.json` in the state
  directory, schema `{ schemaVersion: 1, checkpoints: Record<taskUuid, Checkpoint> }`,
  read/written exclusively through `StateStore.readJson`/`writeJson` (atomic, private).
  Mode chooses which frozen config map applies (`bootstrapConflictMap` vs
  `syncConflictMap`), and bootstrap additionally treats "no checkpoint" as the seed baseline.
- **Rationale**: FR-001 states checkpoint presence is the selection rule; keeping the hint
  advisory preserves the frozen port signature without letting a caller force an unsafe mode
  (e.g. "bootstrap" against existing checkpoints would silently overwrite the tracker).
  A single-record-map file matches `src/state/paths.ts`, which already names
  `syncState: "sync-state.json"` as the 008 checkpoint file.
- **Alternatives considered**: (a) per-task files like intents — rejected, checkpoints are
  read wholesale every run and the atomic whole-file write is the consistency unit;
  (b) treating the mode hint as authoritative — rejected, violates FR-001's MUST and
  creates a clobber vector; (c) storing checkpoints in the state payload only (tracker
  side) — rejected, spec-side change detection needs a local baseline even when the
  tracker is unreachable, and 002 data-model §6 freezes the local record.

## R3. Conflict classification via normalized content hashes

- **Decision**: One hash baseline per task. At sync completion the engine stores
  `Checkpoint.descriptionContentHash = sha256(normalize(mirror(taskSection)))`. Each run
  computes `specHash = sha256(normalize(taskSectionCurrent))` and
  `linearHash = sha256(normalize(issueDescriptionCurrent))` under the configured
  `Description_Normalization_Profile` (R5), where `normalize` is idempotent and equates the
  004 render round-trip (`normalize(mirror(render(x))) === normalize(x)`). Classification
  (FR-002): `specChanged = specHash ≠ baseline`, `linearChanged = linearHash ≠ baseline`;
  both ⇒ `both-changed`, spec-only ⇒ `spec-changed`, linear-only ⇒ `linear-changed`,
  neither ⇒ no description conflict. Bootstrap: both sides normalized; identical ⇒ no
  conflict, any meaningful difference ⇒ `both-changed`. Title changes (`Checkpoint.title`
  vs derived title) and checkbox changes (`Checkpoint.checked` vs `Task.checked`) are
  tracked separately and never route through the description-conflict machinery (FR-006).
- **Rationale**: Comparing both sides against one stored baseline is the only formulation
  that makes formatting-only drift permanently invisible (constitution "Conflict-free
  sync", SC-002): round-trip noise is normalized out of `linearHash` on both the storing
  and the comparing run, so no rewrite ever occurs and oscillation is structurally
  impossible. It also matches 002's frozen checkpoint shape exactly (single hash field).
- **Alternatives considered**: (a) storing last-seen spec and linear content side by side
  and diffing live values — rejected, doubles checkpoint size and still needs normalization
  for formatting noise; (b) three-way merge (diff3) — rejected, out of scope: conflict
  *resolution* is action-mapped (R6), not textual merging; (c) timestamp-only change
  detection — rejected, `updatedAt` proves *that* the tracker changed only when trusted,
  and says nothing about the spec side.

## R4. Conflict-marker blocks and the frozen-block rule

- **Decision**: `overwrite-spec` writes a git-style block **into the task's section**
  (replacing the section body) of the form:
  `<<<<<<< <toolId>:local <filePath>#L<line>` / local content / `=======` /
  tracker content / `>>>>>>> <toolId>:linear <ISSUE-KEY>` — labels derived from the
  configured `toolId` and the issue reference, never containing the task UUID (Principle
  II: no identity in descriptions or files). Marker synthesis lives in 008 (`markers.ts`)
  but is structurally compatible with 004's `scanConflictBlocks`/`frozenLineSet`, which
  004 already uses to set `Task.unresolvedConflict` and to refuse line renders inside
  blocks. Freeze enforcement (FR-007): any run touching a task whose `taskBody` region
  contains a conflict block sets plan decision `skip-unresolved`, writes nothing (neither
  file nor issue), appends no history event for reconciliation, and surfaces an
  unresolved-conflict report entry; a second `overwrite-spec` attempt against such a
  section is refused outright (no nested markers). Blocks survive byte-for-byte until a
  human removes the markers; removal returns the task to normal classification on the next
  run (content then classifies against the checkpoint baseline).
- **Rationale**: Reusing 004's scanner keeps one authority for "what is a conflict block"
  (the `unresolvedConflict` field frozen in 002 data-model §1 already exists for this),
  and toolId-derived labels satisfy Principle III's no-org-literals rule while making the
  block self-describing for a human resolver. Keeping UUIDs out of marker text honors
  Principle II.
- **Alternatives considered**: (a) custom `<<<SYNC` markers — rejected, git-style is
  mandated (FR-003) and human muscle memory matters on a hand-resolution path; (b) writing
  markers to a sidecar file — rejected, FR-003 says *into the task's section*; (c) engine
  re-scan logic separate from 004's — rejected, two scanners drift.

## R5. Description normalization profile

- **Decision**: `src/engine/normalize.ts` ships a built-in profile named `"default"`,
  resolved by the configured `descriptionNormalizationProfile` string through a small
  registry that consumers may extend programmatically (constitution III deep-merge
  precedence). Built-in rules: CRLF/CR→LF, tabs-in-blank-lines stripped, trailing
  whitespace per line removed, runs of blank lines collapsed to one, single trailing
  newline enforced, Unicode NFC. It deliberately does **not** alter content-bearing
  Markdown (emphasis, list markers, heading `#` counts, code fences).
- **Rationale**: The profile must equate exactly the 004-render/007-tracker round-trip
  noise (line endings, trailing whitespace, blank-line padding the platform adds or drops)
  and nothing more, or it would mask real edits. A named-registry default with override is
  the constitution III pattern.
- **Alternatives considered**: (a) full Markdown AST canonicalization — rejected, too
  aggressive (rewrites semantics: list normalization, escape handling), risking silent
  conflict suppression of real changes; (b) hard-coded normalization with no profile seam —
  rejected, violates III (every default overridable) and would require an amendment for
  consumers whose platform noise differs.

## R6. Action resolution and the six effects

- **Decision**: Resolution is a pure function
  `(mode, conflictType, maps, context) → { action, effect }`. Maps come from
  `ResolvedConfig.bootstrapConflictMap` / `syncConflictMap` with FR-004 built-in defaults
  (`bootstrapConflictDefaults` / `syncConflictDefaults` exported from `actions.ts`, each
  type independently overridable via the frozen merge chain). Effects (FR-003), applied to
  the **whole tool-managed issue description only** — never to the synced state payload:
  - `overwrite-linear` — push the screened, rendered task section to the issue
    (`updateIssue` description); history `description-updated`.
  - `overwrite-spec` — replace the task's section with the R4 marker block embedding
    **local content and tracker content**; issue untouched, nothing pushed; history
    `conflict-detected`. (This is what "write tracker content into the section" means in
    001 FR-038: the section becomes the conflict block containing both sides.)
  - `report-only` — no changes on either side; conflict surfaced with conflict type +
    action (FR-005); history `conflict-detected`.
  - `skip` — no changes, surfaced only as an internal journal/plan reason (not a report
    conflict entry).
  - `prefer-newer` — newer side wins via the corresponding overwrite effect (see
    recency rule below); indeterminable ⇒ degrades to `report-only` (US1 AC6).
  - `fail` — engine throws `EngineFailError` before performing any further mutation;
    already-applied journal steps remain rollback-able; run status `aborted`, report +
    `last-run.json` marker record it.
  Recency for `prefer-newer` (FR-003, spec Assumption): single-sided conflicts are
  self-attesting (`spec-changed` ⇒ spec newer ⇒ overwrite-linear; `linear-changed` ⇒
  tracker newer ⇒ overwrite-spec). `both-changed` has no spec-side timestamp source ⇒
  **always** report-only degradation. `linear-changed` additionally degrades to
  report-only when `issue.updatedAt ≤ Checkpoint.issueUpdatedAt` (fake clocks and
  same-instant edits make recency undecidable) — never guessed.
  Every applied action records `{ conflictType, action, reason }` surfaced in plan entries,
  apply `OperationOutcome.detail`, and reports (FR-005).
- **Rationale**: FR-003 enumerates the six effects verbatim; encoding them as one pure
  resolver keeps bootstrap/sync maps, defaults, and overrides testable in isolation (the
  36-cell SC-004 matrix is a table-driven unit test over this function). The conservative
  recency rule implements "degrades to report-only rather than guessing".
- **Alternatives considered**: (a) spec-side mtime/git-blame as a recency signal for
  `both-changed` — rejected, mtime is unreliable (clones, checkouts) and git plumbing is
  not a dependency; guessing violates the spec Assumption; (b) resolving `prefer-newer` by
  comparing event counts in history — rejected, history is audit log, not clock; (c)
  letting `fail` roll back automatically — rejected, US edge case says already-applied
  steps remain *rollback-able*, not auto-rolled-back; the operator decides.

## R7. Checkbox completion → workflow state

- **Decision**: When `Task.checked ≠ Checkpoint.checked` (spec side changed) and the
  description is otherwise unconflicted, the engine sets the issue's desired state to the
  **configured done state** when checked, **backlog state** when unchecked (FR-006). State
  identities are per-team consumer-configured workflow values (Principle III: no built-in
  default); the engine maps name→id using the 007 `discoverMetadata` workflow-state
  snapshot captured at plan time and re-fetched before mutation; an unknown configured
  state name is a plan-time validation failure (sanitized), not a runtime surprise. The
  transition is issued as `updateIssue(stateTypeId=…)` — independent of the description
  machinery (a checked-toggle with unchanged description never classifies a description
  conflict, US1 AC5) — and appends one `checkbox-changed` history event. Tracker-side
  state changes (someone moved the issue) are recorded into the checkpoint but never
  pushed back; state is spec→tracker only.
- **Rationale**: FR-006 scopes the trigger to spec-side checkbox change with the issue
  "otherwise unchanged"; modeling it as its own op kind keeps the conflict matrix pure and
  matches the frozen `IssueUpdatePatch.stateTypeId` seam.
- **Alternatives considered**: (a) deriving done/backlog ids from Linear workflow *type*
  (`completed`/`backlog`) instead of configured identities — rejected, III forbids
  assuming workspace identities; configured names are the mandated source; (b) bidirectional
  state sync — rejected, FR-006 is one-directional; tracker-side moves are reflected into
  checkpoints for observability only.

## R8. Sync-state payload rewrite, history append, and rollover

- **Decision**: Two attachment write families per task, both via the port's URL-idempotent
  `upsertAttachmentByUrl` (FR-015):
  1. **Page 0 canonical** (`canonicalAttachmentUrl`): the non-history `SyncStatePayload`
     fields (`taskUuid`, `frameworkMetadata`, `descriptionContentHash`, `cursors.lastSyncAt`)
     are rewritten **authoritatively** (full replace, stable-key serialization via frozen
     `serializeSyncStatePayload`) every applied run after screening; page 0's `history`
     member carries the *page-0 slice* of the log.
  2. **History append** (FR-009): exactly one screened `SyncHistoryEvent` per
     sync-affecting action, kinds mapped 1:1 from the frozen vocabulary
     (`discovered` at bootstrap seed, `issue-created`, `matched`, `title-updated`,
     `description-updated`, `checkbox-changed`, `conflict-detected`, `rollback`). Append =
     read current page N, append event, re-upsert page N; if the appended page would exceed
     `historyLogMaxEntries` (default 50) or `historyLogMaxBytes`, the overflow event(s) roll
     to page N+1 at `continuationAttachmentUrl(cfg, uuid, N+1)` whose metadata carries the
     deterministic page record `{ taskUuid, page, history }` under the same namespace key
     (data-model §7). Chain state is re-derived from URLs on each run via
     `getAttachmentByUrl` — no page index is ever stored locally (007 chain precedent).
     Prior entries are never modified or removed; a `rollback` event references the
     reversed `opId`s.
- **Rationale**: Deterministic URL addressing + create-or-update makes repeated/resumed
  applies non-duplicating without storing attachment ids (FR-015, Principle IV);
  full-payload rewrite honors FR-008's "rewriting it authoritatively" while the
  append-only log rides in the same attachment pages (002 §8). Reading chain state from
  the tracker each run (bounded by page walk) removes local/tracker drift risk entirely.
- **Alternatives considered**: (a) journaling a local mirror of the attachment chain —
  rejected, creates a second source of truth that rollback/history rules could desync;
  (b) one attachment per history page *batch* with timestamps in URLs — rejected, breaks
  deterministic addressing (URL must not depend on mutable state); (c) appending history via
  `updateAttachment(id,…)` with ids discovered per-run — equivalent outcome but the frozen
  invariant "no attachment id stored anywhere by callers" makes URL-upsert the
  duplication-safe choice.

## R9. Apply journaling: frozen manifest + 008-local step journal

- **Decision**: Two artifacts per journaled run, both in the state directory, both written
  complete-before-first-mutation and updated atomically per step:
  1. The frozen `Audit_Manifest` (`src/state/manifest.ts` seal/open, AES-256-GCM versioned
     envelope, unencrypted `createdAt` header for expiry): `fileBackups` (full before
     content + hash per file the run will write), `checkpointBefore` (full checkpoint map
     snapshot), `operations` (one `AuditOperation` per planned mutation incl. every planned
     attachment create-or-update with target issue, addressed URL, and prior attachment
     metadata where one existed — FR-015), and per-step `stepState`
     (`pending → applied → rolled-back`, or `conflict-halted`).
  2. The 008-local **step journal** `runs/<runId>/journal.json`, sealed with the *same*
     envelope function, key provider, and expiry rules: `JournalStep[]` keyed by the same
     deterministic `opId`s, carrying the rollback guard material the frozen shape does not
     model: per-op `beforeSnapshot`/`afterSnapshot` (issue field values for updates, file
     content hash for renders, prior/after attachment metadata, created-issue id) and the
     create-intent linkage.
  After `fail`-aborts, interruptions, or crashes the two artifacts + intents + lock record
  are the complete recovery input. Journaling disabled by config ⇒ neither artifact exists
  ⇒ applies proceed unjournaled (frozen engine-gates posture) and `rollbackRun` refuses
  `MANIFEST_UNJOURNALED`.
- **Rationale**: The frozen `AuditOperation` carries `priorMetadata` only for attachments;
  FR-013/014 need per-field before *and* result values for issue updates and rendered files
  to implement "state matches neither its before nor its result state ⇒ conflict-halt".
  Rather than amend the frozen shape (ROADMAP rule 2 reserves amendments for cross-feature
  governance, and this need is 008-internal: no other feature reads step journals), the
  extension rides the identical envelope/crypto/expiry posture — satisfying the
  constitution's manifest integrity constraint for it by construction. This mirrors 007's
  R11 precedent (local option + documented deferred amendment candidate).
- **Alternatives considered**: (a) additive amendment to `AuditOperation`
  (`beforeValues`/`appliedValues`) — legitimate but heavier governance than needed now;
  recorded as the **deferred amendment candidate** should 010/012 ever need to read step
  material; (b) storing step snapshots unencrypted beside the manifest — rejected,
  before/after content includes user spec text (screened, still sensitive), and the
  constitution's journaling constraint demands encryption for run material; (c) encoding
  patch values into the frozen operation's free-form `kind` string — rejected, stringly-
  typed abuse with no schema.

## R10. Apply pipeline: gates, order, creates, indeterminate handling

- **Decision**: `applySyncPlan(plan, gates)` executes the frozen enforcement order exactly:
  (1) gate evaluation against `GateRequest` — all failures collected and returned together
  (`status: "refused"`); (2) advisory lock acquire via `src/state/lock.ts` (`LOCK_HELD`
  refusal on live-process contention); (3) plan stability: re-run frozen
  `validatePlanReference` over live file hashes + HEAD, **and** re-fetch each targeted
  issue snapshot via `getIssue`/`getAttachmentByUrl`, aborting with zero mutations on any
  drift (Principle I "immediate re-fetch before each mutation" is implemented as this
  pre-flight plus per-op precondition re-check at mutation time); (4) journal
  materialization complete-before-first-mutation (R9) — with the plan's full op list, file
  backups, and attachment prior metadata pre-read; (5) mutations.
  Mutation order (FR-011): tasks in plan order, **parents created before children**
  (dependency-sorted on `parentUuid`, stable across files), and **sibling issues within the
  same parent emitted in reverse of their working order** — 001 R12's compensation so the
  tracker's newest-first position rendering lands tasks in working order. Per op: screen →
  assert plan precondition → mutate → journal step → append history event (R8) → step
  `applied`. Create flow: `writeCreateIntentBeforeAttempt` (durable `pending` pre-attempt)
  → `createIssue` (never auto-retried — port posture) → success: intent
  `confirmed-created`, page-0 canonical attachment upsert; error: reconcile via
  `findIssuesByAttachmentUrl(canonicalUrl)` — exactly one match ⇒ adopt it and
  `confirmed-created` + `reconciled`; zero or >1 ⇒ intent `indeterminate`, **abort further
  creation for that task** (children of that task skip creation), append a report entry;
  indeterminate creates are never replayed in-run or by resume (FR-012, constitution
  Resilience); >1 additionally surfaces the Principle II integrity-failure diagnostic.
  Assigned task lines are rewritten through 004 `renderTaskLines` with the issue reference
  and derived title before file writes; render failures inside frozen blocks are skipped
  (004 refuses; FR-007). After the last mutation: checkpoint store write (atomic), report +
  `last-run.json` marker (R13), lock release. `OperationOutcome`s carry sanitized details.
- **Rationale**: The order is the frozen engine-gates contract; the rest is its
  composition with 006/007 surfaces exactly as those features documented for their
  consumers. Intent-before-attempt is already provided as a "resolves only after rename"
  primitive by `src/state/intent.ts` — 008 is its designated user.
- **Alternatives considered**: (a) creating children first and re-parenting — rejected,
  violates FR-011; (b) retrying failed creates once — rejected, constitution: creates are
  *never* automatically retried; (c) deferring checkpoint writes until rollback window
  close — rejected, checkpoints are the baseline for the *next* run and must land with the
  run that established them (journal restores them on rollback anyway).

## R11. Resumable rollback with step guards and history preservation

- **Decision**: `rollbackRun(runId)`:
  1. Read manifest envelope header; expired (frozen `isManifestExpired`, clock-injected) ⇒
     refuse `MANIFEST_EXPIRED`. Missing journal / journaling disabled ⇒ refuse
     `MANIFEST_UNJOURNALED`. Open both artifacts (AES-GCM tag check; tamper ⇒ refusal with
     no plaintext).
  2. Walk `operations` in **reverse order**. For each step (guard material from R9):
     - `stepState = "rolled-back"` ⇒ skip (resume without repeating, FR-014);
     - re-fetch current state (file content / `getIssue` / `getAttachmentByUrl`):
       current **matches before-snapshot** ⇒ nothing to undo, mark `rolled-back`;
       current **matches after-snapshot** ⇒ execute the inverse
       (restore file from `fileBackups`; `updateIssue` field→before value;
       `archiveIssue` for issues created this run; `upsertAttachmentByUrl` with
       `priorMetadata`, or skip where no prior attachment existed);
       matches **neither** ⇒ mark `conflict-halted`, **halt** the rollback, return
       `status: "partial"` naming the step; a later resume re-evaluates the halted step
       (its guard is idempotent per state, so an externally-fixed value proceeds).
     - Persist step-state transitions by re-sealing + atomically rewriting both artifacts
       after every step (crash at any point ⇒ resume is exact).
  3. Restore the checkpoint store from `checkpointBefore` (tasks with no prior checkpoint
     entry are *removed*, FR-013 "restore or remove … to match its prior state").
  4. **History & identity preservation** (FR-016): no attachment is ever deleted, no
     history entry removed or edited, continuation pages untouched; a page-0 canonical
     attachment first created during the rolled-back run is **retained** (identity anchor —
     Principle II); the non-history payload of retained/updated page-0 attachments is
     adjusted to mirror the restored issue state (e.g. `descriptionContentHash` back to the
     checkpoint value); a `rollback` history event referencing the reversed `opId`s is
     **appended** (R8 append path — rollback itself mutates only by appending).
  5. Report + `last-run.json` outcome marker; lock not required to be held across runs —
     rollback acquires the lock itself (a rollback is a mutating run, constitution I).
- **Rationale**: Guarding by *observed state* (before/after snapshot comparison) rather
  than by stored cursor makes every step's undo idempotent and the whole walk resumable —
  exactly FR-014's "state matches neither … reported as a conflict and halted". Reversing
  order respects parent-before-child (archive children before parents reads naturally in
  reverse). Retaining page-0 attachments is the only rollback behavior consistent with
  "never rewound identity" (Principle II, FR-016).
- **Alternatives considered**: (a) delete created issues instead of archiving — rejected,
  FR-013 says archive, and deletion would orphan the durable-identity anchor; (b)
  truncating history pages added during the run — rejected, FR-016 forbids; (c) replaying
  forward then compensating — rejected, more mutations than inverse-restoration; (d)
  trusting `stepState` alone without re-fetch (cursor-style resume) — rejected, violates
  the conflict-halt requirement when external drift happened mid-rollback.

## R12. Default SecurityScreener implementation

- **Decision**: `src/engine/screening.ts` provides the built-in `SecurityScreener`
  (interface frozen in `src/ports/engine.ts`, "behavior owned by the engine run"):
  category-tagged rules — blocking: token/secret-shaped strings (high-entropy assignments,
  known provider key prefixes), private key blocks; non-blocking: email addresses
  (redacted in output), configurable review-term annotations. `screen()` returns
  `{ output, blocked, findings }` per the frozen shape. The engine pipes **every** string
  crossing a boundary (issue descriptions, titles pushed to the tracker, attachment
  payloads including serialized history, report text, `OperationOutcome.detail`) through
  it *before* transmission; `blocked.length > 0` aborts propagation of that content only
  (op fails with a sanitized detail; conflict/report entry names the finding categories,
  never the content). The ruleset is an injectable `EngineOptions.screener` override and a
  config-listed rule profile (Principle III); tests inject a deterministic fake.
- **Rationale**: The frozen interface makes screening a caller duty of the engine; nothing
  else can own the default without creating a second path. Abort-affected-content-only is
  the constitution's wording ("aborts propagation of the affected content"); blocking the
  whole run would punish unrelated tasks for one leaking section.
- **Alternatives considered**: (a) a full secret-scanning dependency (gitleaks-class) —
  rejected by R1's zero-dependency posture and by the port allow-list precedent; the
  built-in heuristic set is overridable for orgs needing more; (b) refusing the entire run
  on any blocking finding — rejected as above (FR-level granularity is per-content); (c)
  redacting secrets instead of blocking — rejected for blocking categories: the
  constitution says blocked findings abort propagation, they are not sanitized into
  acceptability.

## R13. Plan persistence and report artifacts

- **Decision**: `buildSyncPlan` (read-only) persists the `StoredPlan` to
  `plans/<planId>.json` in the state directory (required for `Plan_Reference` validation at
  apply) and writes the paired report artifacts `reports/<runId>/report.json` (conforming
  to frozen `specs/002-core-domain-contracts/contracts/plan-report.schema.json`) +
  `report.md` (sanitized by construction: structural field exclusion + screener pass;
  grouping project → milestone, separate unmapped section, unresolved-conflict surfacing,
  security-assertions block) — state directory only, never the repo tree. Conflicts
  classified this run surface as `decision: "conflict"` entries with `conflictType` +
  mapped `action` reasons (FR-005; 013's drift/conflict signals ride the same entries).
  `applySyncPlan`/`rollbackRun` write run reports at the same paths and update
  `last-run.json` (frozen `LastRunMarker`). Report `runId`s derive from the injected clock +
  planId, deterministic under test clocks.
- **Rationale**: The plan report is 009's display source and 012's plan-review input — 002
  froze the schema precisely so 008 can emit it without 009 existing yet; run-state writes
  are the frozen `StateStore`'s job.
- **Alternatives considered**: (a) markdown rendering deferred wholly to 009 — rejected,
  `ApplyResult.reportPaths` in the frozen engine contract obligates the engine to produce
  the paired artifacts; 009 renders/paginates CLI-side from them; (b) storing reports
  repo-side for convenience — rejected, constitution I: run state lives outside the
  working tree.

## R14. Error taxonomy, runId, and determinism plumbing

- **Decision**: `src/engine/errors.ts` defines `EngineError` kinds for internal failures
  (`EngineFailError` for the `fail` action, `IntegrityError` for multi-issue identity
  collisions, `JournalError` for tamper/unreadable journals); user-facing refusals **reuse
  the frozen `GateFailure` codes verbatim** — no new refusal vocabulary (013 matches on
  frozen codes). `runId = sha256(planId ‖ clock.now().iso ‖ seq)` — deterministic under the
  injected clock. Deterministic `opId = sha256(planId ‖ taskUuid ‖ kind ‖ ordinal)`. Every
  timestamp comes from `EngineDependencies.clock`; every id from content/clock inputs;
  the fake port's scripted worlds make integration runs byte-reproducible.
- **Rationale**: The frozen gate vocabulary is a cross-surface contract (009/012/013 match
  on codes); inventing engine-local refusal codes would fork it. Hash-derived ids make
  journal files, reports, and manifests reproducible for property tests.
- **Alternatives considered**: (a) `crypto.randomUUID()` for runId/opId — rejected,
  nondeterministic ids break byte-for-byte determinism (Principle IV) in golden-file tests;
  (b) extending `GateFailureCode` — rejected, amendments only (frozen vocabulary).
