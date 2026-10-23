# Phase 0 Research: Path Routing and Title Derivation

**Feature**: `005-routing-title-derivation` | **Date**: 2026-10-22

No Technical Context item remained a NEEDS CLARIFICATION after the spec, constitution, and
frozen 002 contracts were loaded (runtime/module/test posture are fixed by the constitution
"Technology stack" constraint and shared verbatim with 002; the feature has no runtime
dependencies). This document resolves the **design ambiguities** the spec and frozen contracts
leave to 005, each as Decision / Rationale / Alternatives considered. The load-bearing ambiguity
is R2: the frozen config models ordered title rules as `titleRules: readonly string[]`, yet the
spec requires "first rule **whose conditions match** the task attributes" — so the condition/model
semantics are 005-owned and must be pinned deterministically here.

## R1 — Routing algorithm: longest prefix, tie-break, defaults, unassigned

- **Decision**: `resolveRouting(filePath, { projectByPath, defaultTeamKey, defaultProject })`
  scans every entry where `filePath.startsWith(prefix)` is true for a **non-empty** `prefix`
  (literal string-prefix comparison, no path-segment normalization), picks the **greatest
  `prefix.length`**, and returns `{ teamKey, project, matchedPrefix, defaulted: false }`. If two
  or more matching prefixes share that maximum length, it selects the **earliest by array index
  in `config.projectByPath`** and sets `tieBreak: "first-by-map-order"`. If no prefix matches and
  **both** `defaultTeamKey` and `defaultProject` are non-empty, it returns
  `{ teamKey: defaultTeamKey, project: defaultProject, defaulted: true }` (`matchedPrefix`/`tieBreak`
  absent). Otherwise it returns the unassigned form (see R7): empty `teamKey`/`project`,
  `defaulted: false`, `unassigned: true`. An absent/empty `projectByPath` short-circuits straight
  to the default-or-unassigned path for **every** task.
- **Rationale**: Implements 001 R4.1–R4.4 verbatim ("select the entry whose matching prefix has the
  greatest character length"; equal-length "select the first such entry by the map's defined
  ordering and record a deterministic tie-break indication"; unmatched → defaults; neither →
  "leave … unassigned … without terminating processing of remaining tasks"). `Array.prototype`
  order is a stable, inspectable tie-break (constitution IV), and returning the frozen
  `RoutingResolution` unchanged keeps 006 container-gating import-free of 005 internals.
- **Alternatives considered**: (a) normalize prefixes to require a trailing `/` boundary —
  rejected: changes "character length" semantics and could split `specs/api` vs `specs/api-v2`
  unexpectedly; the spec says literal longest **character-length** prefix. (b) dictionary-order
  tie-break — rejected: "the map's **defined ordering**", not lexicographic. (c) throwing on
  unroutable paths — rejected: R4.4 requires continuing over remaining tasks.

## R2 — Representing ordered, conditional title rules inside the frozen `titleRules: readonly string[]`

- **Decision**: The frozen `ResolvedConfig.titleRules: readonly string[]` stays **unchanged**; 005
  owns its **interpretation** via a small, total, deterministic entry grammar (the spec assigns
  005 the "Title-rule model (ordered rules with templates)"):

  ```
  <rule>      ::= <guard> " => " <template>   |   <template>            // absent guard ⇒ catch-all (matches every task)
  <guard>     ::= <cond> ( "," <cond> )*                                 // AND of all conditions
  <cond>      ::= [ "!" ] <attr> [ <op> <literal> ]
  <attr>      ::= featureName | localId | phase | framework | kind | path | child | issueRef
  <op>        ::= "=" (equality)  |  "~" (starts-with, for path only)
  <template>  ::= text with {placeholder} tokens; a literal arrow is escaped as "\=>"
  ```

  `parseTitleRules(raw)` splits each string on the **first** ` => ` (space-arrow-space) into
  guard/template, parses the guard into an ordered predicate list, and returns `TitleRule[]` in
  config order; a malformed rule raises a typed, index-carrying `TitleRuleParseError` at parse
  time (never silently treated as a template). `deriveTitle` evaluates rules in array order and
  applies the **first** whose guard passes (a bare `<template>` with no guard is the last-resort
  catch-all). The illustrative consumer preset in 001 Requirement 6's informative note maps onto
  this grammar directly (e.g. `path~<areaA> , localId => {areaPrefixA} {localId}: {title}`).
- **Rationale**: 001 R6.1 requires selecting "the first rule whose **conditions match** the task
  attributes", while 002 freezes `titleRules` as `string[]` (default `[]`). Because 005 owns the
  title-rule model and cannot amend the frozen `string[]` type (ROADMAP rule 2), the conditions
  MUST be encoded inside each rule string; a documented total grammar is the minimal way to honor
  both. Parsing rules to **data** predicates (not closures) keeps matching deterministic, the
  matched-rule index reproducible and report-indicable, and derivation unit-testable (VI).
- **Alternatives considered**: (a) treat every `titleRules[i]` as a bare template and "match" a rule
  iff all its placeholders resolve — rejected: directly contradicts R6.5 (a **matched** rule may
  still contain an unresolved placeholder) and R6.2/R6.1 (match ≠ placeholder resolvability).
  (b) amend `titleRules` to a rich object array — rejected: a frozen-contract edit, out of scope.
  (c) drop conditions and always use the first template — rejected: violates "first **matching**
  rule wins" and makes multi-rule config meaningless.

## R3 — Module layout and public export wiring without shared-file conflicts

- **Decision**: 005 owns `src/routing/` and `src/titles/` (disjoint from 003 `src/discovery`,
  004 `src/parsing`, 006 `src/matching`, 007 `src/tracker`) plus their `tests/` mirrors. It adds
  **no** `package.json` `exports` entry and does **not** touch `src/index.ts` in Wave 2. Public
  subpath export registration (`./routing`, `./titles`) and the top-level re-export are deferred
  to Wave-3 integration. 005's tests import the compiled modules by relative path under `build/`.
- **Rationale**: `package.json` and `src/index.ts` are shared/002-owned files; editing them from
  five concurrent Wave-2 agents is the one conflict vector ROADMAP rule ("disjoint modules, no
  shared files") forbids. Independent testability of 005 (spec's per-story Independent Test) is
  satisfied through relative compiled imports, so deferral costs nothing.
- **Alternatives considered**: (a) each Wave-2 feature adds its own `exports` key to
  `package.json` in parallel — rejected: same-file contention across five agents despite
  different keys. (b) import via the package name subpath during Wave-2 tests — rejected: requires
  the export entry that deferral removes.

## R4 — `<Feature_Name>: ` decoration: exactly-once, idempotent, applied on every path

- **Decision**: `deriveTitle` computes a `baseTitle` (matched-rule template output, or the raw
  `task.title` under the pass-through default), then applies `decorateFeaturePrefix`: when
  `task.featureName` is present, if `baseTitle` already begins with the exact `"<featureName>: "`
  prefix it is returned unchanged; otherwise that prefix is prepended **once**. When
  `task.featureName` is absent the base title is returned unchanged (no prefix). Decoration runs
  **after** rule selection/passthrough for **every** outcome (matched rule, no match, passthrough)
  and its result is the `finalTitle`. `matchedRuleIndex` (−1 for pass-through), `defaulted`,
  `unresolvedPlaceholders`, and `decorated` are reported alongside.
- **Rationale**: Implements 001 R6.8–R6.11 (a "built-in non-configurable step applied automatically
  after" rules 1–7, applied "regardless of whether a consumer title rule matched", "IF the derived
  title already begins with the exact prefix … retain the title unchanged … not prepend a second
  occurrence … so that repeated derivations over unchanged inputs produce a byte-for-byte identical
  final title", no `Feature_Name` ⇒ no prefix). The exact-prefix detect-then-maybe-prepend form is
  what makes re-derivation idempotent on its own; the strip-on-render side (R6) is the second half.
- **Alternatives considered**: (a) prepend unconditionally — rejected: stacks prefixes across runs
  (the classic bug this feature exists to eliminate). (b) case-insensitive/whitespace-tolerant
  prefix detection — rejected: R6.10 says the **exact** `Feature_Name` + colon + single space; a
  fuzzy match could strip a legitimately different title.

## R5 — Template placeholder substitution and the unresolved-placeholder indicator

- **Decision**: `renderTemplate` replaces `{placeholder}` tokens from task attributes over the
  normative set from 001 R6.4 — `{title}`, `{featureName}` (alias `{feature}`), `{localId}`,
  `{framework}`, `{phase}`, `{prefix}` (the visible `[KEY-N]` issue-ref, else empty). A token
  whose attribute is absent/empty is replaced with an empty string and its name pushed to
  `unresolvedPlaceholders` (never left literal). A placeholder in a **matched** rule still yields
  the empty-string + indicator behavior (R6.5).
- **Rationale**: Verbatim to R6.4/R6.5 ("substituting each declared task attribute placeholder …
  substitute an empty string for that placeholder and produce an outcome indicator identifying the
  unresolved placeholder") and the spec Edge Case ("never left literal"). The indicator list is a
  pure return value; the propagation owner (008/009) surfaces it.
- **Alternatives considered**: (a) leave unresolved tokens literal — rejected: violates the edge
  case and would leak `{...}` into issue titles. (b) fail derivation on an unresolved placeholder
  — rejected: R6.5 requires a substituted empty string + indicator, not an abort.

## R6 — Render-back strip set and ordering (005-owned, provided to 004)

- **Decision**: `stripTitleForRender(finalTitle, task, opts)` removes, from the front, in order:
  (1) a leading `"<featureName>: "` prefix; (2) each configured strip prefix in
  `ResolvedConfig.titleStripPrefixes` (leading the adapter-supplied default strip prefixes per
  001 R7.4/R7.5 — "Default title strip prefixes come from the active framework adapter (003)");
  (3) a redundant leading issue prefix `[<KEY>-<N>]` (where `KEY` equals `config.confirmationKey`);
  (4) a duplicate leading local-ID prefix `"<localTaskId>: "` — removed "only when the preserved
  line already carries that identifier". All other characters preserved unchanged. When
  `titleStripPrefixes` is empty, the built-in default strip removes **only** the leading
  local-ID prefix and any redundant leading issue prefix, and "removes no other prefix".
- **Rationale**: 005 owns "the strip contract honored when rendering titles back" (spec Provides-to)
  and R6.6/R6.7/R6.12. Applying strip on render removes exactly what decorate adds, so
  parse→derive reproduces the same `finalTitle` (R6.12 "titles are not progressively prefixed
  across runs"). Keeping the title-text strip in 005 gives 004 a single canonical algorithm to
  honor for the title field.
- **Alternatives considered**: (a) strip every configured prefix anywhere in the string — rejected:
  "remove every configured strip-prefix **pattern** … preserving all other title characters
  unchanged" is a leading-prefix operation. (b) have 004 own the feature-prefix strip too —
  rejected: 005 owns the decoration, so it owns the matching removal (symmetry, single source).

## R7 — Unassigned encoding within the frozen `RoutingResolution`

- **Decision**: The unassigned result uses the frozen shape as-is — `teamKey: ""`, `project: ""`,
  `defaulted: false`, `unassigned: true` (no `matchedPrefix`/`tieBreak`). Consumers test
  `res.unassigned === true`, never the empty strings, to decide "leave the task visibly unassigned
  while processing continues".
- **Rationale**: `RoutingResolution.teamKey`/`.project` are required `string`s in the frozen 002
  type; they cannot be made optional without a cross-feature amendment (out of scope). The
  already-frozen `unassigned?: true` discriminant is the canonical signal (contracts/task-model.md:
  "`unassigned?: true` // no prefix and no default identities"), so encoding emptiness in the
  strings is inert and amendment-free.
- **Alternatives considered**: (a) widen `teamKey`/`project` to optional — rejected: frozen-contract
  edit (ROADMAP rule 2). (b) a nullable return (`RoutingResolution | null`) — rejected: diverges
  from the frozen plan/report consumption where `PlanTaskEntry.routing?: RoutingResolution`.

## R8 — Test strategy (test-first, property-based round-trip centerpiece)

- **Decision**: Per constitution VI (NON-NEGOTIABLE) tests precede implementation. Unit tests per
  pure module; contract tests assert (i) `resolveRouting` produces **exactly** the frozen
  `RoutingResolution` key set (imported from `src/domain/routing.js`, no local redefinition) and
  (ii) the default title/strip behaviors contain zero org/product literals (release-scan mirror).
  Integration: a routing corpus asserting SC-001 determinism (identical results on every re-run);
  and the SC-002 centerpiece — a property-based **10-cycle** `deriveTitle → (mirror) →
  stripTitleForRender → (re-parse) → deriveTitle` round trip asserting the final title is
  byte-stable from cycle 1 and the strip removes exactly the decorated prefix set. Tasks hand-build
  `Task` fixtures (005 does not depend on 004 at test time).
- **Rationale**: The constitution lists "rendering round-trip stability … no progressive
  `Feature_Name` prefixing" as a **required** property-based property; SC-002 (0 duplicated or
  compounding prefixes over 10 cycles) and SC-001 (100% deterministic routing) map 1:1 to these
  tests. Hermetic by construction: pure functions, no transport, injected nothing time-based.
- **Alternatives considered**: (a) rely on integration coverage in Wave 3 (008) — rejected: VI and
  ROADMAP rule 4 require an independently runnable per-feature test now; (b) a snapshot of titles
  only — rejected: snapshots don't prove the *property* across arbitrary attributes; the round-trip
  property does.
