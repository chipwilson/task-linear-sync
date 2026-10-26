# Contract: Conflict Resolution Matrix (normative)

The single normative table behind `src/engine/actions.ts` and the SC-004 test matrix
(6 actions × 3 conflict types × 2 modes ⇒ 36 fixture cells). Shapes: frozen
`DescriptionConflictType` / `ConflictAction` / `ConflictResolutionMap` (002 §6–7).
Classification per data-model §3; this contract pins the **effects**.

## 1. Built-in default maps (FR-004, overridable via frozen config merge)

| mode | `linear-changed` | `spec-changed` | `both-changed` |
|---|---|---|---|
| **bootstrap** | `overwrite-linear` | `overwrite-linear` | `overwrite-linear` |
| **sync** | `overwrite-spec` | `overwrite-linear` | `report-only` |

Bootstrap only ever *observes* `both-changed` or no conflict (FR-002); the full row exists
for override completeness. Each of the three entries per mode overrides independently
(deep-merge chain: built-in ⇒ config file ⇒ programmatic).

## 2. Action effects (FR-003) — applied to the whole tool-managed issue description only

Never to the synced state payload; never partial-section edits.

| Action | Effect on tracker (issue) | Effect on spec file | Journal/payload push | History event |
|---|---|---|---|---|
| `overwrite-linear` | Description := screened rendered task section (`update-issue` op) | untouched (next run's render rewrites task line only) | full payload rewrite (§ history-log) | `description-updated` |
| `overwrite-spec` | **untouched — nothing pushed** | Task's section body replaced by the git-style conflict-marker block embedding **local content then tracker content** (format per research R4; toolId-derived labels, no UUIDs) | file write journaled (`render-file` kind) | `conflict-detected` |
| `report-only` | untouched | untouched | none | `conflict-detected` |
| `skip` | untouched | untouched | none | none — recorded internally only (journal/plan reasons; NOT a report conflict entry) |
| `prefer-newer` | per §3 winner | per §3 winner | winner's side only | winner's event (`description-updated` or `conflict-detected` + marker file write) |
| `fail` | **abort before any further mutation**; run status `aborted`; applied steps remain rollback-able | no further writes | already-applied journal intact | none beyond what already landed |

Every applied action reports **conflict type + action taken + reason** (FR-005) in: plan
entry `reasons`, `OperationOutcome.detail`, run report, and (for conflicts) the
conflict section of plan/report output.

## 3. `prefer-newer` recency rule (spec Assumption; US1 AC6)

| Conflict type | Recency determination | Result |
|---|---|---|
| `spec-changed` | Single-sided by construction: only the spec moved since the checkpoint | spec newer ⇒ `overwrite-linear` effect |
| `linear-changed` with `issue.updatedAt > checkpoint.issueUpdatedAt` | Tracker attests a strictly later update | tracker newer ⇒ `overwrite-spec` effect |
| `linear-changed` with `issue.updatedAt ≤ checkpoint.issueUpdatedAt` | Indeterminable (non-advancing clock, same-instant edit) | **degrade to `report-only`** (`degraded: true`), never guess |
| `both-changed` | No trustworthy spec-side timestamp source exists | **degrade to `report-only`** |

## 4. Frozen unresolved-block rule (FR-007; edge cases)

A task whose `taskBody` region contains a conflict block (004 `scanConflictBlocks` ⇒
`Task.unresolvedConflict`) is **frozen** on every later run that touches it:

- Plan decision `skip-unresolved`; **no** change to the section, **no** issue update,
  nothing pushed, **no** additional or nested markers (an `overwrite-spec` attempt against
  a frozen section is refused outright).
- Exactly one unresolved-conflict report entry per task per run; checkpoint untouched
  (baseline preserved so post-resolution classification compares against the pre-block
  state).
- Byte-for-byte survival across any number of intervening runs (SC-004 property test).
- Human removes the markers ⇒ next run classifies normally against the stored checkpoint.

## 5. Completion-state independence (FR-006)

Checkbox-driven workflow changes (§ data-model §6) are **outside** this matrix: they never
consult or populate `descriptionConflict`, and description actions never move workflow
state. A task may therefore record e.g. `checkbox-changed` history + a state update while
its description classifies `no conflict` (US1 AC5).

## 6. Interaction with convergence invariants

- Actions are selected from *classification*, never from "last action" — with no drift on
  either side the matrix is never consulted (no conflict ⇒ no action ⇒ SC-001 zero-change
  second run).
- Formatting-only drift is invisible to classification (frozen `Description_Normalization_
  Profile` behavior; constitution "Conflict-free sync"), so no action and no rewrite can
  fire (SC-002).
