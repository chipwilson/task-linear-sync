# Contract: `spec-superpower` built-in adapter

**Feature**: `018-spec-superpower-adapter` | **Status**: normative for this feature
**Extends**: `specs/003-task-discovery-framework-adapters/contracts/framework-adapter.md`
(adapter contract, built-in table), `specs/004-task-parsing-line-rendering/contracts/adapter-consumption.md`
(member whitelist), `specs/002-core-domain-contracts/contracts/task-model.md` (identity union).
Amendments carried by this contract are logged in `docs/contract-amendments.md`.

## Rule 1 — Identity and surface

`spec-superpower` is a frozen `FrameworkId` member, present in `BUILT_IN_FRAMEWORK_IDS`,
`builtInAdapters`, `builtInAdapterRows`, and the `frameworkAdapters` default enabled set.
It passes the engine's built-in identity gate and is accepted end-to-end
(discover → parse → match → create → mirror → reconcile → write-back → rollback) under the
same gates as every current built-in; all propagation passes `Security_Screener`
unchanged (FR-001, US2-AC4).

## Rule 2 — Discovery claim

A candidate file is claimed by `spec-superpower` iff its path is beneath the configured
plans root (default `docs/superpowers/plans/`, at any depth) **and** its basename matches
the configured filename convention (default glob
`[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]-*.md`). Detection is path-only — no sibling
markers. Outside the plans root the rule claims nothing (FR-002).

**Amendment A-018-1 (generic-fallback narrowing)** — `selectAdapter`/`discover`:
when zero enabled adapters detect a candidate, the `generic` fallback applies **only** if
the candidate's basename matches the enabled `generic` adapter's effective
`taskFilePatterns`; otherwise the file is unclaimed and omitted from `DiscoveryResult.files`
with no diagnostic required. Consequences: (a) date-named Markdown outside the plans root
never enters the sync; (b) behavior for every pre-existing candidate is unchanged (all
built-in rows share `tasks.md`/`TASKS.md`); (c) a file matching only a custom descriptor's
patterns with failing detection is no longer grabbed by `generic`.
`DEFAULT_PRECEDENCE` = `kiro → open-spec → spec-kit → bmad → spec-superpower → generic`.

## Rule 3 — Feature naming

`Feature_Name` = plan-file basename with a leading `NNNN-NN-NN-` date prefix removed and
the final extension removed (`2026-11-09-auth.md → auth`); with the date prefix absent
(pattern-overridden teams), the extension-stripped basename. Derivation is pure per path
and never fails for a claimed file (FR-003, SC-003; `data-model.md` §2.3).

## Rule 4 — Task grammar

Each heading line matching
`^\s{0,3}#{2,4}\s+(?<id>Task\s+[0-9]+)\s*:\s*(?<title>.+)$`
is exactly one task: `localTaskId` = the `Task N` span, title = the `title` group minus
any visible issue reference. Headings at levels 5–6, the document title, preamble
sections (Goal / Architecture / Tech Stack / Spec reference / Global Constraints / Review
Focus), and any other heading match no grammar and are structure only — never tasks, never
contributors to a task title (FR-004, FR-006, SC-002).

## Rule 5 — Step containment

Every checkbox line (`^\s*[-*+]\s*\[[ xX]\]`) in a claimed file is excluded from
`file.tasks` and recorded in `ParseResult.exclusions` (kind `checklist`, reason `rollup`),
while remaining ordinary body text inside the enclosing task's line extent. Steps are
never tasks and never completion inputs; step state changes are content drift (FR-005,
FR-008, FR-009). A stray pre-task checklist (before any task heading) is excluded the same
way — never silently its own task (edge case). Bodies mirror verbatim, subject to
screening (FR-007); the empty-task-section case yields a valid task with an empty extent
(edge case); a headingless plan yields zero tasks and no error (edge case).

## Rule 6 — Stable identity (FR-010)

For this identity only, the `Stable_UUID` seed composes the task-file basename into the
local-id component: `spec-superpower ␀ <Feature_Name> ␀ ("<task-file basename>␀Task N")`.

**Amendment A-018-2 (parse-adapter member)** — `TaskFileAdapter` gains the optional,
whitelisted member `identityFileScope?: boolean`, consumed at the `parseTaskFile` seed call
site exactly as specified. Adapters omitting the member (all others) keep byte-identical
seed inputs; `taskStableSeed` and its frozen layout are unchanged.

Consequences (test-pinned): two plans with the same derived feature name yield pairwise
distinct, deterministic identities and can never cross-match each other's issues; in-place
edits to task text or checkbox state change no identity; duplicate `Task N` ids within one
file produce a `duplicate-local-id` parse warning; a renamed/re-dated file is a new
feature (spec edge cases).

## Rule 7 — Configuration

No new `ResolvedConfig` keys. Overridable through the existing layering only
(FR-011): filename convention via `taskFilePatterns`; plans root, detection, grammars,
feature-name rule, and identity scope via `DiscoveryOverrides.adapters["spec-superpower"]`;
enablement via `frameworkAdapters`. Disabling the identity removes the date glob from the
traversal union — plans return to being undiscovered by default (opt-out exactness).
Defaults contain zero organization-specific literals (release scan applies).

## Rule 8 — No agent-hook scaffold

`agentHookScaffold("spec-superpower", bin)` is `undefined`; the install lane refuses with
zero writes. The scaffold table stays `["generic", "kiro"]` (FR-012).

## Rule 9 — Documentation and consistency invariants (FR-013, test-first)

In the same change, and enforced by `tests/contract/framework-support-consistency.test.ts`:

1. registry keys ⇄ `FrameworkId` union ⇄ `specs/requirements.md` `Supported_Framework`
   glossary enumerate the six identities;
2. README carries a `### Spec Superpowers (\`spec-superpower\`)` subsection (>120 chars of
   real behavior, including the FR-009 plain statement that steps are mirrored content and
   completion is tracker-side), an overview-table row, and the recomputed precedence
   sentence;
3. the fabricated-names pin drops `spec-superpower` (remains `spec-kitty` until 017);
4. requirements Requirement 7 / Purpose enumerate the six built-ins; the frozen-surface
   snapshot is regenerated in the union-amendment commit;
5. `docs/framework-adapters.md`, `docs/discovery.md`, `docs/configuration.md`, and
   `CHANGELOG.md` are updated.

## Verification hooks

Executable scenarios: `quickstart.md`. Row-level field values: `data-model.md` §2.
