# Phase 0 Research: Spec Kitty Adapter

**Feature**: `017-spec-kitty-adapter` | **Date**: 2026-11-09
**Inputs**: [spec.md](./spec.md), `.specify/memory/constitution.md` v1.0.0, as-built code at HEAD `5a92b4f`.

All Technical Context questions are answered from the as-built repository; **no NEEDS
CLARIFICATION remains**. Each decision below follows Decision / Rationale / Alternatives.

---

## R1 — Adapter row is data; registry insertion position

**Decision**: `spec-kitty` ships as a conventions row like every built-in —
`src/discovery/adapters/spec-kitty.ts` (frozen `ResolvedConventions`-style row) registered
in `src/discovery/adapters/index.ts` (`builtInAdapters` + `builtInAdapterRows`), id added to
`BUILT_IN_FRAMEWORK_IDS` (`src/discovery/types.ts`), the `FrameworkId` union
(`src/domain/task.ts`, amendment 1), and the `frameworkAdapters` default array
(`src/config/defaults.ts:43`). `DEFAULT_PRECEDENCE` (`src/discovery/registry.ts:33`) becomes
`["kiro", "spec-kit", "open-spec", "bmad", "spec-kitty", "generic"]` — inserted after
`bmad`, immediately before the `generic` fallback.

**Rationale**: selection ranking is longest matched pattern → precedence index →
alphabetical (registry.ts L102–158), and `spec-kitty`'s detection set (`kitty-specs/`
prefix) is disjoint from all four detection-bearing built-ins on canonical layouts, so —
per the spec's Assumption — the insertion position cannot change outcomes; keeping
`generic` last preserves the documented fallback semantics. The engine admits any id in the
`FrameworkId` union (`src/engine/build.ts` rejects only *custom* ids), so full sync-surface
parity (FR-001) is a widening of the union plus the row — no engine change.

**Alternatives considered**:
- *Insert after `kiro`* — arbitrary on disjoint sets and creates a needless diff against
  the frozen `DEFAULT_PRECEDENCE` pins; rejected for equal outcomes with more churn.
- *Alphabetical insertion between `open-spec` and `bmad`* — no semantic benefit; ties are
  impossible on disjoint markers, and the README precedence sentence (pinned by the 016
  consistency suite) must re-flow either way.

## R2 — Detection without siblings; deterministic disjointness

**Decision**: detection is `pathPrefixes: ["kitty-specs/"]` (default, overridable via
`baseDirectories`/detection on the row) with **no** `siblingsAnyOf` requirement (FR-002).
`spec-kit`'s conjunctive rule (path prefix `specs/`/`spec/` AND sibling `spec.md`/`plan.md`)
is not touched.

**Rationale**: a `kitty-specs/…` path is not root-relative-prefixed by `specs/`, so the two
adapters can never match the same candidate on canonical layouts (edge case "both
frameworks in one repository" resolves disjointly by construction); the ranking rules
already in place make any theoretical overlap deterministic (FR-002 requires no new rule).

**Alternatives considered**:
- *Require sibling `spec.md` like spec-kit* — rejected: spec FR-002 explicitly says
  "without requiring sibling markers", and missions may legitimately lack `spec.md`
  (edge case "mission without a task file" shows the layout is directory-driven).
- *pathContains `kitty-specs/`* — rejected: a contains-rule would also claim
  `vendor/kitty-specs/…`; prefix semantics match every other built-in's root detection.

## R3 — Heading behavior: no heading tasks, work packages as phases, template sections contained

**Decision**: three declarative grammar members on the row:

1. `headingGrammar`: a never-matching pattern (`(?!)` source). `extract.ts` L141–143 makes
   any heading that matches no grammar *structure only* — so work-package headings, the
   standard template sections (Inputs, Prerequisites, Organization, Subtask Format, Path
   Conventions, Implementation Notes, Parallel Opportunities, Dependencies, Risks &
   Mitigations, Goal, Independent Test), and every other heading produce zero heading tasks
   (FR-007, US2-AC1/2). Spec Kitty subtasks are checkbox lines only.
2. `phasePattern`: `/^#{2,4}\s+Work Package\s+(?<phase>WP\d+(?::\s*[^\n]*)?)\s*$/u` —
   checked **before** the heading grammar (extract.ts L130–135), so each
   `## Work Package WP01: Setup` heading records `WP01: Setup` (captured `phase` group) as
   the grouping of every subtask beneath it until the next heading resets scope (FR-007,
   US2-AC1; a WP with no subtasks contributes grouping context only).
3. `summaryPattern`: matches the template/prose section headings listed above. Any checkbox
   line inside such a section becomes an exclusion record rather than a task — this covers
   *illustrative* `- [ ]` examples the template prints inside "Subtask Format" or
   "Implementation Notes" even when a team leaves them unfenced (US2-AC2). Sections close
   automatically at the next heading of equal-or-shallower level (extract.ts L128).

**Rationale**: all three mechanisms already exist and are used by other built-ins; zero
parser code changes. YAML front matter (US2-AC3, FR-007) is structurally inert:
front-matter lines match no heading/checkbox grammar and become plain content, and fenced
regions are non-task text by rule. `detectFlatDocument` (extract.ts L76–90) returns `true`
for roll-ups (no grammar-matching heading) — verified by grep that `flatDocument` is
metadata on the extract output with no behavioral consumer today; the outcome is safe and
gets a pin test.

**Alternatives considered**:
- *`headingGrammar` matching `### Task T\d+:` heading style* — rejected: the spec defines
  subtasks exclusively as checkbox lines (Key Entities); inventing a heading-task lane adds
  a task source FR-007 does not ask for.
- *New "section exclusion list" config concept* — rejected: `summaryPattern` +
  `rollupPattern` already express whole-section containment; a sixth concept would violate
  the "smallest change" governance bar.

## R4 — Local-id capture: new optional `checklistIdPattern` member (amendment 2)

**Decision**: add optional parse-adapter member `checklistIdPattern?: RegExp`;
`stripLeadingLocalId` consumes the resolved pattern, whose built-in default is **today's
`LOCAL_ID_SPAN_RE` verbatim** (content.ts L167–168). The `spec-kitty` row sets:
`/^(?<id>[Tt]?\d{2,}(?:\.\d+)*)[ \t]*[.:—–-]?[ \t]+/u` — capturing `T001`, `T001:`,
`T001 —`, and bare-digit ids (`042 …`, `2.1 …`), with or without a trailing separator
(FR-005; edge case "subtask id variants"). Capture feeds the existing `localTaskId` field,
which the existing seed composition (`taskfile.ts` L63–71) already folds into
`Stable_UUID` — FR-010 requires no identity code at all.

**Rationale**: today's global regex *requires* a separator (`T001:`), so the canonical
`- [ ] T001 Create the scaffold` captures nothing — this is precisely the identity
degradation the spec's investigation measured. Widening it per-adapter (rather than
globally) keeps the other five identities byte-identical with zero regression surface.
Requiring ≥ 2 digits (`\d{2,}`) prevents ordinary sentence words from capturing.

**Alternatives considered**:
- *Widen the global `LOCAL_ID_SPAN_RE` to accept separator-less ids* — rejected: would
  regress existing frameworks (e.g. `- [ ] v2 ships` capturing local id `v2`), violating
  SC-005's zero-behavior-change requirement.
- *Positional id fallback (line ordinal)* — rejected: violates the durable-identity
  outcome SC-004 measures.

## R5 — Capability tags `[P]`/`[US1]`: new optional `titleTagPattern` member (amendment 2)

**Decision**: add optional parse-adapter member `titleTagPattern?: RegExp`;
`CleanTitleOptions` gains the pattern and `cleanTitle` (title.ts fixpoint loop) removes
every bracketed tag token during **title derivation and mirrored-title rendering only**.
The `spec-kitty` row sets `/\[(?:P\d*|US\d+)\]/gu` — `[P]` plus any `[<uppercase><digits>]`
user-story tag of the same shape. The pattern never contains a hyphen inside the brackets,
so visible issue references `[<KEY>-N]` are structurally unmatched; parse-side *stored raw
titles* (frozen field semantics: raw text minus issue-ref and id span) are **not** altered
— only derived/mirrored titles strip tags. The file itself is rewritten only by the issue
prefix insertion, so `[P]` survives byte-for-byte across parse → render → parse, and
mirrored task bodies (raw extent lines) preserve the tags and any in-extent dependency
prose (FR-006, FR-008, US2-AC4, SC-003).

**Rationale**: no bracket-tag mechanism exists anywhere in `src/` today (verified); a
declarative, per-adapter pattern mirrors the existing `titleStripPrefixes` design and keeps
`cleanTitle`'s fixpoint-stability (removal is one pass to a tag-free fixpoint ⇒ no
progressive change on re-render, Principle IV). Other frameworks ship without the member ⇒
zero change for them.

**Alternatives considered**:
- *Put `[P]` into `titleStripPrefixes` via defaults* — rejected: that key is global config
  (would strip `[P]` for every framework) and only strips *leading* literals — trailing
  `[P]` would survive.
- *Strip tags at parse time from the stored title* — rejected: breaks the frozen
  "raw title" field semantics (004 contract) and would make the mirrored body and title
  disagree about content.

## R6 — Prompt-file exclusion: `*` segments in framework-specific exclusions (amendment 3)

**Decision**: extend `skipByExclusion` (traverse.ts L143–149) so a root-relative entry
(contains `/`) may contain `*` segments matching exactly one path segment; entries without
`*` keep byte-identical prefix semantics. The `spec-kitty` row's
`frameworkSpecificExclusions` default is `["kitty-specs/*/tasks/"]`, i.e. each mission's
agent-prompt directory only — never a bare repo-global `tasks/` name.

**Rationale**: prompt files (`tasks/WP01-*.md`) carry YAML execution history restating the
roll-up; syncing them would duplicate issues (spec Assumption). Under default
`taskFilePatterns` they don't match anyway, but the spec requires "never discovered" as
invariant behavior even when a team broadens the file patterns — only a directory skip
guarantees that. The exclusion is *derived-scope*: keyed to the configured root segment so
an overridden specs root and its exclusion move together (FR-009). Because exclusions build
from the **enabled** adapter pool (discover.ts L41–49), disabling `spec-kitty` removes the
entry and returns files to today's generic fall-through exactly (FR-011).

**Alternatives considered**:
- *Bare `tasks/` entry (name-at-any-depth)* — rejected: repo-global; would blind-skip any
  other team's `tasks/` directory and leak across adapter identities.
- *Post-selection file filter inside the spec-kitty adapter* — rejected: other adapters
  (e.g. `generic` fallback) could still claim prompt files under broadened patterns; the
  traversal-skip is the only total guarantee, and exclusion lists are already the 003
  mechanism for exactly this job.

## R7 — Dependencies, bodies, and machine-readable edges

**Decision**: no dependency mechanism. Dependency sections/prose stay ordinary content:
excluded from the task set where they sit in summary sections (R3), preserved verbatim in
the file, and mirrored as body text wherever the existing extent model includes them
(checklist extent = task line up to the next task/heading, extent.ts). `sync_plan`
structures report zero dependency edges, matching every other framework.

**Rationale**: FR-008 locks "edge semantics out of scope for every framework"; the extent
model already satisfies "preserved as content inside task bodies that mirror it"
(SC-003) with no code.

**Alternatives considered**: *a `Dependency_Edge` read model* — rejected outright by FR-008
(spec out of scope).

## R8 — Consistency pins, docs, and the amendment set (FR-013)

**Decision**: implementation is test-first against the 016 consistency suite
(`tests/contract/framework-support-consistency.test.ts`): the fabricated-name pin at L68
narrows from `/spec-kitty|spec-superpower/i` to `/spec-superpower/i` **in the same change**
that adds the README `### Spec Kitty (\`spec-kitty\`)` subsection (> 120-char body), the
overview-table row, the six-identity overview sentence, and the precedence sentence — which
the suite pins to `DEFAULT_PRECEDENCE.join(" → ")` verbatim. `specs/requirements.md`
Requirement 7 (AC1 id list, AC2 detection clause, AC5 per-adapter defaults) and the
`Framework` / `Supported_Framework` / `Framework_Id` glossary lines gain the sixth
identity; `docs/framework-adapters.md` and `CHANGELOG.md` update; the three-artifact
amendment set (plan.md "Amendment inventory") lands together, with
`UPDATE_FROZEN_SNAPSHOT=1 npm run test:contract` regenerating `frozen-surface.json` and
`tests/contract/discovery-surface.test.ts` re-pinned to six ids.

**Rationale**: these pins are drift guards by design; the suite is the enforcement half of
Principle VI and fails the build on any partial update.

**Alternatives considered**: *flip the pin before docs land* — rejected: temporarily
re-licenses fabricated doc names (the exact failure 016 removed).

## R9 — Sequencing and interaction with features 018/019

**Decision**: this plan assumes the spec's sequencing preference — 019 (doc-truthfulness)
lands first where possible; whichever of 017/018 lands second rebases onto the first and
takes both identity insertions' union: `FrameworkId` union,
`BUILT_IN_FRAMEWORK_IDS`, `frameworkAdapters` defaults, `DEFAULT_PRECEDENCE` (018 inserts
`spec-superpower` similarly before `generic`), README/requirements glossary, and the
consistency-pin narrowing (017 removes `spec-kitty` from the pin, 018 removes
`spec-superpower` — the rebasing feature completes the flip to pinning nothing).

**Rationale**: both features touch the same frozen lists and the same consistency suite;
the union merge is mechanical and the suites enumerate ids from
`Object.keys(builtInAdapters)`, so parameterized coverage auto-expands and only the
hand-written literals conflict — a rebase, not a redesign.

**Alternatives considered**: *sequencing either feature behind the other as a hard
dependency* — rejected: disjoint adapter rows mean neither needs the other's code; only
shared literals merge.

## R10 — Parity and fixture strategy (SC-001…SC-005)

**Decision**: reference fixture = `tests/fixtures/repos/discovery/spec-kitty/` — two
missions (`001-demo`, `002-billing`), work packages with and without `[P]`, prose sections
with an unfenced illustrative checkbox, front matter, prompt files under each `tasks/`
directory, and a `.kittify/` directory; plus the parsing-corpus row
`tests/fixtures/parsing/frameworks/spec-kitty/tasks.md`. Discovery/selection/agent-hook
unit tests and the identity tables in `tests/integration/discovery-adapters.test.ts` and
`tests/e2e/discovery-user-stories.test.ts` extend their per-framework parameterization to
the sixth id; drift behavior (SC-004: one create after insertion + work-package swap, zero
identity/match moves) runs over an injected fake `Linear_Port` as
`tests/integration/sync-spec-kitty-drift.test.ts`. SC-005 parity comes free where suites
already key off `builtInAdapters`; engine suites stay framework-neutral and gain one
`kitty-specs/`-layout world.

**Rationale**: the constitution's Test Pyramid (Principle VI) plus the spec's measurable
outcomes map 1:1 onto existing suite families; new files appear only where no parameterized
host exists.

**Alternatives considered**: *a full end-to-end CLI-only proof instead of integration
drift tests* — rejected: duplicating engine coverage per framework contradicts Principle V
(one engine) and slows the loop; the thin e2e layer still walks US1–US3.
