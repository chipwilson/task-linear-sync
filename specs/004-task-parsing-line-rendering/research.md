# Phase 0 Research: Task Parsing and In-Place Line Rendering

**Feature**: `004-task-parsing-line-rendering` | **Date**: 2026-10-22

All NEEDS CLARIFICATION resolved — the spec has no open questions; the decisions below
resolve the technical unknowns surfaced by the Technical Context. Frozen inputs cited
rather than re-derived: 002 `contracts/task-model.md` + `data-model.md` § 1–3 (Task,
TaskFile, adapter interface), 002 `research.md` R11 (`Stable_UUID` shape),
002 `contracts/configuration.md` (merged config posture), constitution v1.0.0.

## R1 — Adapter-interface consumption boundary (the parallel-safety decision)

- **Decision**: 004 defines a **consumer-owned structural interface** in
  `src/parsing/adapter.ts` — `TaskFileAdapter` — declaring exactly the adapter members
  this feature reads: `id: FrameworkId`,
  `featureName(taskFilePath: string): string | undefined`,
  and optional overridable regex sources `headingGrammar?`, `phasePattern?`,
  `summaryPattern?`, `rollupPattern?` (002 data-model § 3, verbatim member names).
  `parseTaskFile(filePath, content, adapter, config)` accepts only this interface. 004's
  tests inject a **fixture adapter in `tests/helpers/parsing-fixtures.ts`** built to the
  built-in-`generic` conventions (001 FR-022/FR-025: generic grammar = merged-config
  defaults, no framework-specific exclusions, `featureName` derivable from a
  `<feature-dir>/tasks.md` shape or absent). Nothing under `src/parsing/` may import
  `src/discovery`, `src/adapters`, or any 003 path — enforced by a contract test scanning
  the module's import statements.
- **Rationale**: TypeScript is structurally typed: 003's real adapters will satisfy
  `TaskFileAdapter` with zero code in common, which is precisely "codes against the 003
  adapter *interface* — using the built-in `generic` adapter as its test fixture — never
  its internals" (ROADMAP Wave 2). Consumer-owned interfaces (ports-and-adapters) let the
  two Wave-2 agents proceed with no shared files; the interface *members* are not invented
  here — they are the subset 002 already froze in data-model § 3.
- **Alternatives considered**: (a) wait for 003's `FrameworkAdapter` type and import it —
  rejected: forbidden cross-Wave coupling, would serialize the two agents; (b) define a
  full duplicate adapter type including `detect`/`taskFilePatterns`/`titleBehavior` —
  rejected: interface segregation, 004 must not depend on members it never calls (and
  `titleBehavior` is 005's hook, not ours); (c) parse with plain config, no adapter at all
  — rejected: FR-008 requires `Feature_Name` "using the active framework adapter".

## R2 — Convention resolution precedence (no new config keys)

- **Decision**: every grammatical knob resolves as
  `adapter.<convention>() ?? config.<grammar key>` — e.g. the task-heading grammar is the
  adapter's `headingGrammar` source when supplied, otherwise merged
  `ResolvedConfig.headingIdGrammar` (which already carries the built-in default). The
  `[<KEY>-<N>]` issue-reference pattern is built from `config.confirmationKey`
  (`\[<KEY>-(\d+)\]`, exact key); flat-document detection uses
  `config.flatChecklistMarkers`; indent normalization uses `config.tabWidth`;
  title cleaning uses `config.titleStripPrefixes`. No key is added to the frozen
  `ResolvedConfig`.
- **Rationale**: adapters are "overridable regex sources" layered over config defaults
  (002 data-model § 3 + constitution III); every value 004 needs already exists in the
  frozen grammar/sync-semantics groups, so zero amendment is required and merge friction
  with 002 stays impossible by construction.
- **Alternatives considered**: extend `ResolvedConfig` with parsing keys (`localIdGrammar`,
  `conflictMarkerPattern`, …) — rejected: a frozen-contract amendment is out of scope for
  Wave 2 (ROADMAP rule 2); the built-in defaults live as module-local constants in
  `src/parsing/` instead, which 003's adapter configuration can later override per adapter.

## R3 — `Stable_UUID` computation (R11 implementation)

- **Decision**: `src/parsing/identity.ts` exports
  `deriveStableUuid(seed: string, toolId: string): string` —
  digest = `sha256(namespacePrefix(toolId) + seed)` with `namespacePrefix` a fixed
  `toolId`-derived constant; version nibble set to `5`, variant bits per RFC 4122,
  lowercase 8-4-4-4-12 rendering. The seed string is **only ever** obtained by calling the
  frozen `taskStableSeed(t, { ordinal, filePath })` from `task-linear-sync/domain`; 004
  never re-formats it. Ordinal = the task's 0-based position in `TaskFile.tasks` order.
- **Rationale**: 002 R11 states "004 implements, 006 matches against the same bytes"; the
  seed layout is frozen in `src/domain/task.ts`, so reusing the frozen function is the
  only way to guarantee byte agreement with future consumers. The exclusion list (title,
  checkbox state, visible issue prefix) is re-asserted by a 004 property test at the UUID
  level (mutate those three on a fixture task → UUID unchanged).
- **Alternatives considered**: reimplement the seed join in 004 — rejected (drift risk =
  identity split-brain); random v4 on first sight — violates Principle II/IV outright.

## R4 — Content model: terminator-preserving lines, tabs for depth only

- **Decision**: `src/parsing/content.ts` splits content with a regex capturing each
  line **including its terminator** (`\r\n`, `\n`, or none for a final unterminated line),
  producing `ContentLine { number (1-based), text, terminator, indentWidth, originalIndent,
  inFence }`. `indentWidth` is the visual column after expanding leading tabs to
  `config.tabWidth` (used for nesting/extent comparisons); `originalIndent` is the raw
  leading-whitespace bytes (used verbatim by the renderer). A single forward pass marks
  fenced regions: a line opening a fence matches `^ {0,3}(`{3,}|~{3,})`; the fence closes
  at a line of the same char with length ≥ the opening length; interiors (and the fence
  delimiter lines themselves) are `inFence: true` and non-task.
- **Rationale**: one split feeds both user stories, so parsing and rendering cannot
  disagree about line numbering or bytes; preserving terminators per line (not per file)
  reproduces mixed/CRLF files and the exact trailing-newline style "exactly" (FR-012)
  without any newline detection heuristics. Tab expansion limited to leading-whitespace
  depth keeps FR-002's "tabs mapped to the configured tab width" away from the byte path.
- **Alternatives considered**: `content.split("\n")` + file-level newline detection —
  rejected: mixed-endline files would be normalized (byte-identity violation) and trailing
  newline needs a special case; a full Markdown AST (e.g. micromark) — rejected: runtime
  dependency + 001 requires only heading/checkbox/fence structure, not full CommonMark.

## R5 — Nesting: indent stack, orphans, and the extent rule

- **Decision**: a monotonic indent stack of open checklist tasks drives nesting: a
  checklist line pops stack entries with `indentWidth ≥` its own, then adopts the top of
  stack as `parentUuid`, else the nearest enclosing **heading** task (the orphan rule,
  FR-002), else none (flat/top-level). `childUuids` is the reverse index, ordered by line.
  Extent derivation (`extent.ts`): a task's section ends **before** the first following
  line that is (a) another task that is **not a descendant** of it, or (b) a heading of
  level ≤ its own level (headings) / any heading level 1–6 for checklist tasks whose
  section is bounded by the document structure — the minimum of (a)/(b) minus one; nested
  checklist **descendants stay inside** the parent extent ("including nested checklist
  children"). Leaf tasks with no content beneath them get `endLine === startLine`.
  Extents are derived after the whole file is scanned, so the "next task" boundary is
  exact regardless of scan order.
- **Rationale**: this is the literal FR-016 sentence made operational, and the
  descendant exception resolves the apparent tension between "up to the next task" and
  "including nested checklist children" (a child line is simultaneously *its* task's start
  and part of the parent's mirrored section). The frozen `TaskBodyExtent` invariant
  "last line before next task / sibling-or-shallower heading" (002 task-model.md) is
  preserved for siblings, which is what 008's mirroring consumes.
- **Alternatives considered**: stop the parent extent at the first child — rejected:
  breaks "including nested checklist children" and would force 008 to stitch child
  sections; treat checklist tasks as always extending to EOF — rejected: overlapping
  siblings make mirroring ambiguous.

## R6 — Phase, summary, rollup, and flat-document semantics

- **Decision**:
  - **Phase** (FR-003): a heading whose text matches `phasePattern` sets `currentPhase`
    (the pattern's `phase` capture, else full heading text) for all later tasks **and is
    not itself extracted as a heading task** — phase headings are section organizers
    (002's own tasks.md uses `## Phase N:` as scaffolding).
  - **Summary exclusion** (FR-004): a heading matching `summaryPattern` opens a summary
    section; every checklist item from that heading until the next heading of level ≤
    the summary heading's level is excluded with `reason: "summary-section"`; the heading
    itself is not a task either (it matched no task content).
  - **Rollup exclusion** (FR-004): a checklist line whose text matches `rollupPattern` is
    excluded with `reason: "rollup"`. Excluded items are recorded as
    `ExclusionRecord { lineNumber, kind, reason, text }` — they never appear in
    `TaskFile.tasks`, and their lines still act as **structure** (a summary heading still
    bounds extents above it).
  - **Flat documents** (FR-005): if the document contains no grammar-matching heading
    outside fences — or its leading non-blank line matches a configured
    `flatChecklistMarkers` prefix and no heading appears before the first task region —
    top-level checkboxes are extracted normally with no heading parent. Flat detection is
    a pure pre-scan of the fenced-line set, not a heuristic about file size.
- **Rationale**: keeps "configured patterns" as the only source of truth; the phase
  carve-out is required because the frozen default `headingIdGrammar` would otherwise
  match `Phase 1.2: …` headings as tasks with local ID `Phase`, polluting duplicate-ID
  warnings and identity ordinals.
- **Alternatives considered**: treat phase headings as tasks tagged with a phase —
  rejected: duplicates the identity space for scaffolding lines and contradicts the
  spec's own structure (phases are tracked *context*, tasks carry `phase`); hard-coding
  "User Stories"/"Acceptance" as summary headings — rejected: framework-specific
  literals belong to adapters, and the global default is `summaryPattern`.

## R7 — Conflict-marker detection and freeze

- **Decision**: `conflict.ts` scans (fence-aware) for git-style markers: opening
  `^<{7,}`, separator `^={7,}(=.*)?$` inside an open block, closing `^>{7,}`. A complete
  open→close span is a `ConflictBlock { startLine, endLine }`; an unterminated opening
  marker extends the block to EOF (defensive freeze). A task's `unresolvedConflict =
  true` iff any part of its `taskBody` extent intersects a block (FR-009). The renderer
  receives the block set and treats every line inside any block as **frozen**: an
  assignment targeting a frozen line is a structural surprise → abort (FR-013 posture).
  Conflict blocks are never parsed into tasks or excluded items (edge case "Conflict
  block interior edits").
- **Rationale**: 7-or-more repetition of the git markers is the detection rule that costs
  no configuration and cannot fire inside fences (fence-aware). Freezing the whole span
  rather than per-line implements "byte-for-byte untouched" mechanically. Writing markers
  is a 008 behavior (spec Assumption) — 004 only detects.
- **Alternatives considered**: config-driven marker regexes — rejected: violates R2's
  no-new-config-keys posture while the git format is universal; flag only the task whose
  *start line* is in a block — rejected: spec says "whose **section** contains" markers.

## R8 — Rendering mechanics: structural-prefix preservation

- **Decision**: rendering is `renderTaskLines(filePath, content, assignments, options?) →
  RenderResult`, pure over strings. Each `LineAssignment` carries the parsed task, the
  desired title, an optional `issueRef` to emit, and an optional checkbox state. Per
  assigned line the renderer: (1) **re-validates structure** — the line must still parse
  as the same kind, heading level, and checkbox marker at the recorded line number,
  outside any fence/conflict block, else it returns `LineRenderError { filePath,
  lineNumber, reason }` and emits nothing for the file (validate **all** assignments
  first, then apply); (2) preserves the **structural prefix** — the exact bytes from line
  start through the end of the heading hashes / local-task-ID span / checkbox marker and
  following whitespace — byte-for-byte; (3) replaces only the **title span** with
  `renderedTitle = "[<confirmationKey>-<N>] " + cleanTitle(desired)` (issue-reference
  prefix "configured" via `confirmationKey`, FR-011); (4) swaps `[ ]`↔`[x]` only when the
  assignment supplies a state, else retains the original state byte; (5) keeps a present
  local task ID inside the preserved prefix unless
  `options.preserveLocalTaskId === false` (the "unless configured otherwise" switch is an
  API option on the render call, not a config key — R2). Assignment line numbers are
  applied bottom-to-top (descending) into the terminator-preserving line array, then the
  array is rejoined **without touching any other line or terminator**, reproducing the
  trailing-newline style exactly (R4). `RenderResult.changes: { lineNumber, before,
  after }[]` is the per-line diff material 009 consumes as `expectedMarkdownChanges`.
- **Rationale**: preserving the prefix instead of re-templating the whole line makes
  "preserving original indentation, heading level, and a present local task ID"
  structurally true (nothing re-serializes them), makes CRLF/trailing-newline byte
  identity trivial, and makes the abort rule ("leave the file unmodified") automatic —
  there is no writer to roll back.
- **Alternatives considered**: template-render the whole line from the Task entity —
  rejected: re-serializing indent/level/ID invites formatting drift and violates
  byte-preservation on any convention mismatch; in-place string splicing with offsets —
  rejected: offset arithmetic across mixed terminators is the classic byte-corruption
  footgun.

## R9 — Title cleaning and the no-progressive-prefixing rule

- **Decision**: `cleanTitle(text, { confirmationKey, localTaskId, titleStripPrefixes })`
  iterates to fixpoint: strip each configured `titleStripPrefixes` value; strip any
  visible issue reference `[<KEY>-<N>]` (or bare `<KEY>-<N>`) for the configured key;
  strip a leading local-ID prefix duplicate (`Task 1.2:`, `T001 —`) when the task
  already carries that ID; collapse resulting duplicate whitespace at the title start.
  Cleaning is applied **only inside the renderer** (and exported for 005's derivation
  reuse): parse stores the **raw** title, because the frozen `Task.title` field is
  "raw, pre-derivation" (002 task-model.md).
- **Rationale**: idempotency gate (Principle IV): render emits `[KEY-N] clean`, so the
  next parse sees `[KEY-N]` as the issue reference (R2's pattern) and a clean remainder;
  re-render strips and re-emits the identical reference and title — no growth across
  cycles (property test).
- **Alternatives considered**: store cleaned titles on parse — rejected: contradicts the
  frozen field's "raw, pre-derivation" semantics; regex-only single-pass cleaning —
  rejected: compound existing prefixes (`[A-1] [A-2] Task 1: …` from past drift) need a
  fixpoint.

## R10 — Five-framework corpus without touching 003 internals

- **Decision**: the SC-001 "five-framework fixture corpus" is realized as five **fixture
  adapters** in `tests/helpers/parsing-fixtures.ts` (ids `bmad`, `spec-kit`, `open-spec`,
  `kiro`, `generic`) that differ only in interface-visible conventions —
  `featureName(taskFilePath)` derivation shapes (e.g. kiro: `.kiro/specs/<feature>/tasks.md`
  → `<feature>`; generic: none) and optional grammar overrides — plus one representative
  fixture task file per id under `tests/fixtures/parsing/frameworks/`. The corpus test
  asserts full extraction (kind, nesting, line numbers, extents, `featureName` threaded
  through) for all five, through the parser only.
- **Rationale**: the parser is framework-agnostic **by construction** (spec Assumption:
  "adding a framework never changes parser code"), so what SC-001 can and must prove at
  004's level is that interface-supplied conventions are honored per framework identically;
  the *real* adapter conventions are 003's FR-022 deliverable and the real-generic-adapter
  swap-in is a Wave-3 integration assertion (a named contract test marks the seam).
- **Alternatives considered**: import 003's built-in adapters when they land — forbidden
  during Wave 2, and kept optional afterwards (integration wave); a single generic corpus
  with five renames — rejected: would not prove `featureName` threading differences.

## R11 — Duplicate-identity warnings

- **Decision**: `warnings.ts` runs after extraction over the extracted set plus excluded
  items **only for extracted tasks** (exclusions cannot own identities). Two warning
  kinds: `duplicate-local-id` and `duplicate-issue-ref`; a warning is emitted per shared
  value: `ParseWarning { kind, value, lineNumbers: number[] }` with all 1-based lines
  sorted ascending. Tasks with no ID/ref are ignored; heading and checklist tasks pool
  together (FR-013: "tasks within one file"). Warnings are additive output — extraction
  still succeeds.
- **Rationale**: FR-007/SC posture is "warn, not fail": downstream identity uses the
  ordinal fallback anyway (R11 seed), and 008's conflict machinery must still see the
  tasks. Sorted-array, scan-order construction makes warnings deterministic (Principle IV).
- **Alternatives considered**: abort on duplicates — rejected: spec says "warn"; per-kind
  per-pair warnings — rejected: one warning per shared value with **every** affected line
  is the spec's phrasing.

## R12 — Packaging: one additive exports entry; module purity scan

- **Decision**: `package.json` gains exactly one additive `exports["./parsing"]` entry
  (`types` + `default` at `dist/parsing/index.{d.ts,js}`), mirroring the existing per-module
  entries; `src/index.ts` (002-owned) is **not** touched. A contract test scans every
  import statement under `src/parsing/` and asserts it references only `node:*`, relative
  paths, or the frozen `task-linear-sync/{domain,config}` subpaths — never a 003/005/006/007
  module and never `node:fs`/`node:child_process`/`node:net` (Principle I purity, enforced
  at test level).
- **Rationale**: single-line additive JSON is the only merge-conflict-possible file this
  feature touches; noting it here lets the Wave-3 integrator sequence merges. Scanning
  imports is the mechanical enforcement of "codes against the adapter interface only" and
  of the zero-I/O promise — stronger than prose review.
- **Alternatives considered**: re-export parsing from `src/index.ts` — rejected: edits a
  002-owned file (amendment territory); wildcard exports (`"./*": "./dist/*/index.js"`) —
  rejected: rewrites the frozen `exports` map shape (amendment) and weakens the
  release-scan surface.

## R13 — Test strategy: golden files, property tests, fixture adapters

- **Decision**: three mechanical enforcement layers. (1) **Golden-file corpus**
  (`tests/fixtures/parsing/golden/`): each rewrite fixture has an input file and a golden
  output; the byte-identity assertions (SC-002) are whole-file `assert.equal` against the
  golden, and untouched-line/CRLF/trailing-newline/conflict preservation are fixtures, not
  hand-computed expectations. (2) **Property tests** (Principle VI cross-cutting type):
  random assignment subsets over generated files must (a) leave every unassigned line's
  bytes identical, (b) round-trip titles (R9), (c) keep `stableUuid` invariant under
  title/checked/issueRef mutation (Principle II), (d) never emit inside a conflict block.
  Seeded PRNG (deterministic — no `Math.random()` without a fixed seed). (3) **Contract
  tests** run the parsing-api and line-rendering contracts' obligation tables against the
  `generic` fixture adapter, plus a frozen-surface snapshot of `src/parsing`'s exports so
  005/008/009 consumers see drift immediately (mirrors 002's T008 pattern at feature
  scale).
- **Rationale**: byte-level claims ("0 bytes differ", "byte-for-byte untouched") are only
  trustworthy when compared to whole-file goldens; property tests catch the structural
  surprises no fixture enumerates; the snapshot lets Wave 3 consume `src/parsing` with the
  same amendment discipline 002 applied to itself.
- **Alternatives considered**: snapshot-per-unit (vitest-style) — no dependency budget;
  manual expected-output strings — error-prone for byte claims; leaving SC-001's real
  five-framework validation to Wave 3 alone — partially adopted (R10) but 004 still owes
  its own interface-parameterized corpus.
