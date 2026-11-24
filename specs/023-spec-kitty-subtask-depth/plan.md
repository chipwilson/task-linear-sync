# Implementation Plan: Spec Kitty Sub-Task Depth & Front-Matter Fidelity

**Branch**: `023-spec-kitty-subtask-depth` | **Date**: 2026-11-24 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/023-spec-kitty-subtask-depth/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command; its definition describes the execution workflow.

## Summary

Raise the `spec-kitty` identity from a one-level model (one work-package document = one task)
to Spec Kitty's real two-level model: work packages stay depth level 1 (exactly one issue,
never parented), and `Tnnn` subtasks become depth level 2 — folded verbatim into the parent at
`maxTaskIssueDepth: 1` (the built-in default, matching today's behavior) and promoted to
Linear sub-issues of the work-package issue at depths ≥ 2, reusing the 020 folding machinery,
the frozen 3-part `taskStableSeed`, and the existing parent-before-child apply order. Three
corrections ride along, all measured against the upstream reference repository: canonical
work-package recognition is narrowed to direct children of the mission `tasks/` folder (plus
the legacy lane sub-folder variant) so per-work-package review artifacts stamped with a
duplicated `work_package_id` can never create issues or trigger the duplicate-id refusal
(FR-015 — the reference repo is currently unplannable); the mission's append-only
`status.events.jsonl` becomes the SOLE status authority, moving each work-package issue to the
team-mapped workflow state of its last lane event (FR-007; `status.json` and front-matter
`lane` are never state sources; unmapped lanes leave state untouched and are reported); and
the work-package-per-issue granularity contract is pinned (FR-016) — the depth cap folds
nesting, never board volume.

## Technical Context

**Language/Version**: TypeScript 5.x, strict, ES2022 modules (NodeNext); Node.js engine ≥ 20.0.0

**Primary Dependencies**: zero runtime dependencies (Node built-ins only); the status-event
scan is a per-line `JSON.parse` with skip-and-report on malformed lines — no JSONL library, no
YAML library (front-matter roster scan stays a leading-fence line parser, extended to
single-level `subtasks` lists)

**Storage**: N/A for this feature — status events and subtask anchors are pure over file
content; tracker state rides the existing `IssueUpdatePatch.stateTypeId` path; run state and
attachments unchanged

**Testing**: `node:test` via `scripts/run-tests.mjs` (tiers: unit / contract / integration /
e2e); fake `Linear_Port` for integration (zero real Linear requests); engine worlds under
`tests/fixtures/engine/worlds/` (new: artifact sub-folders, two-level document board,
event-log status); parsing corpus under `tests/fixtures/parsing/frameworks/spec-kitty/`

**Target Platform**: standalone npm package (ESM library + CLI binary), Linux/macOS/Windows
CI on GitHub Actions

**Project Type**: library + cli (single package; touches `src/discovery`, `src/parsing`,
`src/domain`, `src/matching` (inheritance only), `src/engine`, docs, and tests)

**Performance Goals**: unchanged order of magnitude — one extra pure scan per mission
(`status.events.jsonl`, O(lines), only when the file exists); subtask extraction piggybacks on
the existing single front-matter scan + one line pass per document; no additional walks or
tracker calls (lane state resolves through the already-captured `discoverMetadata` snapshot)

**Constraints**: zero new runtime deps; zero new REQUIRED config (lane→state is per-team
routing data with no built-in default — unmapped lanes are untouched+reported, mirroring the
`completion.ts` no-default posture); org-specific literal ban; frozen-contract amendments only
via the `docs/contract-amendments.md` three-artifact rule; byte-for-byte determinism
(file-order event authority, deterministic finding order); no write-back to any Spec Kitty
file (status lives in tracker state, never in mirrored text); zero behavior change for the
other six built-in identities (FR-013/SC-006)

**Scale/Scope**: one existing identity, two new pure modules + engine enrichment — ~12 changed
source files, 2 new modules (`src/parsing/status.ts`, subtask derivation in
`src/parsing/document.ts`), 1 new + 4 amended contract documents, 3 new engine worlds + 1
parsing-corpus rework, ~10 new/updated test files, README + configuration-reference +
framework-adapters + requirements + CHANGELOG updates

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Verdict | Notes |
|---|---|---|
| I. Safety First | PASS | Status files are READ-only inputs consumed inside plan build; state mutations flow only through the existing apply gates (apply flag, confirmation key, plan-reference stability guards) and the `Linear_Port` patch path; lane values are validated against the nine-lane vocabulary before any reporting, and every finding string passes the `Security_Screener` like existing diagnostics |
| II. Durable Identity | PASS | Child seed uses the FROZEN `taskStableSeed` layout — `spec-kitty \| <mission> \| <WP id>\0<subtask id>` — composed per the existing `composeSeedLocalTaskId` NUL-join precedent; anchor stays the `Attachment_Metadata` UUID; duplicate subtask anchors inside the anchor region collapse to an identical seed and are refused by the EXISTING document-kind collision guard (no new identity channel) |
| III. Intelligent Defaults, Overridable Config | PASS | Subtask recognition (`subtaskRule` members), collection gate, and status-event file name ship as built-in row defaults overridable through the existing merge; lane→state mapping is per-team routing data intentionally WITHOUT built-in default (same class as `workflowStates` — consumer-required where generic defaults are meaningless); zero new required config; zero org literals |
| IV. Determinism & Idempotency | PASS | Event authority = last qualifying line in file order (append-only log); folded-vs-promoted is a pure function of `maxTaskIssueDepth`; repeated syncs with no repository change remain no-ops (state-drift check compares the live snapshot before proposing a patch); the mirror-region hole-slice is applied ONLY to `kind === "document"` tasks with promoted ranges, so every other kind renders byte-identically (SC-006) |
| V. One Engine, Additive Surfaces | PASS | Promotion, parenting, stale/leftover reporting, and state patching all ride existing engine paths (`emissionOrder`, `resolvedParentIssueId`, `unmappedIssues`, `IssueUpdatePatch.stateTypeId`); no surface gains a divergent path; status derivation lives in the engine core, not the CLI |
| VI. Test-First & Quality Gates | PASS | Every FR/SC maps to a suite in `quickstart.md`; three new worlds pin the artifact-inertness, two-level, and event-log-status behaviors; the reference-repository reproduction world proves zero-collision plannability (SC-007); other six identities' fixtures re-pinned byte-identical |

**Amendment inventory (governance channel, executed test-first in implementation):**

1. **A-023-0 (002 frozen)** — two ADDITIVE domain members: `TaskBodyExtent` gains optional
   `promotedRanges?: ReadonlyArray<readonly [number, number]>` (inclusive line spans mirrored
   OUT of a document task, consumed only by the document-kind mirror slice), and
   `WorkflowStateIdentities` gains optional `lanes?: Readonly<Record<LaneName, string>>`
   (per-team lane→workflow-state-name map; the nine Spec Kitty lane names are the key space).
   Amends `specs/002-core-domain-contracts/contracts/task-model.md` + routing contract,
   regenerated `tests/contract/snapshots/frozen-surface.json`, and `data-model.md` in one
   change. No existing field's seed, payload, or behavior changes.
2. **A-023-1 (003 discovery)** — `FrameworkAdapter` / `AdapterConventions` whitelist gains
   optional `statusEventFileName` (file name sought directly beneath each mission directory,
   built-in `"status.events.jsonl"`); `taskPathPatterns` semantics unchanged (claims stay
   broad so artifact files remain `spec-kitty`-claimed, never `generic`). Amends
   `specs/003-task-discovery-framework-adapters/contracts/framework-adapter.md` +
   `docs/framework-adapters.md`.
3. **A-023-2 (004 parsing)** — `documentTaskRule` gains optional `subtaskRule` (regex SOURCE
   strings: `rosterKey: "subtasks"`, `anchorPattern`, `anchorRegionStopPattern`) and
   `contracts/parsing-api.md` rule 13 widens the document lane to 0-or-N drafts with parent
   links, front-matter single-level list scanning, promoted-range computation, exclusion
   record kind `"subtask"` with reasons `"depth-folded"` / `"subtask-no-anchor"`, and the
   anchor-region stop rule (Activity Log / Review Report restatements are content, never
   anchors). Absent ⇒ every other adapter unchanged and 022's single-document lane intact.
4. **A-023-3 (008 engine)** — document-kind mirror slice skips `promotedRanges`; entry
   assembly gains lane-state drift evaluation beside the completion-state path; a read-only
   status-load step feeds it from `statusEventFileName`; history event `"lane-changed"` added
   (append-only additive kind); `docs/contract-amendments.md` records A-023-0…3 plus the
   supersession of 022 C1.1 (collection pattern), C2 lane-status "content only" stance, and
   the 022 "subtasks are never tasks" assumption by
   `specs/023-spec-kitty-subtask-depth/contracts/spec-kitty-subtask-status.md`.

**Post-design re-check (after Phase 0/1 artifacts): PASS** — `research.md` resolves every
Technical Context question against the as-built repository and the upstream reference
repository's real data shapes (no NEEDS CLARIFICATION remains); `data-model.md` and
`contracts/spec-kitty-subtask-status.md` add no surfaces, gates, or defaults beyond those
checked above; the four amendments are the minimal governance-bearing set (each
rejected-simpler alternative is recorded in `research.md`).

## Project Structure

### Documentation (this feature)

```text
specs/023-spec-kitty-subtask-depth/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/
│   └── spec-kitty-subtask-status.md   # Feature contract (amends 022 C1.1/C2, defines C0–C9)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
src/
├── discovery/
│   ├── adapter.ts                    # +statusEventFileName member (whitelist + descriptor)
│   ├── conventions.ts                # materialize + custom-descriptor pass-through
│   └── adapters/spec-kitty.ts        # narrowed collectionPattern (lane alternation), subtaskRule, status file name
├── domain/
│   ├── task.ts                       # TaskBodyExtent.promotedRanges (additive)
│   └── routing.ts                    # WorkflowStateIdentities.lanes (additive)
├── parsing/
│   ├── document.ts                   # N-draft derivation, roster scan, anchors, promoted ranges, artifact gate
│   ├── status.ts                     # NEW: pure status.events.jsonl → wpId→lane map (file order, skip+report)
│   ├── taskfile.ts                   # document branch: child drafts, parent links, exclusion records (kind "subtask")
│   ├── depth.ts                      # document-subtask depth interplay (fold at cap 1)
│   └── adapter.ts                    # parsing-side whitelist: subtaskRule + status file name pass-through
├── matching/                         # NO code change — children inherit kind "document" durable-only pairing
├── engine/
│   ├── status-load.ts                # NEW: read-only mission status loader (plan build only)
│   ├── build.ts                      # lane-state drift beside completion path; status map injection
│   ├── completion.ts                 # lane-state resolver (resolveWorkflowStateId reuse; no-default posture)
│   └── ops.ts                        # "lane-changed" history event kind
├── config/                           # schema/validation for optional lanes map (lane key space, non-empty names)
└── ports/                            # NO change (stateTypeId patch path reused)

tests/
├── unit/                             # status.ts, document-subtask derivation, anchor-region, config validation
├── contract/                         # frozen-surface regeneration, discovery-surface whitelist
├── integration/                      # 3 new worlds: artifact-inertness, two-level documents, event-log status
├── e2e/                              # reference-repo reproduction (SC-001/SC-007), granularity pin (FR-016)
└── fixtures/
    ├── engine/worlds/spec-kitty-artifact-folders/
    ├── engine/worlds/spec-kitty-two-level/
    └── engine/worlds/spec-kitty-event-status/
```

**Structure Decision**: single package, changes confined to the existing layered pipeline
(discovery → parsing → engine); matching, ports, and CLI need no code changes — pairing and
state patching are inherited behaviors. Status derivation is engine-core (constitution V),
pure modules under `src/parsing/` keep the test-first pyramid cheap (constitution VI).

## Complexity Tracking

> No constitution violations — this section remains empty by design.
