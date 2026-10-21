# Feature Specification: Task Discovery and Framework Adapters

**Feature Branch**: `003-task-discovery-framework-adapters`

**Created**: 2026-10-21

**Status**: Draft

**Input**: Decomposition of `specs/001-extract-functional-requirements/spec.md` (clarification session 2026-10-21). Absorbs 001 group A (Repository task discovery, source R1) and group D (Framework adapters, source R7).

## Purpose and Scope

Finds every task file in a repository, safely and deterministically, identifies which
spec-driven framework produced it, and ships the built-in and custom adapter
conventions that every downstream feature (parsing, matching, rendering, hooks)
consumes. This is a Wave-2 feature: buildable fully in parallel with 004–007 once the
002 contracts are frozen, with no tracker dependency.

**Owns**: discovery traversal and safety; framework detection precedence; adapter
conventions (patterns, grammars, feature-name extraction, sibling docs, strip prefixes,
agent-hook template behavior).

**Consumes from 002**: configuration model; Task File and Framework Adapter entity shapes.

**Provides to**: 004 (discovered files + adapter to parse with), 006 (framework
metadata for scoring), 008 (framework metadata persisted in synced state), 010
(agent-hook template behavior for Kiro/generic defaults).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Safe, deterministic discovery (Priority: P1)

A developer points the tool at a repository; every matching regular task file beneath
the root is found at any depth, excluded directories and symlinks are skipped, escapes
beyond the canonical root are refused and reported, and results arrive as root-relative
POSIX paths in deterministic lexicographic order — an empty result (not an error) for
repositories with no task files.

**Why this priority**: Nothing downstream runs without discovery; its safety and
determinism guarantees are the foundation of every later run.

**Independent Test**: Point discovery at fixture repositories covering all five
framework layouts plus adversarial fixtures (symlink loops, escaping links, unreadable
root, empty repo) and assert path sets, ordering, exclusions, and error text — no parser
or tracker required.

**Acceptance Scenarios**:

1. **Given** a repository with task files under framework-typical directories, **When**
   discovery runs, **Then** every matching regular file under the configured patterns is
   found to unlimited depth, skipping excluded directories and symlinked entries, and
   returned as root-relative POSIX paths in deterministic lexicographic order.
2. **Given** an empty repository or one with no matching task files, **When** discovery
   runs, **Then** an empty result is returned without error.
3. **Given** a root that is missing, not a directory, or unreadable, **When** discovery
   runs, **Then** it aborts with no file reads and an error naming the failing
   condition.
4. **Given** a discovered path that resolves outside the canonical root, **When** the
   pre-read verification runs, **Then** the path is excluded/refused, reported, and
   discovery continues for remaining files.
5. **Given** a git repository, **When** discovery completes, **Then** HEAD commit
   identifier, current branch, and origin remote URL are reported, with individually
   unavailable values omitted without failing.

### User Story 2 - Framework identification and adapter conventions (Priority: P2)

Each discovered file is associated with a framework identity — one of the built-in
adapters (`bmad`, `spec-kit`, `open-spec`, `kiro`, `generic`) or a consumer-supplied
custom adapter — chosen by deterministic marker-based precedence, with every adapter
convention overridable.

**Why this priority**: Adapters parameterize all later behavior, but discovery itself
must work before any particular adapter's conventions matter.

**Independent Test**: Fixture trees with competing and unambiguous markers; assert the
selection order, longest-pattern precedence, alphabetical tie-break, generic fallback
with only global exclusions applied, Kiro compatibility behaviors, and full override of
every convention including a minimal custom adapter (id, path patterns, heading
grammar).

**Acceptance Scenarios**:

1. **Given** a file path and sibling-document markers, **When** automatic selection
   runs, **Then** the framework is inferred with deterministic precedence (kiro →
   open-spec → spec-kit → bmad → generic fallback); on multiple matches, by longest
   matching path/base-directory pattern, then configured precedence, then alphabetical
   tie-break.
2. **Given** the generic adapter selected, **When** parsing conventions are read,
   **Then** no framework-specific exclusions beyond the global summary/rollup defaults
   apply.
3. **Given** a Kiro layout (`.kiro/specs/*/tasks.md`), **When** discovery and feature
   derivation run, **Then** files are found, the feature directory is used as
   `Feature_Name`, and `.kiro/hooks/` scaffold support is advertised.
4. **Given** a consumer override of framework selection, adapter precedence, or any
   adapter convention, **When** runs execute, **Then** the override wins, and a custom
   adapter configuration supplying at least id, path/base-directory patterns, and
   heading grammar is accepted.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001** (001 FR-001): System MUST canonicalize a supplied repository root to an
  absolute, link-resolved path and recursively locate every regular file whose name
  matches the configured task-file patterns, to unlimited depth.
- **FR-002** (001 FR-002): System MUST abort discovery with no file reads and a specific
  error when the root does not exist, is not a directory, or is not readable.
- **FR-003** (001 FR-003): System MUST skip configured skip-directories, MUST NOT
  traverse or report symlinked directories or files, and MUST verify before every file
  read that the resolved path is inside the canonical root, refusing and reporting
  escapes.
- **FR-004** (001 FR-004): System MUST return results as root-relative POSIX paths in a
  deterministic lexicographic order, and MUST return an empty (not error) result when no
  task files exist.
- **FR-005** (001 FR-005): System MUST associate each discovered file with a framework
  identity (per FR-006…FR-010) and locate configured sibling specification documents in
  the same directory, omitting absent siblings without error.
- **FR-006** (001 FR-006): System MUST report available version-control context (HEAD
  commit identifier, current branch, origin remote URL), individually omitting
  unavailable values without failing.
- **FR-007** (001 FR-022): System MUST ship built-in adapters for `bmad`, `spec-kit`,
  `open-spec`, `kiro`, and `generic`, each supplying task-file patterns, base
  directories, detection rules, `Feature_Name` extraction, heading/checklist grammar,
  phase/summary/rollup patterns, sibling-document names, default title strip prefixes,
  and optional agent-hook template behavior.
- **FR-008** (001 FR-023): Under automatic selection, System MUST infer the framework
  from path and sibling-document markers with deterministic precedence (kiro markers →
  open-spec markers → spec-kit markers → bmad markers → generic fallback), and when
  multiple adapters match, MUST select by longest matching path/base-directory pattern,
  then configured precedence, then alphabetical tie-break.
- **FR-009** (001 FR-024): System MUST record the framework identity and framework
  metadata on every discovered task and persist them in the synced state payload.
- **FR-010** (001 FR-025): System MUST apply no framework-specific exclusions beyond the
  global summary/rollup defaults when the generic adapter is selected, and MUST preserve
  Kiro compatibility (`.kiro/specs/*/tasks.md` discovery, feature directory as
  `Feature_Name`, `.kiro/hooks/` scaffold support).
- **FR-011** (001 FR-026): Consumers MUST be able to override framework selection,
  adapter precedence, and every adapter convention above, and to supply a custom
  adapter configuration providing at least an id, path/base-directory patterns, and
  heading grammar.

### Edge Cases

- **Invalid repository root** (001 edge case): root missing, not a directory, or
  unreadable → discovery aborts with no file reads and an error naming the failing
  condition.
- **Sandbox escape** (001 edge case): a discovered or addressed path resolves outside
  the canonical repository root → the path is excluded/refused, reported, and discovery
  continues for the remaining files.

## Key Entities

**Task File** (owned): repository Markdown file matching configured name patterns,
associated with a framework identity and sibling specification documents.
**Framework Adapter** (owned): per-framework convention bundle (patterns, grammars,
extraction rules, defaults) governing discovery, parsing, rendering, and naming.
Shapes defined in 002; behavior owned here.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001** (part of 001 SC-002): 100% of task files in a fixture repository containing
  all five supported framework layouts are discovered and associated with the correct
  framework identity and sibling documents; 0 missed, 0 false.
- **SC-002**: Two consecutive discovery runs over an unchanged repository produce
  byte-for-byte identical, lexicographically ordered path lists (determinism).
- **SC-003**: 0 reads occur outside the canonical root across the adversarial symlink /
  escape fixture set; every escape attempt is reported and traversal continues.
- **SC-004**: Every adapter convention is demonstrably overridable: a fixture suite
  overrides each convention at least once and observes the override take effect.

## Assumptions

- Task-file name patterns, skip-directories, and adapter marker sets default per the
  built-in adapter table and remain overridable (constitution Principle III).
- Parsing of discovered files is owned by 004; this spec stops at file-level results,
  framework identity, and conventions.
- The 002 contracts (Task File / Framework Adapter shapes, configuration model) are
  frozen before implementation begins.
