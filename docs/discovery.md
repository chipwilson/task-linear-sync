# Task Discovery (Feature 003)

`discoverTaskFiles` finds candidate task files in a repository and associates each with a
framework identity — **read-only**: zero writes, zero tracker calls, zero state-directory
involvement. The normative contract is
[`specs/003-task-discovery-framework-adapters/contracts/discovery-api.md`](../specs/003-task-discovery-framework-adapters/contracts/discovery-api.md);
adapter conventions are covered in [framework-adapters.md](./framework-adapters.md).

## Safety model

**Canonical root.** `repositoryRoot` is resolved to an absolute, symlink-resolved path
(`path.resolve` + `fs.realpath`). The pre-flight then requires an existing, readable
directory; otherwise `DiscoveryRootError` aborts with `condition` set to `"missing"`,
`"not-a-directory"`, or `"unreadable"` — **before any traversal or file read**.

**Skip rules.** Each run is a single `opendir` walk at unlimited depth. Every directory
whose *name* matches a configured `skipDirectories` entry (defaults `.git`,
`node_modules`, `dist`, `.next`, `coverage`) is skipped at any depth without descending.
Only regular files are matched, on their basename, against the enabled adapters' effective
`taskFilePatterns`. Symlinked files and directories are excluded from results and never
traversed, silently, without aborting the walk — symlink loops therefore terminate.

**Escape refusals.** Before any directory contents are read, the directory is verified
(via `realpath`) to be separator-bounded inside the canonical root; a symlink that
resolves outside the root is refused with `{ path, reason: "escape" }` recorded in
`result.refusals` — no read is performed and discovery continues for everything else.
`verifyInsideRoot(canonicalRoot, candidateAbsolute)` is exported so 004 (parsing) and 008
(state-relevant reads) honor the same guard. Unreadable subdirectories below the root
become `diagnostics` entries and the walk continues; only the root's three conditions
abort.

**Determinism.** `files` are sorted byte-wise lexicographically on the root-relative POSIX
`filePath`; `refusals` and `diagnostics` are ordered by path. Two consecutive runs over an
unchanged tree serialize byte-for-byte identically (SC-002). An empty or
task-file-free repository returns `files: []` — not an error.

## Git context (file-based)

Version-control context is read from files only — never a `git` binary: `.git/HEAD`, the
resolved loose ref falling back to `.git/packed-refs`, and `.git/config`
(`[remote "origin"] url`), with one-level `gitdir:` gitfile indirection. Each value is
individually omitted when unavailable — detached HEAD omits `branch`, a config without an
origin section omits `originRemote`, and a missing or unparsable `.git` omits all three —
**never failing the run**; `.git` problems surface as `DiscoveryDiagnostic`s instead. Pass
`gitContext: false` to skip the reads entirely (the `git` key is then absent).

## Consumer usage

```ts
import type { ResolvedConfig } from "task-linear-sync/config"; // frozen 002
import { discoverTaskFiles } from "task-linear-sync/discovery";

const result = await discoverTaskFiles({
  repositoryRoot: "/path/to/repo", // may be relative; canonicalized
  config, // frozen 002 merged config, read-only input
  // overrides, gitContext, openCountingProbe — optional
});

for (const file of result.files) {
  // file.filePath (root-relative POSIX) · file.frameworkId · file.featureName?
  // file.siblingDocuments · file.detection (adapter, pattern, candidates)
}
result.git; // { headCommit?, branch?, originRemote? }
result.refusals; // { path, reason: "escape" }[]
result.diagnostics; // { path, condition }[] — non-root partial failures
```

Feature 004 (parsing) consumes the frozen adapter seam from the same entry point:

```ts
import type { FrameworkAdapter } from "task-linear-sync/discovery";
import { builtInAdapters } from "task-linear-sync/discovery";

const generic: FrameworkAdapter = builtInAdapters.generic; // 004's fixture adapter
```

`canonicalizeRepositoryRoot`, `verifyInsideRoot`, `discoverGitContext`,
`compileNamePattern`, `selectAdapter`, `createAdapterRegistry`,
`frameworkMetadataFragment`, and `agentHookScaffold` round out the exported surface — all
snapshot-gated by `tests/contract/discovery-surface.test.ts` (drift is a deliberate
amendment, never silent).
