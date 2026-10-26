# Quickstart: Validating the Sync Engine (008)

Validation/run guide for `008-sync-engine-apply-rollback`. All scenarios are **hermetic**:
they drive the engine through the frozen `SyncEngine` interface against the 007 fake
`LinearPort` (`task-linear-sync/tracker/testing`) with a temp-directory state store and an
injected fixed clock — zero real Linear requests, zero real credentials, zero wall-clock
nondeterminism (constitution VI). Entity/behavior detail lives in
[data-model.md](./data-model.md); interface norms in [contracts/](./contracts/README.md).

## Prerequisites

- Node.js ≥ 20.0.0 (`node --version`).
- From the repository root: `npm ci` (locked manifest), then `npm run pretest`
  (builds `dist/` + compiled tests). No credentials, no Linear org, no network needed.

## Run the suites

```bash
npm test                                   # full gate: build + all tiers + coverage threshold
node scripts/run-tests.mjs --tier unit         --test-name-pattern engine-   # engine units
node scripts/run-tests.mjs --tier contract                                    # vocabulary/schema/scans
node scripts/run-tests.mjs --tier integration --test-name-pattern engine-    # fake-world scenarios
node scripts/run-tests.mjs --tier e2e        --test-name-pattern engine-     # story walkthroughs
```

Harness: `tests/helpers/engine-harness.ts` builds a fixture repo (`tests/fixtures/engine/
worlds/<world>/`), a seeded fake world, and a `SyncEngine`; injectors script create
failures and interrupt rollbacks at an exact step index.

## User Story 1 — Conflict-aware reconciliation (P1)

| # | Scenario (spec AC) | Fixture world | Verify |
|---|---|---|---|
| 1.1 | No checkpoint ⇒ bootstrap mode, own action map; meaningful diff ⇒ `both-changed`; normalized-identical ⇒ no conflict (AC1) | `first-run-bootstrap`, `formatting-noise` | Plan `mode`-driven map from `bootstrapConflictMap`; second plan reports zero pending changes (SC-001); formatting-only drift ⇒ zero conflicts, zero rewrites (SC-002) |
| 1.2 | Only issue changed ⇒ `linear-changed` ⇒ default sync action = conflict-marker write (AC2) | `linear-changed` | Classification + `overwrite-spec` effect per conflict-resolution-matrix.md §1–2; plan/report reasons name type + action (FR-005) |
| 1.3 | `overwrite-spec`: both sides embedded between git-style markers; issue untouched; nothing pushed (AC3) | `both-changed` + overridden map | Section text matches marker format (research R4); fake-port call log shows zero `updateIssue` |
| 1.4 | Section still has markers ⇒ frozen: skipped, reported, byte-stable across N runs (AC4) | `unresolved-block` | Decision `skip-unresolved`; property test: markers byte-for-byte over arbitrary intervening runs (SC-004); nested-marker write refused |
| 1.5 | Checkbox newly checked, description unchanged ⇒ done state; unchecked ⇒ backlog; independent of conflict machinery (AC5) | `completion-toggle` | `checkbox-changed` event + `update-issue(stateTypeId)`; no description conflict recorded (FR-006) |
| 1.6 | `prefer-newer` with indeterminable recency ⇒ report-only (AC6) | matrix cells | Degradation rule, matrix §3: `both-changed` and non-advancing-`updatedAt` cases ⇒ `report-only` |
| 1.7 | All 6 actions × 3 types × 2 modes exercised (SC-004) | `engine-conflict-matrix` | 36 table-driven cells pass, incl. `fail` ⇒ abort-before-next-mutation with applied steps still rollback-able |

## User Story 2 — Gated apply, durable state, resumable rollback (P2)

| # | Scenario (spec AC) | Fixture world / injector | Verify |
|---|---|---|---|
| 2.1 | Full apply: parent-before-child, siblings reverse, screening, payload rewrite, one event per affecting action, task lines rewritten (AC1) | `rollback-full` (pre-rollback) | Op order asserted from fake call log (`engine-apply-creates`); attachment page-0 payload authoritative (FR-008); task line carries issue ref + title |
| 2.2 | Create errors, identity count ≠ 1 ⇒ indeterminate; task creation aborts; never replayed (AC2) | `indeterminate-create` + scripted create failure | Intent transitions per data-model §8; zero replay calls in-run and on resume (FR-012) |
| 2.3 | Rollback restores files/fields/checkpoints, archives created issues, zero history loss (AC3/AC5) | `rollback-full` | Assertions per journal-rollback.md §4 (SC-003): byte-equal restores, `archived===true`, event count +1 `rollback` event, pages retained |
| 2.4 | Interrupt rollback at **each** step; resume without repeating; corrupt a step ⇒ conflict-halt (AC4) | `rollback-interrupted` + interruption injector at every step index | Per-step resume idempotence; corrupted-state cell ⇒ `conflict-halted` + `status "partial"` (FR-014) |
| 2.5 | History grows past entry/size threshold ⇒ rollover preserving every entry (AC6) | `history-rollover` | Deterministic continuation pages via `getAttachmentByUrl` walk; no entry lost/edited (FR-010) |
| 2.6 | Attachment ops journaled w/ target issue, URL, prior metadata; URL idempotency ⇒ resumed applies never duplicate (FR-015) | re-run/resume over `rollback-full` | Manifest `operations` completeness; byte-identical attachment pages after resumed apply |

## Gate & refusal checks (contract tier)

Via the fake and temp state store, assert the frozen refusal vocabulary
(`src/gates` codes; engine-pipeline.md apply order):

- `APPLY_FLAG_MISSING`, `CONFIRMATION_KEY_MISMATCH`, `LOW_CONFIDENCE_NOT_ACCEPTED` —
  all failures listed together; no lock acquired, no reads-mutated.
- `PLAN_REFERENCE_UNKNOWN` / `PLAN_REFERENCE_STALE` — frozen `validatePlanReference`
  re-run at apply start; drift ⇒ zero mutations.
- `LOCK_HELD` — concurrent apply loses (`engine-lock-contention`).
- `MANIFEST_UNJOURNALED` (journaling off) and `MANIFEST_EXPIRED` (clock advanced past
  `manifestExpiryDays`) — `rollbackRun` refuses; envelope tamper refuses with no plaintext.

## Security & determinism checks

- **Screening aborts propagation**: world with a secret-shaped string in one task section ⇒
  that task's content never appears in fake-port call log or reports; other tasks still
  sync; finding category named, content never echoed (contract `engine-screening` +
  sentinel security test).
- **Apply-twice convergence** (SC-001): second `buildSyncPlan` reports zero pending
  changes; second apply performs zero tracker writes (property test, seeded worlds).
- **Report conformance**: every plan/run `report.json` validates against
  `specs/002-core-domain-contracts/contracts/plan-report.schema.json`; report markdown
  contains no raw bodies/descriptions.
- **Hygiene/packaging**: `engine-hygiene` (zero org literals/fixtures placeholders only),
  `engine-no-direct-tracker` (no transport imports in `src/engine`), `engine-packaging`
  (`task-linear-sync/engine` resolves via exports).

## End-to-end walkthrough (e2e tier)

`tests/e2e/engine-user-stories.test.ts` chains: bootstrap apply on a fresh fixture repo →
mutate spec side / fake-world issue side → `buildSyncPlan` → conflict cells per matrix →
`applySyncPlan` (gates satisfied) → checkpoints + history pages verified → `rollbackRun` →
SC-003 assertions → resolve markers by hand → next run classifies normally. This is the
one runnable scenario proving the feature end-to-end per its Independent Test statement.

## FR → artifact traceability

| FR | Contract / data-model section | Test file(s) |
|---|---|---|
| FR-001 mode+maps | data-model §2 | `unit/engine-mode`, `integration/engine-bootstrap` |
| FR-002 classification | data-model §3; matrix §1 | `unit/engine-classify`, `integration/engine-conflict-matrix` |
| FR-003 six actions | matrix §2–3 | `unit/engine-actions`, `integration/engine-conflict-matrix` |
| FR-004 default maps | matrix §1 | `unit/engine-actions` (built-in exports) |
| FR-005 reasons | matrix §2; pipeline stage 5 | `contract/engine-plan-report-schema` |
| FR-006 completion | data-model §6 | `unit/engine-completion`, `integration/engine-completion-states` |
| FR-007 frozen block | matrix §4 | `integration/engine-conflict-matrix` (1.4), property SC-004 |
| FR-008 payload rewrite | history-log §1 | `integration/engine-attachment-state` |
| FR-009 history append | history-log §2 | `integration/engine-attachment-state`, `unit/engine-history-rollover` |
| FR-010 rollover | history-log §3 | `unit/engine-history-rollover`, scenario 2.5 |
| FR-011 create order | pipeline apply stage | `integration/engine-apply-creates` |
| FR-012 indeterminate create | data-model §8 | `integration/engine-apply-creates` (2.2) |
| FR-013 rollback restore | journal-rollback §3 | `integration/engine-rollback` |
| FR-014 resumable rollback | journal-rollback §3 | `integration/engine-rollback` (2.4 matrix) |
| FR-015 attachment journaling + idempotency | journal-rollback §1; history-log §4 | `integration/engine-rollback` (2.6) |
| FR-016 history/identity preserved | history-log §4; journal-rollback §4 | `integration/engine-rollback` (2.3) |
| SC-001/002/003/004 | quickstart §Security; matrix §4/§6 | property suites above |
