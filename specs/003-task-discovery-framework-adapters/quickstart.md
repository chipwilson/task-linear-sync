# Quickstart: Validating Task Discovery and Framework Adapters

Validation guide for `specs/003-task-discovery-framework-adapters` — proves the feature works
end-to-end without implementing anything ahead of `tasks.md`. Field details:
[data-model.md](./data-model.md); contract details: [contracts/](./contracts/README.md);
decisions: [research.md](./research.md).

## Prerequisites

- Node.js ≥ 20.0.0 (constitution engine floor).
- npm with a lockfile (`package-lock.json` committed; pipeline installs with `npm ci`).
- **No Linear credentials, no network, no `git` binary required** (git context is read from
  `.git` files, research R6), no real organization identifiers anywhere in fixtures
  (Constitution VI / hermetic pipelines). Static fixtures live under
  `tests/fixtures/repos/discovery/` with placeholder names only; symlink/permission fixtures are
  built at test runtime under a temp directory (`tests/helpers/discovery-fixtures.ts`) with
  guaranteed cleanup.
- POSIX-permission-dependent cases (unreadable root/subdir via chmod 000) are conditionally
  skipped on non-POSIX runners (002 quickstart precedent).

## Setup

```bash
npm ci
npm run build          # tsc: ESM + .d.ts incl. new src/discovery/
npm run typecheck      # tsc --noEmit over src + tests
```

## Test tiers

```bash
npm run test:unit        # discovery-patterns, -root, -traverse, -git, -selection, -adapters-builtin, -overrides
npm run test:contract    # discovery-surface snapshot + adapter-contract validation + 002 suites (must stay green)
npm run test:integration # discovery.test.ts + discovery-adapters.test.ts
npm run test:e2e         # discovery-user-stories.test.ts walkthrough
npm test                 # all tiers + coverage threshold gate
```

Import surface for consumers (what 004 sees): `import { type FrameworkAdapter, builtInAdapters }
from "task-linear-sync/discovery"` — the `./discovery` subpath export added by this feature.

## Validation scenarios

### US1 — Safe, deterministic discovery (P1) 🎯 MVP

Run: `npm run test:unit -- --test-name-pattern "discovery" && npm run test:integration -- --test-name-pattern "discovery"`

Fixtures: `five-frameworks/` (all five layouts, multiple depths, look-alike traps), `empty/`,
`no-task-files/`, git variants; runtime temp trees for symlinks/permissions.

| # | Scenario (spec AC) | Test | Expected |
|---|---|---|---|
| 1 | Files found at unlimited depth, skips + symlinks excluded, POSIX-relative lexicographic order | `discovery traverse` + integration path-set asserts | Every pattern-matching regular file returned root-relative POSIX in byte-wise order; `.git`/`node_modules`/`dist`/`.next`/`coverage` subtrees absent; symlinked files/dirs absent; results complete (AC1) |
| 2 | Empty / no-task-files repo | `discovery empty` | `files: []`, zero errors (FR-004, AC2) |
| 3 | Missing / not-a-directory / unreadable root | `discovery root` | `DiscoveryRootError` naming each failing condition; open-counting probe records **0** reads (FR-002, AC3) |
| 4 | Escaping symlink | `discovery escape` | Refusal `{ path, reason: "escape" }` recorded, 0 opens outside canonical root, remaining files still discovered (FR-003, AC4, SC-003) |
| 5 | Symlink loop | `discovery symlink-loop` | Terminates; loop members absent from results; no hang (001 R1.4) |
| 6 | Determinism | `discovery determinism` | Two runs → byte-for-byte identical serialized `DiscoveryResult` incl. refusal order (SC-002) |
| 7 | Git context matrix | `discovery git` | loose-ref → commit+branch+origin; packed-refs → commit resolved; detached → commit only; no-remote → origin omitted; missing `.git` → all omitted, zero throws; each case never fails the run (FR-006, AC5) |
| 8 | Sibling docs | `discovery siblings` | Existing configured siblings listed root-relative; absent omitted without error (FR-005) |

### US2 — Framework identification and adapter conventions (P2)

Run: `npm run test:unit -- --test-name-pattern "selection|adapters|overrides" && npm run test:integration -- --test-name-pattern "adapters"`

| # | Scenario (spec AC) | Test | Expected |
|---|---|---|---|
| 1 | Detection precedence & rank | `discovery selection` matrix | kiro wins under `.kiro/` even when `specs/` substring matches spec-kit; `.kiro/specs/` (longer pattern) beats `specs/`; spec-kit needs path AND `spec.md`/`plan.md` sibling else falls through; open-spec/bmad path-or-sibling markers; equal-length tie → precedence list order → alphabetical; zero matches → generic fallback (FR-008, AC1) |
| 2 | Generic purity | `discovery adapters-builtin` | `builtInAdapters.generic.frameworkSpecificExclusions` is `[]` — no framework-specific exclusions beyond global summary/rollup defaults (FR-010, AC2) |
| 3 | Kiro compatibility | `discovery adapters` on `.kiro/specs/<feature>/tasks.md` fixture | Discovered; `featureName === <feature>`; `agentHookScaffold("kiro", binName)` returns `.kiro/hooks/` record whose command runs `<binName> enqueue`; scaffold writes nothing (FR-010, AC3) |
| 4 | Overrides win | `discovery overrides` matrix | Each convention (selection, precedence, taskFilePatterns, baseDirectories, detection, headingGrammar, phase/summary/rollup, feature rule, strip prefixes, siblings, agent-hooks dir/template) overridden at least once and the override observed effective (FR-011, AC4, SC-004) |
| 5 | Minimal custom adapter | `adapter contract` | `{ id: "my-flow", taskFilePatterns: ["todo-*.md"], baseDirectories: ["flows/"], headingGrammar: "T\\d{3}" }` accepted, selectable, wins on its markers; incomplete descriptor aborts naming **every** missing required part (FR-011) |
| 6 | Identity recorded | `discovery adapters` SC-001 | 100% correct `frameworkId` + `featureName` + siblings across the five-framework repo — 0 missed, 0 false; `frameworkMetadataFragment()` field set matches frozen 002 `FrameworkMetadata` for built-ins (FR-005, FR-009, SC-001) |
| 7 | 004's seam frozen | `npm run test:contract` → `discovery surface` | Exported-name snapshot of `src/discovery` matches; `builtInAdapters` keys === five frozen `FrameworkId`s; amendments update snapshot deliberately with a note against 001 |

### Cross-feature safety checks

1. **002 frozen contracts untouched**: `tests/contract/frozen-surface.test.ts`,
   `package-surface.test.ts`, `defaults-scan.test.ts` (all from 002) stay green unmodified —
   this feature adds files and one additive `exports` key only.
2. **Zero org literals**: adapter table, scaffold template, and fixtures contain no real
   organization identifiers/tokens/UUIDs (constitution III; placeholder `acme`-style names in
   fixtures only).
3. **Zero writes**: after all discovery suites run, a walk of every fixture repo finds 0 created
   files/dirs (read-only posture, Principle I).

## Traceability

| Spec item | Covering tests |
|---|---|
| FR-001 canonicalize + unlimited depth | `discovery-root`, `discovery traverse`, `discovery.test.ts` path sets |
| FR-002 root abort, no reads | `discovery-root`, `discovery.test.ts` root matrix + open probe |
| FR-003 skips, symlinks, escape guard | `discovery traverse`, `discovery-root` boundary, `discovery escape`/`symlink-loop` |
| FR-004 order + empty-not-error | `discovery determinism`, `discovery empty` |
| FR-005 identity + siblings | `discovery siblings`, `discovery adapters`, `discovery selection` |
| FR-006 git context omission | `discovery git` matrix |
| FR-007 built-in adapter conventions | `discovery-adapters-builtin` (table per adapter), `agentHookScaffold` cases |
| FR-008 precedence + ranking | `discovery selection` matrix |
| FR-009 record + fragment | `discovery adapters` SC-001 + fragment shape |
| FR-010 generic purity + Kiro | `discovery adapters-builtin`, US2 scenarios 2–3 |
| FR-011 overrides + custom adapters | `discovery-overrides` matrix, `adapter contract` |
| SC-001 / SC-002 / SC-003 / SC-004 | US2 #6 / US1 #6 / US1 #3–4 / US2 #4 |

## Exit criteria for this feature

- All scenarios above green via `npm test` (all tiers + coverage threshold gate).
- `npm run build` emits `dist/discovery/**.js` + `.d.ts`; `./discovery` resolves with a
  types-first condition (root import for consumers: `task-linear-sync/discovery`).
- 002's contract suites green with **zero modifications** to 002-owned files (Wave-2 rule).
- Quickstart scenario record kept in the PR description or `tasks.md` completion notes.
