# Phase 0 Research: Task Discovery and Framework Adapters

**Feature**: `003-task-discovery-framework-adapters` | **Date**: 2026-10-22

All Technical Context items are resolved — the spec, constitution v1.0.0, and the frozen 002
contracts answered every open question during planning (no NEEDS CLARIFICATION remained). This
document records each design decision as Decision / Rationale / Alternatives considered. The
normative adapter conventions are sourced from `specs/requirements.md` Requirement 7
(acceptance criteria 1–10), relocated to this spec as FR-007–FR-011 with `(001 FR-022…026)`
citations.

## R1 — Module placement and public surface

- **Decision**: One new module directory `src/discovery/` with internal subdirectory
  `src/discovery/adapters/`; published as the additive subpath export `"./discovery"`
  (types-first condition). The public barrel exports exactly: `discoverTaskFiles`,
  `discoverGitContext`, `canonicalizeRepositoryRoot`, `verifyInsideRoot`, `createAdapterRegistry`,
  `selectAdapter`, `agentHookScaffold`, the built-in adapter table `builtInAdapters`, the types
  `FrameworkAdapter`, `AdapterConventions`, `CustomAdapterDescriptor`, `DiscoveryOverrides`,
  `DiscoveryOptions`, `DiscoveryResult`, `DiscoveredFile`, `GitContext`, `Refusal`,
  `DiscoveryDiagnostic`, `DiscoveryRootError`, `FrameworkIdentity`, `isBuiltInFrameworkId`.
- **Rationale**: 002's plan.md pre-names `src/discovery` as this feature's Wave-2 sibling
  module; one disjoint directory and one disjoint `exports` key keep Wave-2 conflict-free (the
  `package.json` edit is one added key; existing keys are never modified, and
  `tests/contract/package-surface.test.ts` only asserts existence of its listed subpaths, so it
  stays green). 004 gets exactly one import site: `task-linear-sync/discovery`.
- **Alternatives considered**: separate top-level `src/adapters/` + `src/discovery/` with two
  subpath exports — rejected: two shared-file keys and two barrels for one cohesive slice, and
  002's module list names only `src/discovery`; relative intra-package imports with **no**
  exports entry — rejected: violates 002's rule that modules are consumed "only through this
  package's declared subpath exports" and leaves 004's dependency invisible to packaging.

## R2 — Task-file and skip-directory pattern matching (zero dependencies)

- **Decision**: A minimal matcher in `src/discovery/patterns.ts` supporting exact names and
  basename/dir-name glob syntax: `*` (any run of characters, never crossing `/`), `?` (single
  character), `[abc]`/`[a-z]`/`[!x]` classes; case-sensitive matching; compiled once per
  discovery run. Task-file patterns match the file **basename**; skip-directory patterns match
  the directory **name** at any depth (001 R1.3: "skip every directory whose name matches the
  configured skip set").
- **Rationale**: The frozen config defaults are literal basenames (`tasks.md`, `TASKS.md`) and
  literal names (`.git`, `node_modules`, …), but `ResolvedConfig.taskFilePatterns` is documented
  "Basename glob/pattern list" — so glob support is in-contract. A ~60-line compiler keeps the
  zero-runtime-dependency ceiling (constitution "Technology stack": "runtime dependencies
  limited to Node built-ins plus exactly one platform transport dependency").
- **Alternatives considered**: `minimatch`/`picomatch` dep — rejected: violates the dependency
  ceiling for a capability this small; full regex sources in config — rejected as the primary
  form (config-file JSON with raw regex is error-prone and the frozen defaults are plain
  names); regex *remains* the form for grammars (heading/phase/summary/rollup), which are
  documented "regex sources" in the frozen schema and consumed by 004, not by discovery.

## R3 — Traversal strategy and symlink policy

- **Decision**: Single-pass recursive `fs.opendir` walk (`withFileTypes`) with `lstat` fallback
  for unknown entry types. Any entry whose `lstat` says symlink is excluded from results and
  never descended into — without aborting the walk (001 R1.4: "SHALL neither traverse
  symbolic-linked directories nor include symbolic-linked files"). Because symlinks are never
  followed, cycles are structurally impossible. Directories are visited in sorted order for
  reproducible diagnostics; results are finally sorted lexicographically on the root-relative
  POSIX path string (byte comparison), which makes the final order independent of OS readdir
  order entirely.
- **Rationale**: FR-003 mandates both symlink exclusion AND pre-read verification; exclusion at
  traversal is what makes "0 reads outside the canonical root" (SC-003) *structurally* true,
  with R4's guard as defense-in-depth against TOCTOU and platforms with unreliable `d_type`.
  Final-string sorting satisfies FR-004/SC-002 ("byte-for-byte identical, lexicographically
  ordered") regardless of traversal order.
- **Alternatives considered**: `fs.glob`/`glob()` — rejected: follows symlinked directories by
  default (FR-003 violation) and hides the refusal diagnostics we must emit; `fast-glob` dep —
  rejected: dependency ceiling; realpath-every-entry filtering — rejected: follows links during
  resolution, contradicting "neither traverse symbolic-linked directories", and costs an extra
  syscall per entry when lstat already decides.

## R4 — Canonical root and the pre-read escape guard (FR-001–003)

- **Decision**: `canonicalizeRepositoryRoot(root)` → `fs.realpath` + `path.resolve`: absolute,
  relative segments and symlinks resolved (FR-001). Pre-flight stat: does not exist / is not a
  directory / not readable (`R_OK` probe) → throw `DiscoveryRootError` with
  `condition: "missing" | "not-a-directory" | "unreadable"` naming the failing condition,
  before any traversal or file read (FR-002). `verifyInsideRoot(canonicalRoot, candidate)`:
  `fs.realpath` the candidate and require `resolved === root || resolved.startsWith(root + sep)`
  — a separator-bounded prefix compare, so the sibling-with-common-prefix path
  (`/work/repo-evil` vs `/work/repo`) is correctly refused. Exports (from `src/discovery`) for
  reuse by 004/008 read paths.
- **Rationale**: FR-003: "MUST verify before every file read that the resolved path is inside
  the canonical root, refusing and reporting escapes"; the guard is a separately exported
  primitive so the "before every file read" obligation is a one-call habit for every later
  reader, not logic buried in traversal. The boundary check prevents the classic
  `startsWith` prefix bug. Refusals accumulate in `DiscoveryResult.refusals`
  (`{ path, reason: "escape" }`, root-relative where representable) while discovery continues
  (FR-003, edge case "Sandbox escape").
- **Alternatives considered**: `path.relative`-non-empty-negative check — rejected: depends on
  both inputs being canonical and is fiddly across drive roots; inode-boundary checks —
  rejected: no better than realpath containment and non-portable.

## R5 — Custom-adapter identity vs the frozen `FrameworkId` union

- **Decision**: 003 defines locally: `FrameworkIdentity = FrameworkId | (string &
  Record<never, never>)` plus `isBuiltInFrameworkId(s): s is FrameworkId` guard. The
  `FrameworkAdapter.id` and `DiscoveredFile.frameworkId` use `FrameworkIdentity`; built-in
  adapters keep the five frozen literal values, so every built-in flow is 100% assignable to the
  frozen `TaskFile.frameworkId` / `FrameworkMetadata.frameworkId` fields 004/008 populate.
  `frameworkMetadataFragment(discovered)` returns the frozen `FrameworkMetadata` field set
  (`frameworkId`, `featureName?`, `filePath`; `localTaskId?` appears post-parse in 004) — for
  custom adapters the widened identity flows through as a plain string at runtime (JSON
  serialization is type-independent). The type-level widening of the 002 union itself is
  recorded here as an **amendment candidate noted against 001** (ROADMAP rule 2) — deliberately
  NOT executed in this feature.
- **Rationale**: FR-011 requires custom adapter ids beyond the five built-ins; 002 § 3 freezes
  the *member list* of the adapter interface and explicitly says "003 implements, 004 consumes
  the *interface* only" — the interface's home is therefore 003's module, and the member table
  (§3: `id | FrameworkId`) is honored for all built-ins while FR-011's mandated sixth-and-beyond
  ids are typed additively. No frozen file is edited; 004's `generic`-fixture usage is
  union-clean.
- **Alternatives considered**: editing `FrameworkId` in `src/domain/task.ts` — rejected: ROADMAP
  rule 2 / amendment-only (and my task scope forbids it); mapping custom adapters' tasks to
  `frameworkId: "generic"` — rejected: violates FR-009 ("record the framework identity … on every
  discovered task") by erasing the custom identity; blocking custom adapters until an amendment
  lands — rejected: FR-011/SC-004 are normative acceptance, not future work.

## R6 — Git context without `child_process` (FR-006)

- **Decision**: `src/discovery/git.ts` reads the working tree's git metadata **from files**:
  resolve `.git` (directory, or one-level `gitdir: <path>` gitfile indirection); `HEAD` →
  either `ref: refs/heads/<branch>` (branch name + loose ref `refs/heads/<branch>`, falling
  back to `packed-refs` lookup for the commit id) or a literal commit id (detached HEAD);
  origin URL from `.git/config` `[remote "origin"]` `url` line. Each of the three values
  (headCommit, branch, originRemote) is omitted **individually** when its source file is
  missing/unparsable — never failing the others (FR-006: "individually omitting unavailable
  values without failing"). Traversal's skip of `.git` is unaffected — this is an explicit,
  bounded metadata read of five known files, not a tree walk.
- **Rationale**: Determinism + hermetic tests: synthetic `.git` fixture directories (loose-ref,
  packed-refs, detached-HEAD, no-remote variants) exercise every branch with zero external
  binaries; CI runners don't need `git` on PATH; byte-identical results per commit (Principle
  IV). Constitution limits runtime deps; a CLI/dep would add a failure mode the spec's SC
  forbids ("without failing").
- **Alternatives considered**: `git rev-parse HEAD` / `git symbolic-ref` / `git remote get-url
  origin` via `child_process` — rejected: nondeterministic availability (shallow clones, CI
  containers, `GIT_DIR` env), nondeterministic diagnostics text, untestable without spawning
  real git; isomorphic-git dep — rejected: dependency ceiling; libgit2 bindings — rejected:
  native dependency, far beyond need.

## R7 — Override channels inside the frozen configuration model

- **Decision**: Three-layer resolution, merged with 002's exported `deepMerge` (arrays/scalars
  replace wholesale), precedence exactly constitution III ("built-in defaults, then config
  file, then programmatic overrides"):
  1. **Built-in adapter table** (defaults for every convention, FR-007);
  2. **Frozen config keys** — the already-frozen `ResolvedConfig` discovery group
     (`frameworkAdapters` enabled set, `taskFilePatterns`, `specsBaseDirectories`,
     `skipDirectories`, `siblingDocuments`) and grammar group (`headingIdGrammar`,
     `phasePattern`, `summaryPattern`, `rollupPattern`) plus `titleStripPrefixes` and
     `agentHooksDirectory` ("Per-framework default supplied by adapters (003)" — the frozen
     schema comment) act as the config-file layer, applied to all enabled adapters when set
     (whole-array replacement per R3-merge semantics);
  3. **003-local programmatic layer** `DiscoveryOverrides` (highest): `selection` (fixed id or
     predicate), `precedence` (adapter id list), per-adapter `adapters: Record<string,
     Partial<AdapterConventions>>`, and `customAdapters: CustomAdapterDescriptor[]`.
  No new keys are added to `ResolvedConfig` (frozen). Custom adapter minimum contract —
  "at least an id, path/base-directory patterns, and heading grammar" (FR-011) — validated on
  registration; a typed `CustomAdapterError` lists every missing required part at once (002
  fail-fast-and-complete precedent).
- **Rationale**: Satisfies SC-004 ("Every adapter convention is demonstrably overridable … a
  fixture suite overrides each convention at least once") while keeping 002's config schema
  untouched: the frozen model already carries the global form of most conventions, and the
  per-adapter/programmatic layer covers the rest (detection markers, precedence, selection,
  feature extraction, custom adapters).
- **Alternatives considered**: extending `ResolvedConfig` with an `adapterOverrides` group —
  rejected: amendment to a frozen contract, out of scope (ROADMAP rule 2); functions-only
  override API (no declarative records) — rejected: unmergeable and non-serializable for a
  future config-file amendment; per-convention environment variables — rejected: not the
  constitution's merge model.

## R8 — Detection model, ranking algorithm, and per-file context

- **Decision**: Detection consumes a `DetectionContext { repoRelativePosixPath,
  directoryEntries (non-symlink regular-file basenames in the same directory, from one
  `lstat`-filtered listing shared with sibling resolution, R9) }`. Each adapter's declarative
  `detection` markers — `pathPrefixes`, `pathContains`, `siblingsAnyOf`, and the conjunctive
  `requirePathAndSiblings` flag (spec-kit: beneath `specs/`/`spec/` **and** sibling `spec.md`
  or `plan.md`, per 001 R7.2) — produce a `DetectionMatch { adapterId, matchedPattern, via }`.
  **Ranking** when ≥2 adapters match, exactly per FR-008: (1) longest matching path/base-directory
  pattern wins (by `matchedPattern.length`; a siblings-only match contributes length 0);
  (2) position in the **precedence list** — built-in default `["kiro", "open-spec", "spec-kit",
  "bmad", "generic"]`, which *is* the spec's stated deterministic precedence "kiro markers →
  open-spec markers → spec-kit markers → bmad markers → generic fallback", overridable per
  FR-011 ("override … adapter precedence"); (3) alphabetical by adapter id. Zero matches →
  `generic` fallback (with only global summary/rollup exclusions — FR-010). An explicit
  `overrides.selection` (fixed id or predicate) short-circuits detection entirely. The winning
  `DetectionMatch` plus the sorted candidate list is recorded on every `DiscoveredFile.detection`
  for downstream transparency (006's framework scoring signal).
- **Rationale**: The two sentences of FR-008 are reconciled by treating the fixed kiro-first
  marker order as the *built-in configured precedence* (one overridable slot) rather than a
  separate stage — otherwise "longest pattern" could never discriminate a `.kiro/specs/` path
  that also matches spec-kit's `specs/` marker. Pattern-length-first also matches 001 R7.3
  ("longest matching configured path or base-directory pattern, then the configured adapter
  precedence, then deterministic alphabetical tie-break"). `.kiro/specs/` (12 chars) beating
  `specs/` (6) makes Kiro layout robust before any precedence arithmetic.
- **Rationale for the frozen default `frameworkAdapters` list**: the 002 default
  `["bmad","spec-kit","open-spec","kiro","generic"]` is read as the **enabled set +
  enumeration** (its order is inventory, not detection precedence — using it as precedence
  would select spec-kit over kiro on `.kiro/specs/` paths with spec.md siblings, contradicting
  FR-008 and the Kiro-preservation FR-010).
- **Alternatives considered**: fixed marker order alone — rejected: ignores the mandatory
  longest-pattern rule; `frameworkAdapters` order as precedence — rejected (above): contradicts
  the spec's explicit kiro-first precedence with the frozen default value; first-match-by-
  registration-order with early exit — rejected: nondeterministic w.r.t. adapter registration.

## R9 — Sibling documents and `Feature_Name` extraction (FR-005, FR-007)

- **Decision**: One directory listing per discovered file's directory (regular non-symlink files
  only) serves both detection (`siblingsAnyOf`) and sibling resolution. Effective sibling list =
  the adapter's convention (built-in table per 001 R7.5: kiro `requirements.md`/`design.md`;
  spec-kit `spec.md`/`plan.md`/`requirements.md`; open-spec `spec.md`/`proposal.md`/`tasks.md`;
  bmad `requirements.md`/`design.md`/`architecture.md`/`prd.md`/`spec.md`; generic = configured
  `siblingDocuments`) under R7's merge precedence. Present siblings are returned as
  root-relative POSIX paths; absent ones omitted **without error** (FR-005). `Feature_Name`
  extraction is declarative per adapter — `parent-dir` (immediate parent beneath a base
  directory: kiro, spec-kit, generic), `parent-or-basename` (bmad), `segment-after` markers
  (`openspec/`, `changes/`, `specs/`: open-spec) — with an optional programmatic
  `featureName(path) => string | undefined` override; absent when no segment can be derived
  (undefined, never an error).
- **Rationale**: Declarative kinds are serializable, unit-testable per framework, and cover
  every row of the 001 R7.5 table; the function override keeps FR-011's "override …
  `Feature_Name` extraction behavior" total. Listing once per directory amortizes I/O and keeps
  detection and sibling results consistent within a run (determinism).
- **Alternatives considered**: per-adapter free functions as the only mechanism — rejected:
  conventions would be opaque to the contract test and override merging; walking sibling
  documents through the traversal (collect-all-then-join) — rejected: needs a second full walk
  for files (`spec.md`) the traversal never matches; directory listings are the single, cheap
  source.

## R10 — Error model, refusals, and partial-failure posture

- **Decision**: Three tiers. (1) **Abort**: only root conditions — `DiscoveryRootError` with the
  named failing condition, thrown before any read (FR-002). (2) **Refusal**: escape detections —
  recorded `{ path, reason: "escape" }` in `DiscoveryResult.refusals`, no read performed,
  discovery continues (FR-003/edge case). (3) **Diagnostic**: unreadable *sub*directories and
  unreadable `.git` sources — recorded `{ path, condition }` in `DiscoveryResult.diagnostics`,
  traversal continues (only the *root* aborts per FR-002's letter); symlink entries are
  silently excluded per 001 R1.4 (exclusion "without aborting the walk", no report mandated —
  refusals are reserved for escape violations). All three arrays are deterministically ordered
  (lexicographic by path) so SC-002 byte-identity covers failures too.
- **Rationale**: Matches the spec's exact abort/report/omit vocabulary per requirement, and the
  "Independent Test" promise to "assert path sets, ordering, exclusions, and error text". A
  per-subdirectory abort would make an unchanged repo nondeterministic across permission
  changes; an empty diagnostics channel would hide real environment problems.
- **Alternatives considered**: throwing on the first refusal — rejected: FR-003 explicitly says
  discovery continues for remaining files; logging to stderr — rejected: untestable, nondeterministic
  ordering; reporting every skipped symlink as a refusal — rejected: 001 R1.4 treats symlink
  exclusion as routine, and flooding refusals would drown true escape violations.

## R11 — Agent-hook template behavior (FR-007, FR-010; consumed by 010)

- **Decision**: Adapters declare `agentHooksDirectory?` and `agentHookTemplate: "kiro-json" |
  "none"`. `agentHookScaffold(adapterId, { binName })` (exported) returns a declarative record
  `{ directory, fileName, contents }` for a Kiro hook-definition JSON whose `command` action
  invokes `<binName> enqueue` (binName derives from `toolId` per the frozen config), i.e., the
  001 Glossary `Agent_Hook` contract: ".kiro/hooks/*.json files whose `command` action can
  invoke the enqueue entry point". Defaults: kiro → `.kiro/hooks/`, generic →
  `.task-linear-sync/hooks/` (per 001 Glossary `Agent_Hooks_Directory`), others → absent
  (`advertised: false`). 003 only *describes* the scaffold — it writes nothing; 010 owns
  scaffolding behavior.
- **Rationale**: "Provides to: 010 (agent-hook template behavior for Kiro/generic defaults)" —
  a pure function of adapter + config keeps Kiro compatibility advertised (US2 AC3, FR-010)
  without any file writes in a read-only feature; zero org literals (`task-linear-sync` derives
  from `toolId`, overridable).
- **Alternatives considered**: 003 scaffolding hook files itself — rejected: violates the
  read-only posture and 010's ownership; embedding full JSON templates in the discovery result
  for every file — rejected: irrelevant to discovery consumers, wasted coupling.

## R12 — Test strategy, fixtures, and the 004 drift guard

- **Decision**: (a) **Committed static fixtures** (regular files only, portable across git):
  `tests/fixtures/repos/discovery/five-frameworks/` (all five layouts at multiple depths +
  adversarial look-alikes: `notes/tasks.md` generic, `docs/tasks.md` bmad-adjacent, a
  `.kiro/specs/<feature>/tasks.md` with competing `specs/`-substring), `empty/`,
  `no-task-files/`, and git variants `git-loose/`, `git-packed/`, `git-detached/`,
  `git-no-remote/`, `git-none/`. (b) **Runtime temp-tree fixtures** for symlink loops,
  escaping symlinks, symlinked task files/directories, unreadable root/subdir (chmod 000),
  built by `tests/helpers/discovery-fixtures.ts` under a temp dir with guaranteed cleanup
  (git checkout cannot transport loops/modes reliably; 002 created its unreadable-file fixture
  the same way). (c) A **contract surface snapshot** `tests/contract/discovery-surface.test.ts`
  mirroring 002's frozen-surface pattern (R15): the exact exported-name set of `src/discovery`,
  seeded from `contracts/*.md` — any drift fails; amendments update the snapshot deliberately
  with a note against 001. (d) Determinism proof: run discovery twice over the same fixture and
  byte-compare serialized `DiscoveryResult` (SC-002); escape proof: an open-counting wrapper
  (injected via an options hook used only by tests, default = `node:fs`) asserts 0 opens outside
  the root across the adversarial set (SC-003). POSIX-conditional skip for permission cases
  (002 precedent).
- **Rationale**: Principle VI requires every acceptance criterion enforced; the snapshot makes
  "004 codes against the 003 interface" a compile-*and*-test enforced dependency; runtime
  fixtures are the only hermetic way to exercise symlinks/permissions identically on CI.
- **Alternatives considered**: committing symlink fixtures via git — rejected: Windows checkout
  and `core.symlinks` variance make them flaky; using `/tmp` directly — rejected: prefer
  `node:os.tmpdir()` + feature-scoped subdir for cleanup determinism; snapshot-testing file
  *contents* of built-in adapters — rejected: over-constrains internals; the surface + behavior
  contract tests are the seam.

## Resolved unknowns summary

| Question | Resolution |
|---|---|
| Where does 003 live; how do 004+ consume it? | `src/discovery/` module, `./discovery` subpath export (R1) |
| Glob matching without dependencies? | 60-line basename/dir matcher, `* ? [..]` (R2) |
| Symlinks and loops safely? | lstat-exclude at traversal, never follow; final string sort (R3) |
| Escape refusal semantics? | realpath containment, separator-bounded, exported guard, continue + report (R4) |
| Custom adapter ids vs frozen `FrameworkId`? | 003-local `FrameworkIdentity` widening; amendment candidate noted, no frozen edit (R5) |
| Git context source? | File-based `.git` reads (HEAD/refs/packed-refs/config), individual omission (R6) |
| How are conventions overridden with 002 config frozen? | built-in table → frozen config keys → programmatic `DiscoveryOverrides`, `deepMerge` semantics (R7) |
| Detection tie-breaking? | longest matched pattern → overridable precedence (built-in kiro-first) → alphabetical (R8) |
| Siblings + Feature_Name? | one listing per dir; declarative extraction kinds + function override (R9) |
| Failure posture? | abort (root) / refusal (escape) / diagnostic (subdir, git), all ordered (R10) |
| Kiro hooks scaffold? | pure `agentHookScaffold` record; 010 writes (R11) |
| How is everything proven? | static + runtime fixtures, surface snapshot, double-run byte-compare, open-counting (R12) |
