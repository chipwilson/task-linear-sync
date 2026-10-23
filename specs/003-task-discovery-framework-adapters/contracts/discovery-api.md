# Contract: Discovery API (`discoverTaskFiles`)

Modules: `src/discovery/discover.ts` (orchestration), `src/discovery/traverse.ts` (safe walk),
`src/discovery/root.ts` (canonicalization + guard), `src/discovery/patterns.ts` (matcher),
`src/discovery/git.ts` (VCS context), `src/discovery/types.ts`. Behavior decisions:
[../research.md](../research.md) R2–R6, R9, R10; fields: [../data-model.md](../data-model.md)
§1–§2. Owns 001 FR-001–006 (spec FR-001–FR-006) and the FR-005/FR-009 association step.

```ts
import type { ResolvedConfig } from "task-linear-sync/config";           // frozen 002
import type { DetectionContext, DiscoveryOverrides, FrameworkIdentity } from "./adapter.js";

export interface DiscoveredFile {
  readonly filePath: string;                 // root-relative POSIX, lexicographically sorted (FR-004)
  readonly frameworkId: FrameworkIdentity;   // built-ins are the frozen FrameworkId literals (FR-005/FR-008)
  readonly adapterId: string;
  readonly featureName?: string;             // adapter-derived; absent when underivable (never an error)
  readonly siblingDocuments: readonly string[];  // EXISTING configured siblings, same directory; absent omitted, no error (FR-005)
  readonly detection: import("./adapter.js").DetectionRecord;
}

export interface Refusal {                   // sandbox-escape posture (FR-003; 001 R1.5)
  readonly path: string;                     // root-relative where representable
  readonly reason: "escape";
}

export interface DiscoveryDiagnostic {       // non-root, non-escape partial failure (research R10)
  readonly path: string;
  readonly condition: string;                // e.g. "unreadable-directory", "unparsable-gitfile"
}

export interface GitContext {                // FR-006 (001 R1.10): individually omitted when unavailable
  readonly headCommit?: string;              // 40-hex from HEAD or resolved ref
  readonly branch?: string;                  // short ref name when HEAD is symbolic
  readonly originRemote?: string;            // [remote "origin"] url, verbatim
}

export class DiscoveryRootError extends Error {   // aborts with ZERO file reads (FR-002)
  readonly condition: "missing" | "not-a-directory" | "unreadable";
  readonly requestedPath: string;
}

export interface DiscoverOptions {
  readonly repositoryRoot: string;           // may be relative; canonicalized (FR-001)
  readonly config: ResolvedConfig;           // frozen 002 merged config, read-only input
  readonly overrides?: DiscoveryOverrides;   // 003 programmatic layer (highest precedence)
  readonly gitContext?: boolean;             // default true (FR-006)
  readonly openCountingProbe?: (absolutePath: string) => void;  // test-only open observer (SC-003 proof, research R12)
}

export interface DiscoveryResult {
  readonly root: string;                     // canonical absolute root actually used
  readonly files: readonly DiscoveredFile[]; // sorted; EMPTY (no error) when nothing matches (FR-004)
  readonly refusals: readonly Refusal[];     // escapes refused + reported (FR-003)
  readonly diagnostics: readonly DiscoveryDiagnostic[];
  readonly git?: GitContext;
}

/** THE discovery entry point. Read-only: zero writes, zero tracker calls. */
export function discoverTaskFiles(options: DiscoverOptions): Promise<DiscoveryResult>;
//   throws DiscoveryRootError  — root missing / not a directory / not readable, BEFORE any read (FR-002)

/** Root canonicalization: absolute, relative segments + symlinks resolved (FR-001). Reusable by 008 plan guards. */
export function canonicalizeRepositoryRoot(root: string): Promise<string>;

/**
 * Pre-read containment guard (FR-003). Separator-bounded: /work/repo-evil does NOT pass for
 * root /work/repo. REQUIRED before every repository file read — exported so 004 (parses
 * discovered files) and 008 (reads/writes state-relevant repo files) honor "verify before every
 * file read that the resolved path is inside the canonical root".
 */
export function verifyInsideRoot(canonicalRoot: string, candidateAbsolute: string): Promise<boolean>;

/** Standalone VCS context read (FR-006); never throws for availability reasons. */
export function discoverGitContext(canonicalRoot: string): Promise<GitContext>;

/** Basename/dir-name glob matcher (*, ?, [..]) — exported for config validation reuse (research R2). */
export function compileNamePattern(pattern: string): (name: string) => boolean;
```

## Behavior rules (normative)

1. **Canonicalize & pre-flight (FR-001, FR-002)**: resolve `repositoryRoot` via
   `path.resolve` + `fs.realpath` (absolute, link-resolved, relative segments removed). Then
   stat: missing → `condition: "missing"`; exists but not a directory → `"not-a-directory"`;
   directory but no read permission (`R_OK` probe) → `"unreadable"`. Throw `DiscoveryRootError`
   naming the failing condition **before any traversal or file read** (SC text: "aborts with no
   file reads").
2. **Traversal (FR-001, FR-003; 001 R1.1/R1.3/R1.4)**: recursive single-pass `opendir` walk,
   **unlimited depth**. Skip every directory whose **name** matches a configured
   `skipDirectories` entry (defaults `.git`, `node_modules`, `dist`, `.next`, `coverage` — frozen
   002 config values), without descending or including contents. Entries that `lstat` report as
   symlinks are excluded from results and never traversed (directories **and** files), silently
   and without aborting the walk. Only **regular files** are matched; matching is on the
   **basename** against the effective `taskFilePatterns` (research R2/R7).
3. **Escape guard (FR-003; 001 R1.5/R1.9; SC-003)**: before **any** file open (content reads by
   003 are none; sibling/git reads are the covered opens here), `verifyInsideRoot` on the
   realpath-resolved candidate; an escape is refused (no read), recorded in `refusals` with
   `reason: "escape"`, reported, and discovery **continues** for remaining files. Symlink
   exclusion (rule 2) means the guard normally never trips during traversal — it is
   defense-in-depth against TOCTOU and unreliable `d_type`, and it is exported for 004/008's
   read paths.
4. **Ordering & emptiness (FR-004; SC-002)**: `files` sorted byte-wise lexicographically on the
   root-relative POSIX path string; two runs over an unchanged tree are byte-for-byte identical
   (property asserted over serialized `DiscoveryResult`, including `refusals`/`diagnostics`
   order). No matches → empty `files` array, `refusals`/`diagnostics` as observed, **no error**.
5. **Association & siblings (FR-005, FR-009)**: each discovered file gets `frameworkId` +
   `detection` via `selectAdapter` (contract
   [framework-adapter.md](./framework-adapter.md)); `featureName` per the adapter rule; sibling
   documents = the adapter's effective `siblingDocuments` names existing as regular non-symlink
   files in the **same directory** (one shared `lstat`-filtered listing per directory, research
   R9), returned root-relative in configured-list order; absent siblings omitted **without
   error**. `frameworkMetadataFragment()` exposes the frozen 002 `FrameworkMetadata` field set
   per file — the payload input 008 persists (FR-009: "record the framework identity and
   framework metadata on every discovered task and persist them in the synced state payload").
6. **Git context (FR-006)**: file-based reads of at most `.git/HEAD`, the resolved loose ref,
   `.git/packed-refs`, `.git/config`, and one-level `gitdir:` indirection (research R6). HEAD
   symbolic → `branch` + `headCommit` (loose then packed); detached → `headCommit` only,
   `branch` omitted; no `[remote "origin"]` → `originRemote` omitted; no/`unparsable .git` →
   all omitted + a `DiscoveryDiagnostic` (`"unparsable-gitfile"`). **Never fails the run** for
   availability — "individually omitting unavailable values without failing" (FR-006 verbatim).
7. **Partial failures below the root (research R10)**: unreadable subdirectories are recorded as
   diagnostics and skipped; the walk continues. Only the root's three conditions abort.
8. **Read-only posture (Principle I)**: the API performs zero writes, zero tracker/Linear calls,
   zero state-directory involvement; `openCountingProbe` (optional) observes every absolute open
   so SC-003 ("0 reads occur outside the canonical root") is test-enforced across the adversarial
   fixture set.

## Test obligations (mapped in quickstart)

- **Five-framework fixture** (integration, `tests/integration/discovery.test.ts` +
  `discovery-adapters.test.ts`): 100% of task files found in a repo containing all five layouts
  at multiple depths, correct framework identity + siblings, 0 missed / 0 false (SC-001);
  includes look-alike traps (`docs/tasks.md` bmad via `docs/` base with no bmad marker still
  resolves by the rules; `.kiro/specs/x/` never resolves to spec-kit).
- **Root conditions** (unit + integration): each of the three `DiscoveryRootError` conditions
  aborts with error text naming the failing condition; probe records zero opens (FR-002, AC3).
- **Adversarial set** (integration, runtime temp trees via `tests/helpers/discovery-fixtures.ts`):
  symlink loop (a→b→a) terminates; symlinked `tasks.md` files and directories excluded from
  results; link escaping the root → refusal recorded, zero opens outside root, remaining files
  still discovered (FR-003, SC-003, AC4).
- **Determinism** (integration): double-run byte-compare of serialized result over the big
  fixture (SC-002, AC1).
- **Empty & no-match repos** (integration): empty array, zero errors (FR-004, AC2).
- **Git variants** (unit, `tests/unit/discovery-git.test.ts`): loose-ref, packed-refs,
  detached-HEAD, no-remote, missing-`.git` fixtures assert per-value presence/omission matrix
  (FR-006, AC5).
- **Guard unit** (unit, `tests/unit/discovery-root.test.ts`): boundary cases including the
  common-prefix sibling path and symlinked subdirectory escape (research R4).
