# Quickstart: Validating the Spec Kitty Work-Package Task Source

**Feature**: `022-spec-kitty-wp-tasks`
Behavioral rules referenced here: [contracts/spec-kitty-work-packages.md](./contracts/spec-kitty-work-packages.md) (C-rules), field mappings and decision tables in [data-model.md](./data-model.md).

## Prerequisites

- Node.js ≥ 20.0.0, npm with the locked `package-lock.json`
- No Linear credentials, no network, no upstream clone: every validation runs on the fake
  `Linear_Port`, read-only CLI lanes, or hermetic fixtures reproducing the upstream layout
  (constitution Principle I/VI, hermetic pipelines)

```sh
npm ci
npm run build && npm run compile:tests
```

## Automated validation (maps to the spec's success criteria)

| Command | Validates |
|---|---|
| `node --test build/tests/unit/parsing-document.test.js build/tests/unit/parsing-spec-kitty.test.js` | C2.1–C2.2 recognition table (data-model §2), C3 title cascade + content-minus-front-matter, roll-up zero tasks, front-matter-only + no-title edge cases (SC-002) |
| `node --test build/tests/unit/discovery-traverse.test.js build/tests/unit/discovery-adapters-spec-kitty.test.js build/tests/unit/discovery-selection.test.js` | A-022-1 path patterns (`*`/`**` segment semantics), collection descent, disjointness, disable-restores-pre-017 (C1.1–C1.4, FR-013) |
| `node --test build/tests/integration/discovery-spec-kitty.test.js` | SC-001/FR-009: upstream-reproduction fixture — per mission, plan task count = WP-document count, zero tasks from `tasks.md`, zero configuration |
| `node --test build/tests/integration/parsing-corpus.test.js` | corpus `frameworks/spec-kitty/`: roll-up yields the empty task set; each `WPnn-*.md` yields exactly one `kind: "document"` task with `localTaskId = WPnn` and content containing its Objectives + `Tnnn` guidance (C3.2, SC-002) |
| `node --test build/tests/unit/engine-spec-kitty.test.js` | C2.4: duplicate `WP01` in one mission → plan-build refusal listing both paths, deterministically ordered; no plan, no guess |
| `node --test build/tests/unit/matching-document-kind.test.js` | C5.1 durable-only pairing; title-contained roll-up-era candidate scores no pairing onto a WP task (FR-011) |
| `node --test build/tests/integration/sync-spec-kitty-lifecycle.test.js` | SC-003/FR-010/US3: lane flip + activity append + review-report append + in-collection rename → **0 creates**, existing task updated, two missions' `WP01` stay two distinct tasks |
| `node --test build/tests/integration/sync-spec-kitty-rollup-leftovers.test.js` | SC-004/US2: tracker seeded with roll-up-line issues → all reported stale/unmatched, zero pairings; plan contains only WP tasks |
| `node --test build/tests/unit/agent-hooks.test.js` | 017 C1.3 retained: scaffold requests for `spec-kitty` still refuse with zero writes |
| `node --test build/tests/contract/framework-support-consistency.test.js build/tests/contract/doc-truthfulness.test.js build/tests/contract/discovery-surface.test.js build/tests/contract/frozen-surface.test.js build/tests/contract/adapter-contract.test.js` | C8: README ⇄ docs ⇄ requirements enumerate the corrected model (pins re-based, not relaxed); `TaskKind` union + `documentTaskRule`/`taskPathPatterns` whitelist snapshots regenerated per A-022-0/2 |
| `npm test` | SC-005: full pyramid green; the other six identities' discovery/parse/plan fixtures byte-identical; parameterized plan/apply/rollback/check/CI suites unaffected |

## Manual end-to-end walkthrough (zero configuration)

1. **Scratch repository** — canonical upstream-style layout:

   ```text
   kitty-specs/001-demo/
   ├── spec.md                       # not a candidate (unchanged)
   ├── tasks.md                      # roll-up — dozens of checkbox lines, 0 tasks
   ├── tasks/
   │   ├── WP01-scaffold.md          # full WP document (front matter title + T001/T002)
   │   └── notes.md                  # fails recognition — claimed, 0 tasks
   kitty-specs/002-legacy/
   ├── tasks.md
   └── tasks/
       └── planned/
           └── WP01-billing.md       # legacy lane sub-folder — recognized by file name
   kitty-specs/003-plan-only/
   └── tasks.md                      # no collection at all — 0 tasks, not an error
   ```

2. **Work-package fixture** (`tasks/WP01-scaffold.md`): YAML front matter
   (`work_package_id: WP01`, `title: Scaffold`, `lane: planned`) then
   `# WP01 — Scaffold`, `## Objectives & Success Criteria`, `## Context & Constraints`,
   `T001`/`T002` step guidance, `## Test Strategy`, `## Definition of Done` checkboxes,
   `## Activity Log`. The roll-up lists `- [ ] T001 …` lines that must produce **nothing**.

3. **Discover (read-only)** — from the scratch repo root:

   ```sh
   node <repo>/dist/cli/main.js inventory .
   ```

   (Raw CLI needs `LINEAR_ACCESS_TOKEN` set to any value to start; read-only lanes issue
   zero tracker requests — 017 walkthrough note 2 still applies.)

   **Expect** (C0.2, C1.2, C2.1–C2.2): discovered files include `tasks/WP01-scaffold.md`,
   `tasks/notes.md`, `tasks/planned/WP01-billing.md`, and both roll-ups — all framework
   `spec-kitty`, feature names `001-demo`/`002-legacy`/`003-plan-only` (never `tasks`);
   `spec.md` absent; `001-demo` shows `tasks=1`.

4. **Plan (read-only)** on the fake `Linear_Port` CLI lane (`buildCliWorld` + `runCli`,
   as in `tests/integration/engine-spec-kitty-world.test.ts`):

   **Expect** (C2.3, C3, C6.1): exactly **two** entries — one per mission with a
   collection; titles `Scaffold` (front matter) and `billing`-cascade per fixture;
   content = document minus front matter including `T001`/`T002` guidance and DoD
   checkboxes verbatim; `expectedMarkdownChanges` empty everywhere; no roll-up-line task;
   no dependency edges (017 C3.7 stance).

5. **Idempotence + lifecycle probe** (SC-003, C4.2): apply the plan
   (`sync <repo> --plan <planId> --apply --confirm SYNC --accept-low-confidence` —
   bootstrap matches hit the standard low-confidence gate first), then in the repo flip
   `lane:`, append Activity Log lines and a `## Review Report` section, and rename
   `WP01-scaffold.md` → `WP01-scaffold-tooling.md`. Re-plan.
   **Expect**: `decision` counts `{"create":0,"update":1,"no-change":1}` (update on the
   content change only), zero new issues, zero identity/match changes; the landed files
   are **byte-identical** to the user's edited files (no `[KEY-N]` insertion — C6.1); a
   further re-plan after content settles is a full no-op (FR-010).

6. **Leftovers probe** (SC-004, C5.2): on a fresh fake-port world, first seed issues whose
   recorded identity matches the roll-up-line model of the scratch repo (simulate a
   pre-022 sync), then re-plan with the corrected model.
   **Expect**: plan proposes only WP tasks; every seeded roll-up issue appears in the
   stale/unmapped reporting; zero of them are matched; the WP task `Scaffold` — whose title
   is contained in a seeded line's title — is not paired to it (durable-only veto).

7. **Collision probe** (C2.4): add `tasks/WP01-duplicate.md` claiming the same mission's
   `WP01`. **Expect**: plan refuses with an integrity finding naming the mission, `WP01`,
   and both paths sorted; exit without a plan; removing one file restores a clean plan.

8. **Opt-out (FR-013)**: with `spec-kitty` removed from `frameworkAdapters`, re-run step 3
   — `kitty-specs/` files fall back to `generic` exactly as pre-017 (positional ids, no
   mission name, `tasks/` descent governed only by generic's basename patterns).

## Contract-amendment validation

```sh
UPDATE_FROZEN_SNAPSHOT=1 npm run test:contract   # regenerate after A-022-0 (TaskKind)
npm run test:contract                            # drift suite green afterwards
```

Confirm `docs/contract-amendments.md` carries A-022-0…A-022-4 plus the 017 supersession
note, and `specs/002-core-domain-contracts/contracts/task-model.md` mirrors the widened
`TaskKind` union (C8.3).
