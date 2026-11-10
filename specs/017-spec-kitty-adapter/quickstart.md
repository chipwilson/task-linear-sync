# Quickstart: Validating the Spec Kitty Adapter

**Feature**: `017-spec-kitty-adapter`
Behavioral rules referenced here: [contracts/spec-kitty-adapter.md](./contracts/spec-kitty-adapter.md) (C-rules), field mappings in [data-model.md](./data-model.md).

## Prerequisites

- Node.js ≥ 20.0.0, npm with the locked `package-lock.json`
- No Linear credentials, no network: every validation below runs on the fake
  `Linear_Port` or read-only CLI lanes (constitution Principle I/VI, hermetic pipelines)

```sh
npm ci
npm run build && npm run compile:tests
```

## Automated validation (maps to the spec's success criteria)

| Command | Validates |
|---|---|
| `node --test build/tests/unit/discovery-adapters-spec-kitty.test.js build/tests/unit/discovery-selection.test.js` | C1.1, C2.1–C2.3, precedence row (R1/R2) |
| `node --test build/tests/unit/parsing-spec-kitty.test.js` | C3.1–C3.8 on the roll-up grammar, ids, tags, sections, front matter (SC-002/SC-003) |
| `node --test build/tests/integration/discovery-spec-kitty.test.js` | SC-001: fixture repo with two missions plans 100% roll-ups as `spec-kitty`, 0 non-mission files claimed, zero configuration |
| `node --test build/tests/integration/parsing-corpus.test.js` | corpus row `frameworks/spec-kitty/tasks.md`: task set equals the checkbox-subtask set exactly, every task's `localTaskId` equals its printed `Txxx` (SC-002) |
| `node --test build/tests/integration/sync-spec-kitty-drift.test.js` | SC-004 / US3: insert one subtask + swap two work packages → exactly 1 create, 0 identity/match changes for all others |
| `node --test build/tests/unit/agent-hooks.test.js` | C1.3: scaffold request for `spec-kitty` refuses with zero writes (FR-012) |
| `node --test build/tests/contract/framework-support-consistency.test.js build/tests/contract/discovery-surface.test.js build/tests/contract/frozen-surface.test.js` | C6: README ⇄ requirements ⇄ registry enumerate six identities; fabricated-name pin narrowed; snapshots regenerated via amendment 1 |
| `npm test` | SC-005: full pyramid green; parameterized plan/apply/rollback/check/CI suites pick the sixth id up automatically; zero behavior change for the existing five |

## Manual end-to-end walkthrough (zero configuration)

1. **Scratch repository** — create a directory with the canonical layout:

   ```text
   kitty-specs/001-demo/
   ├── spec.md                      # mission docs, no task-file role
   └── tasks.md                     # roll-up (contents in step 2)
   kitty-specs/001-demo/tasks/
   └── WP01-scaffold.md             # agent-prompt file — must never be discovered
   ```

2. **Roll-up fixture** (`kitty-specs/001-demo/tasks.md`):

   ```markdown
   ---
   mission: 001-demo
   ---

   # 001-demo — Tasks

   ## Inputs
   - [ ] this illustrative checkbox must NOT become a task

   ## Work Package WP01: Scaffold
   - [ ] T001 Create the scaffold
   - [ ] T002 Implement charging

   ## Work Package WP02: Payments
   - [ ] T003 [P] Add payouts
   - [ ] T004 [US1] List transactions

   ## Dependencies
   T003 depends on T001.

   ## Risks & Mitigations
   - Keep tag rendering stable.
   ```

3. **Discover (read-only)** — from the scratch repo root:

   ```sh
   node <repo>/dist/cli/index.js inventory .
   ```

   **Expect** (C2.1–C2.5, SC-001/SC-002): exactly one discovered file
   `kitty-specs/001-demo/tasks.md` claimed as framework `spec-kitty`, feature name
   `001-demo`; the `tasks/WP01-scaffold.md` prompt file and `spec.md` absent.

4. **Plan (read-only)**:

   ```sh
   node <repo>/dist/cli/index.js plan .
   ```

   **Expect**: exactly **four** tasks — ids `T001`–`T004`; the `Inputs` checkbox excluded
   (summary section); `T003`/`T004` grouped under `WP02: Payments`, `T001`/`T002` under
   `WP01: Scaffold`; derived titles free of both the `Txxx` span and the `[P]`/`[USn]`
   tags (e.g. `Add payouts`) (C3.1–C3.6); no dependency edges anywhere in the plan (C3.7).

5. **Idempotence probe**: re-run step 4 — identical plan bytes (Principle IV). After a
   synced apply (fake or real tracker), a second `plan` yields **zero** create/update
   actions (US1-AC4).

6. **Drift probe (SC-004)**: insert `- [ ] T005 Sync ledger` between `T002` and `T003`,
   swap the two `## Work Package` sections, re-run `plan`. **Expect**: one create (`T005`),
   grouping-only changes for the rest, zero identity or match changes (C4.2). Round-trip:
   the repository file is byte-identical apart from visible `[<KEY>-N]` prefixes; `[P]`
   tags and the `## Dependencies` prose survive verbatim (C3.5, C3.8).

7. **Opt-out (FR-011)**: with `spec-kitty` removed from the `frameworkAdapters` config
   list, re-run step 3 — files fall back to `generic` exactly as before this feature
   (positional ids, no mission name), proving the disable path.

## Contract-amendment validation

```sh
UPDATE_FROZEN_SNAPSHOT=1 npm run test:contract   # regenerate after the union widening
npm run test:contract                            # drift suite green afterwards
```

Confirm `docs/contract-amendments.md` carries all three entries and
`specs/002-core-domain-contracts/contracts/task-model.md` mirrors the widened union (C6.3).
