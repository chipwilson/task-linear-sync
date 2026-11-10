# Phase 0 Research: Spec Superpowers Adapter

**Feature**: `018-spec-superpower-adapter` | **Date**: 2026-11-09

All Technical Context entries in `plan.md` are resolved — **no NEEDS CLARIFICATION remains**.
Findings below follow Decision / Rationale / Alternatives considered.

## R1 — Identity vocabulary widening (FR-001, FR-013)

- **Decision**: Widen the frozen union in `src/domain/task.ts` to
  `FrameworkId = "bmad" | "spec-kit" | "open-spec" | "kiro" | "spec-superpower" | "generic"`
  via the documented three-artifact amendment (`docs/contract-amendments.md`):
  contract doc `specs/002-core-domain-contracts/contracts/task-model.md` + module +
  snapshot (`UPDATE_FROZEN_SNAPSHOT=1 npm run test:contract`). Add the id to
  `BUILT_IN_FRAMEWORK_IDS` (`src/discovery/types.ts`), the `builtInAdapters` /
  `builtInAdapterRows` tables (`src/discovery/adapters/index.ts`), and the
  `frameworkAdapters` default enabled set (`src/config/defaults.ts`).
- **Rationale**: `src/discovery/types.ts` pre-authorizes this exact step — "the 002 union
  itself is unchanged (widening it is an amendment candidate, not executed here)". Only a
  frozen `FrameworkId` member passes the engine's `isBuiltInFrameworkId` sync-surface gate
  (`src/engine/build.ts`), which FR-001 requires (full discover → … → rollback surface,
  same gates). Six identities measured against the spec: the spec's "seventh" counts the
  unlanded `spec-kitty` (017); whichever of 017/018 lands second rebases, and the
  consistency suite is parameterized off `Object.keys(builtInAdapters)`, so it absorbs
  either landing order.
- **Alternatives considered**:
  - *Custom-adapter descriptor pretending to be built-in* — rejected: custom ids are
    refused at plan/apply (`build.ts` `isBuiltInFrameworkId` check), and FR-001 demands
    built-in, default-enabled status.
  - *Deferring the amendment behind a feature flag* — rejected: silent deviation is not
    permitted (Governance); the amendment is additive and snapshot-drift is visible by
    construction.

## R2 — Task-heading grammar: one task per `Task N:` heading (FR-004)

- **Decision**: The row's `headingGrammar` (regex source, named groups `id` + `title` as
  the frozen default requires):
  `^\s{0,3}#{2,4}\s+(?<id>Task\s+[0-9]+)\s*:\s*(?<title>.+)$`
  — heading levels two through four (US edge case), identifier captured verbatim as the
  local id (`Task 1`), separator colon tolerated-then-optional-space, the identifier span
  excluded from the title because it lives in the `id` group.
- **Rationale**: `extractTasks` already treats "a heading matching NO grammar" as structure
  only (no task) — so a grammar that matches *only* task headings gives FR-004 and most of
  FR-006 with **zero parsing code change**. The generic fallback's collapse ("id `Task`,
  number stranded in title") is exactly the default grammar's
  `[A-Za-z][A-Za-z0-9-]*\d*` id branch, which this grammar replaces per-adapter.
  `parseIssueRefAndCleanTitle` keeps stripping visible `[SYNC-12]` refs from titles
  unchanged.
- **Alternatives considered**:
  - *Extend the default grammar with a `Task N` branch* — rejected: changes the frozen
    default grammar and other adapters' extraction (SC-005 forbids).
  - *Levels 1–6 instead of 2–4* — rejected: level-1 is the document title (FR-006 must not
    task it); levels 5–6 are not part of the convention's task heading.
  - *Matching `Tasks N` / `Task N.` separator variants* — rejected as speculative; the
    convention is `Task N:`; a team's variant is a per-adapter override (R8).

## R3 — Step containment: checkboxes are content, never tasks (FR-005)

- **Decision**: The row sets `rollupPattern` to a whole-line checkbox capture:
  `^\s*[-*+]\s*\[[ xX]\]` — every checkbox line in a plan is excluded from the task list
  and recorded in `ParseResult.exclusions` (kind `checklist`, reason `rollup`), while
  remaining inside its task's line extent (extents are line-based; excluded lines are not
  task lines). Steps therefore mirror verbatim inside the body (FR-007) and step edits are
  body-content drift (FR-008).
- **Rationale**: This is exactly what the rollup exclusion is defined to do — checkboxes
  that are document structure, not tasks — and it is adapter-scoped like every other
  grammar member (`adapter.rollupPattern ?? config.rollupPattern`). The US1 scenario
  "seven steps → still three tasks" and the stray-pre-task-checklist edge case ("excluded …
  recorded in the parse exclusions") both fall out with no new exclusion kind, no
  `extract.ts` change, and zero effect on other built-ins (they keep the default
  `\b(?:parent|roll-?up)\b`).
- **Alternatives considered**:
  - *New `stepPattern` member + new exclusion reason `"step"`* — rejected: amends the
    frozen 004 parsing contract and adds vocabulary for behavior `rollup` already
    specifies; the reason string is a diagnostic detail, and the spec only requires the
    exclusion be recorded.
  - *Rely on checklist children hanging under heading tasks* — rejected: children are
    still tasks today (that is the measured noise the spec's preamble complains about).
  - *Pattern limited to `**Step N:**`-bolded lines* — rejected: unbolded steps would leak
    back in as tasks; "any checkbox inside a plan is content" is the format's rule.

## R4 — Preamble exclusion (FR-006)

- **Decision**: No new mechanism. Preamble sections (`Goal`, `Architecture`, `Tech Stack`,
  Spec reference, `Global Constraints`, `Review Focus`, plus the level-1 document title)
  do not match the task grammar, so they are structure only; extent binding on any
  equal-or-shallower heading keeps their prose outside every task body (tasks are `###`,
  preamble `##`; a shallower `##` between tasks closes the earlier extent). The
  document-title heading (`# …`) is level 1 — outside `#{2,4}` and outside the grammar
  anyway.
- **Rationale**: `extent.ts` rule (b) already terminates a task's body at the next heading
  of level ≤ the task's level whether or not that heading is a task; `extract.ts` resets
  the orphan/checklist context at every heading. Preamble text is thus never in any task's
  mirrored description (spec assumption: no shared-preamble prepending).
- **Alternatives considered**:
  - *`summaryPattern`-style exclusion list for preamble headings* — rejected: the
    summary-section mechanism also suppresses checklist tasks inside the section, which is
    redundant here (R3) and would consume the only slot that could carry a user-facing
    summary section; a named "preamble exclusion list" would be a second source of truth
    duplicating the grammar.
  - *Prepending the preamble to every body* — rejected by the spec's own assumption
    (duplicated text across all of a plan's issues).

## R5 — Feature name from the date-stripped filename (FR-003, SC-003)

- **Decision**: New `FeatureNameRule` kind `{ kind: "date-stripped-basename" }` in
  `src/discovery/adapter.ts` + a branch in `applyFeatureNameRule` (`src/discovery/conventions.ts`):
  basename, minus a leading `NNNN-NN-NN-` date prefix when present, minus the final
  extension. `2026-11-09-auth.md → auth`. When no date prefix is present (a team overrode
  the filename pattern, edge case "keep the plans-root rule and override the pattern"),
  the extension-stripped basename is the feature name — derivation never fails under a
  plans-root-gated pattern.
- **Rationale**: The rule registry (`parent-dir`, `parent-or-basename`, `segment-after`,
  `none`) has no filename-with-munging kind; a declarative kind keeps behavior table-driven
  and overridable exactly like the rest (programmatic `featureName` still wins via
  `resolveConventions`).
- **Alternatives considered**:
  - *`parent-or-basename`* — rejected: yields `plans` (the directory) for canonical layout,
    and an unstripped `2026-11-09-auth` name violating SC-003.
  - *New rule with configurable date regex* — rejected: one more knob for a fixed upstream
    convention; teams using other names override the whole rule declaratively.

## R6 — Discovery: plans root, precedence, and the generic-fallback narrowing (FR-002, US1-AC4)

- **Decision**:
  - Row defaults: `baseDirectories: ["docs/superpowers/plans/"]`,
    `detection: { pathPrefixes: ["docs/superpowers/plans/"] }` (beneath-any-depth),
    `taskFilePatterns: ["[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]-*.md"]`
    (the basename glob compiles under the existing `compileNamePattern` class support).
  - `DEFAULT_PRECEDENCE` becomes
    `["kiro", "open-spec", "spec-kit", "bmad", "spec-superpower", "generic"]`
    — immediately before the fallback; ranking is dominated by the longest matched pattern
    anyway, and the plans path cannot co-match a narrower built-in in practice.
  - **Fallback narrowing** (amendment 2 in `plan.md`): when zero adapters claim a
    candidate, `selectAdapter` returns `generic` **only if the basename also matches the
    enabled generic adapter's effective `taskFilePatterns`**; otherwise discovery records
    nothing for the file (unclaimed). `discover.ts` omits unclaimed candidates.
- **Rationale**: Today every built-in row shares `tasks.md`/`TASKS.md`, so union-matched
  candidates always match the generic lane — built-in behavior is bit-identical, and SC-005
  holds. The narrowing becomes observable exactly where FR-002 needs it: the date-glob joins
  the traversal union, and without the gate a stray `docs/2026-11-09-notes.md` would be
  silently synced as `generic` (US1-AC4 violation). It is also strictly more correct for the
  custom lane (a file matching only a custom descriptor's pattern with failing detection was
  previously grabbed by generic).
- **Alternatives considered**:
  - *Leave fallback as-is* — rejected: fails US1-AC4 ("it is not claimed, keeping unrelated
    Markdown out of the sync").
  - *Path-scoped candidate gating in `traverse.ts` (attribute union matches to adapters)* —
    rejected: rewrites the frozen traversal model for one row; the basename gate at
    selection achieves the same observable behavior with a smaller amendment.
  - *Skip the date glob in the union; find plans via a separate walker* — rejected: second
    walk violates the single-traversal design and reads-then-discards files.

## R7 — File-scoped stable identity for plans sharing a feature name (FR-010, US3-AC2)

- **Decision**: The row declares `identityFileScope: true` (new optional member carried by
  `FrameworkAdapter`, whitelisted on `TaskFileAdapter` — amendment 3). In
  `parseTaskFile`, when the member is set, the **seed input** for a task with a local id is
  composed as `"<task-file basename> + '\u0000' + localTaskId"`
  (e.g. `2026-11-09-sync.md␀Task 1`); `taskStableSeed`, its frozen layout, and every
  adapter that omits the member stay **byte-identical**. The domain-facing
  `Task.localTaskId` remains the bare `Task 1` (metadata, titles, warnings unaffected).
- **Rationale**: The frozen seed is `frameworkId ␀ featureName ␀ (localTaskId ??
  ordinal:filePath)`; with FR-003 pinning both same-name plans to feature name `sync` and
  FR-004 pinning ids to `Task N`, the two files would produce identical `Stable_UUID`s —
  a hard integrity collision (constitution II). The file basename is the format's own
  identity anchor: plans are per-feature, and the spec already declares file renames
  create a new feature. In-place edits change no seed input → identities stable (US3-AC3);
  distinct filenames → distinct ids (US3-AC2, SC-003); within-file duplicate ids still
  surface as the existing `duplicate-local-id` parse warning (FR-010 second half,
  `collectDuplicateWarnings` unchanged).
- **Alternatives considered**:
  - *Omit the grammar `id` group so seeds use the `ordinal:filePath` fallback* — rejected:
    contradicts FR-004/US1-AC2 ("local ids are `Task 1`…") and churns identity on every
    task insertion.
  - *Collide-then-disambiguate feature names at discovery* (e.g. keep the date when two
    plans share a stripped name) — rejected: violates FR-003/SC-003 (100% date-stripped
    names) and makes routing/title behavior depend on sibling files.
  - *Amend `taskStableSeed` to include `filePath` for all adapters* — rejected: changes
    every existing identity (violates SC-005 and the durable-identity promise for
    already-synced tasks) and needs a constitution amendment.
  - *Let `DurableIdentityCollisionError` abort same-name plans* — rejected: turns a
    documented, ordinary repository shape into an outage.

## R8 — Configuration layering, no new config keys (FR-011)

- **Decision**: Zero new `ResolvedConfig` keys. Overridability: filename pattern via the
  existing `taskFilePatterns` key (whole-array replace, existing semantics — a deviation
  applies to all enabled adapters, so custom patterns must include the date glob); plans
  root, detection, grammars, feature-name rule, and identity scope via the existing
  programmatic layer `DiscoveryOverrides.adapters["spec-superpower"]` (`baseDirectories`,
  `detection`, `headingGrammar`, `rollupPattern`, `featureNameRule`, …). Disabling the
  identity through the `frameworkAdapters` enabled set removes its glob from the traversal
  union — the exact opt-out back to today's behavior (edge case).
- **Rationale**: `configConventionLayer` deliberately maps frozen keys only, and adding a
  `plansRoot`-style key to the 002-frozen `ResolvedConfig` is a heavier amendment than this
  feature needs. Existing built-in roots (`.kiro/specs/`, `openspec/`) have always been
  programmatic-override territory; the new row is consistent with them. Constitution III's
  "EVERY default overridable" is honored through the same layering every adapter uses.
- **Alternatives considered**:
  - *New config key for the plans root* — rejected: frozen-surface amendment with no
    precedent need; the docs (`docs/configuration.md`) gain an overrides example instead.
  - *Fold `docs/superpowers/plans/` into `specsBaseDirectories`* — rejected: that key IS
    generic's base set (parent-dir feature naming for unknown layouts); folding would make
    `generic` claim plan files with feature name `plans` when the identity is disabled —
    the opposite of the exact-opt-out edge case.

## R9 — No agent-hook scaffold (FR-012)

- **Decision**: No `agentHooksDirectory` / `agentHookTemplate` on the row (defaults to
  "none"). `agentHookScaffold("spec-superpower", …)` returns `undefined`, so the install
  lane keeps refusing with zero writes. The 016 consistency suite's scaffold table stays
  exactly `["generic", "kiro"]`.
- **Rationale**: The refusal path is already total over non-template ids; adding nothing is
  the requirement ("requesting one keeps refusing").
- **Alternatives considered**: *a `command-md` template for Superpowers hooks* — rejected:
  out of scope per the spec ("no agent-hook scaffold for the framework").

## R10 — Mirroring, drift, and completion semantics (FR-007…FR-009, US2)

- **Decision**: No engine changes. Step checkboxes/file lists/code fences are inside the
  task's line extent, so the existing description-mirroring propagates them verbatim
  (security screening unchanged); editing a checkbox flips `[ ]→[x]`, the body hash
  drifts, and the next run writes **only that task's issue description** — conflict maps,
  normalization profile, and surgical line rendering (`src/parsing/render.ts`) already
  guarantee the parse→derive→render→parse byte fidelity the spec's SC-004 asserts
  (property suites extended to the new identity). Completion stays tracker-side: heading
  tasks carry no `checked` state, steps are content, and the README subsection states the
  difference plainly (FR-009).
- **Rationale**: US2 is satisfied by machinery built in 004/008; the feature's job is to
  make the parse model classify this format correctly, not to re-sync anything new.
- **Alternatives considered**: *"All steps checked ⇒ complete" derivation* — rejected by
  the spec's Assumptions (a new cross-framework completion rule; separate feature if
  demanded). *Syncing step state into issue state* — rejected: contradicts FR-009.

## R11 — Consistency suite and surface pins, test-first (FR-013)

- **Decision**: Land these test updates **before** the source change (PR order inside the
  feature):
  1. `tests/contract/framework-support-consistency.test.ts` — flip the fabricated-names pin
     from `/spec-kitty|spec-superpower/i` to `/spec-kitty/i` (spec-kitty stays fabricated
     until 017 lands); registry-parameterized assertions then require the new id in README
     subsections, backticked canonical ids, and the recomputed precedence sentence.
  2. `tests/contract/discovery-surface.test.ts` + `tests/unit/discovery-adapters-builtin.test.ts`
     — five-id literals → six (registry keys ⇄ frozen union ⇄ glossary remain one set).
  3. `tests/contract/frozen-surface.test.ts` snapshot regenerated once, deliberately
     (`UPDATE_FROZEN_SNAPSHOT=1 npm run test:contract`) in the same commit as the 002
     contract doc + `task.ts` union (R1 trio).
  4. `tests/unit/discovery-selection.test.ts` — fallback-gate matrix (claims tasks.md via
     generic as today; unclaims a date-named file outside the plans root; custom-lane
     narrowing case).
- **Rationale**: Principle VI is NON-NEGOTIABLE and the suite is the enforcement evidence
  that registry, frozen union, `specs/requirements.md` glossary, and README enumerate the
  identity in lockstep; flipping the fabricated-name pin test-first makes the README/doc
  commit the thing that turns the suite green.
- **Alternatives considered**: *Docs first, suite later* — rejected: allows an intermediate
  state where README and requirements disagree with the registry, which is precisely the
  untruthfulness 019 audits.

## R12 — Fixtures and framework-parameterized coverage (SC-001…SC-005)

- **Decision**: New fixture repo `tests/fixtures/repos/discovery/spec-superpower/` with
  three dated plans (canonical directory, one feature name on two dates, full preamble
  incl. all standard sections, `### Task N:` headings at level 3 in one plan and level 4
  in another to pin level variance, seven steps total, fenced code blocks, one
  checked-step edit path for drift). New integration matrix mirrors
  `discovery-adapters.test.ts` (SC-001 identity table), plus unit parse tables and an
  integration drift test on the fake `Linear_Port` (exactly one description write after
  checking a step; body byte-equal to the plan span). Every existing suite that
  parameterizes frameworks (round-trip property tests, overrides, e2e user stories,
  consistency) covers the new id automatically via `Object.keys(builtInAdapters)` or gets
  an explicit case.
- **Rationale**: SC-005's "no behavior change for the other built-ins" is proven by keeping
  their cases untouched and running the whole suite; the spec's Independent Tests map 1:1
  onto this fixture.
- **Alternatives considered**: *Inline string fixtures only* — rejected: the discovery
  matrix operates on real directory trees (`withTempTree`/fixture repos), and a repo
  fixture also proves the negative cases (unrelated Markdown, files outside the root).

## Resolved unknowns ledger

| Spec/plan unknown | Resolution | Ref |
|---|---|---|
| "seventh built-in" wording | six on landing (017 not landed); suite parameterization makes order moot; whichever of 017/018 lands second rebases | R1 |
| How steps avoid task-hood | adapter `rollupPattern` step capture | R3 |
| How preamble stays out | grammar non-match + extent boundaries | R4 |
| Filename feature naming | new `date-stripped-basename` rule kind | R5 |
| Not claiming files outside the root | generic-fallback narrowing (amendment 2) | R6 |
| Same-name plans, distinct ids | `identityFileScope` seed composition (amendment 3) | R7 |
| Config override surface | existing layering; zero new keys | R8 |
| Where refusal for hooks lives | already total; no change | R9 |
| Progress/checking steps | existing drift-mirroring; tracker-side completion | R10 |
