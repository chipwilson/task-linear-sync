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
   node <repo>/dist/cli/main.js inventory .
   ```

   The CLI reads its configuration from `<repo>/task-linear-sync.json` (minimal
   `teams` / `defaultTeamKey` / `defaultProject` / `confirmationKey`) and refuses to
   start unless the credential environment variable (`LINEAR_ACCESS_TOKEN`) is set —
   the read-only lanes still issue **zero** tracker requests.

   **Expect** (C2.1–C2.5, SC-001/SC-002): exactly one discovered file
   `kitty-specs/001-demo/tasks.md` claimed as framework `spec-kitty`, feature name
   `001-demo`; the `tasks/WP01-scaffold.md` prompt file and `spec.md` absent.

4. **Plan (read-only)**:

   ```sh
   node <repo>/dist/cli/main.js plan .
   ```

   The raw CLI `plan` lane fetches team metadata from the tracker, so the
   zero-credential walkthrough runs this and the following steps on the fake
   `Linear_Port` CLI lane (`buildCliWorld` + `runCli`, as in
   `tests/integration/engine-spec-kitty-world.test.ts`).

   **Expect**: exactly **four** tasks — ids `T001`–`T004`; the `Inputs` checkbox excluded
   (summary section); `T003`/`T004` grouped under `WP02: Payments`, `T001`/`T002` under
   `WP01: Scaffold` (parse-level `Task.phase` grouping — the frozen plan/report shape
   buckets milestones by feature name, so the report shows one `001-demo` group);
   derived titles free of both the `Txxx` span and the `[P]`/`[USn]` tags (e.g.
   `Add payouts`) (C3.1–C3.6); no dependency edges anywhere in the plan (C3.7).

5. **Idempotence probe**: re-run step 4 — identical plan bytes (Principle IV). After a
   synced apply — `sync <repo> --plan <planId> --apply --confirm SYNC
   --accept-low-confidence` (bootstrap tasks have `unmatched` match confidence, so a
   first apply without the acceptance flag is refused with `LOW_CONFIDENCE_NOT_ACCEPTED`)
   — a second `plan` yields **zero** create/update actions (US1-AC4).

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

## Walkthrough execution record (T024, 2026-11-10)

Executed end-to-end on branch `017-spec-kitty-adapter` @ the T023 full-gate build
(1693 pass / 0 fail). Read-only steps ran with the raw CLI (`node dist/cli/main.js`,
scratch repo `kitty-specs/001-demo/` laid out exactly as in steps 1–2 above); the
plan/apply/drift steps ran on the fake `Linear_Port` CLI lane (`buildCliWorld` +
`runCli`, fixed clock, zero network) because the raw `plan` lane fetches team
metadata from a real tracker. **All steps passed.**

| Step | Result | Observed |
|---|---|---|
| 3 inventory | PASS | `kitty-specs/001-demo/tasks.md framework=spec-kitty tasks=4`; `spec.md` and `tasks/WP01-scaffold.md` not discovered (raw CLI exit 0) |
| 4 plan | PASS | 4 entries `T001`–`T004`, all `decision=create`, `framework=spec-kitty`, feature `001-demo`; `Inputs` checkbox excluded (`summary-section`); parse-level `phase` = `WP01: Scaffold` / `WP02: Payments`; plan JSON contains no dependency text; issue titles created tag-free (`Add payouts`, `List transactions`) |
| 5 idempotence + apply + re-plan | PASS | re-plan byte-identical (`plan.json`/`report.json` sha256 equal, same planId); apply → `operations: 4 applied, 0 skipped, 0 failed`, 4 `createIssue` calls; second `plan` → 4 entries, 0 pending create/update |
| 6 drift probe | PASS | insert `T005` + swap the two WP sections → plan decision counts `{"no-change":4,"create":1}` (exactly one create, zero changed identity/match fields); apply → `1 applied, 4 skipped`; landed file differs from the user's edited file **only** by the `[SYNC-1005]` prefix insertion; `[P]`/`[US1]` tags and `## Dependencies` prose verbatim |
| 7 opt-out (FR-011) | PASS | `frameworkAdapters` without `spec-kitty` → inventory reports the roll-up as `framework=generic` (positional ids, no mission name) |

Notes recorded while executing (doc fixes applied above; behavior verified correct):

1. The manual steps' CLI entry point is `dist/cli/main.js` (bin `task-linear-sync`);
   `dist/cli/index.js` is the import-only library entry and exits silently.
2. The raw CLI refuses to start when `LINEAR_ACCESS_TOKEN` is unset — even for the
   zero-request `inventory` lane (set any value for read-only probes); `plan` needs a
   live tracker for team metadata, hence the fake-port lane here.
3. Bootstrap applies require `--accept-low-confidence` (unmatched bootstrap matches hit
   the standard low-confidence gate first, exit 4 — correct refusal, then accepted).
4. Report milestone grouping buckets by feature name (`001-demo`); work-package
   grouping is the parse-layer `Task.phase` field (frozen plan shape carries no phase
   field).
