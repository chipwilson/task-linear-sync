# Quickstart: Spec Kitty Sub-Task Depth & Front-Matter Fidelity

**Feature**: `specs/023-spec-kitty-subtask-depth` — validation guide for FR-001…FR-016 /
SC-001…SC-007. Data shapes: [data-model.md](./data-model.md); rules:
[contracts/spec-kitty-subtask-status.md](./contracts/spec-kitty-subtask-status.md).

## Prerequisites

- Node.js ≥ 20; `npm ci` (zero runtime deps; dev: `typescript`, `eslint`).
- No Linear credentials anywhere — every scenario runs against the fake `Linear_Port` or the
  read-only CLI lanes; hermetic fixtures only (constitution VI).

## Test commands

```bash
npm run build                     # tsc strict
node scripts/run-tests.mjs unit           # pure modules: status.ts, document subtask derivation, config validation
node scripts/run-tests.mjs contract       # frozen-surface regeneration + discovery-surface whitelist + report schema
node scripts/run-tests.mjs integration    # engine worlds w/ fake Linear_Port
node scripts/run-tests.mjs e2e            # CLI lanes + reference-repo reproduction
node scripts/run-tests.mjs                # full pyramid + coverage threshold (must stay green: SC-006 pins)
```

## Validation scenarios

### 1. Reference-repo reproduction — flat default (SC-001/SC-002/SC-007, FR-016)

World: `tests/fixtures/e2e` reproduction (research R8): three missions (`042-auth-system`,
`auth-system-01KQ2VNJ`, bare slug) with full artifact sets, per-WP artifact sub-folders whose
`review-cycle-1.md` duplicates the canonical `work_package_id`, `tasks/README.md`, block-list
`subtasks:` rosters, `### Subtask Tnnn – Title` anchors with Activity-Log restatements, and
`status.events.jsonl` with mixed line shapes.

```bash
node scripts/run-tests.mjs e2e --grep "spec-kitty 023 reference reproduction"
```

Expected: plan builds with **zero collision refusals** (SC-007); at stock config
(`maxTaskIssueDepth` absent → 1): task count = canonical WP-document count exactly; zero
parented entries; artifact files, roll-ups, `wps.yaml`, both status files contribute 0 tasks;
100% of tasks carry non-empty detail content; a second plan is byte-identical (no-op).

### 2. Two-level board (SC-001, FR-002/FR-005/FR-011)

World: `spec-kitty-two-level` — mission with `WP01` (4 anchors) and `WP02` (3 anchors), config
`maxTaskIssueDepth: 2`.

```bash
node scripts/run-tests.mjs integration --grep "spec-kitty-two-level"
```

Expected: 2 parent + 7 child entries; each child's `CreateIssueInput.parentId` = its WP issue
(parent-before-child `emissionOrder`); child content = its section incl. step guidance; parent
descriptions contain NO promoted section text (promotedRanges sliced) but keep restated
Activity-Log sections; roster-only id `T099` excluded (`subtask-no-anchor`) with no empty issue.

### 3. Event-log status authority (SC-003, FR-007)

World: `spec-kitty-event-status` — `status.events.jsonl` mixes envelope events, annotations,
one malformed line, and lane transitions ending `WP02 → in_progress`; `status.json` and the
`WP02` front matter deliberately say `planned`; teams configure
`workflowStates.lanes: { in_progress: "Doing", done: "Done" }`; seeded issue for `WP02` sits
in `Backlog`; `WP01` has no events; `WP03`'s last lane is `canceled` (unmapped in config).

```bash
node scripts/run-tests.mjs integration --grep "spec-kitty-event-status"
```

Expected: only `WP02` plans a state change (`state` field, label `lane:in_progress`) →
`updateIssue` patch carries `Doing`'s state id, history event `"lane-changed"`; `WP01` state
untouched; `WP03` untouched + `lane-state-unmapped` reported; malformed log line counted in one
finding; descriptions unchanged (no status text, no `---` block); re-run with unchanged inputs
is a no-op (live state now matches); read-only lanes (plan/check/inventory) issue zero
mutations and never read status files outside plan build.

### 4. Cap toggle convergence (FR-010, SC-005)

Same two-level world: apply at depth 2, then reconfigure to 1, re-plan + apply.

Expected: children fold verbatim into parents (byte-equal to scenario 1 bodies); the seven
former child issues appear in `unmappedIssues` (stale/leftover reporting); zero archives,
zero deletions; returning to depth 2 re-matches children via durable anchors (no re-create).

### 5. Collision & refusal pins (C2.6; 022 posture retained)

Unit/integration probes: duplicate `T004` anchors inside the anchor region →
`DocumentIdentityCollisionError` naming both files in deterministic order; duplicate canonical
`WP01` direct-child files → refusal unchanged; canonical file + its artifact sub-folder →
**no** refusal (FR-015 proof).

### 6. No-drift and opt-out pins (FR-013, SC-006)

```bash
node scripts/run-tests.mjs contract integration --grep "byte|fall-through"
```

Expected: other six identities' discovery/parse/plan fixtures byte-identical; disabling
`spec-kitty` restores pre-017 `generic` fall-through for `kitty-specs/` files.

### 7. Manual rehearsal (optional, read-only)

Against a real Spec Kitty repo (no credentials required beyond a placeholder token; no
mutations, no requests issued):

```bash
LINEAR_ACCESS_TOKEN=lin_api_placeholder node dist/cli/main.js inventory /path/to/kitty-specs-repo
```

Expected: one row per claimed file; `tasks=1` only on canonical WP documents; `tasks=0` on
roll-ups, artifacts, sub-folder review files, and status files.

## Definition of done for this feature

All seven scenarios green in the full pyramid; amendment artifacts A-023-0…4 landed together
per the three-artifact rule with `docs/contract-amendments.md` + supersession ledger updated;
documentation set (README row/section, framework-adapters, configuration reference, requirements
ledger Requirement 7, CHANGELOG v0.7.0) passes the consistency suite (FR-014/C9).
