# Contract: Hook Installation (git hook blocks + agent scaffolds)

**Feature**: 010 | **Status**: binding for `src/queue/git-hooks.ts`,
`src/queue/agent-hooks.ts` | **See also**: [research R9/R11](../research.md) ·
[003 agent-hooks contract](../../003-repository-tool-discovery/contracts/) ·
[frozen 002 §14](../../002-core-domain-contracts/data-model.md)

## 1. Managed git-hook block (FR-006, FR-007, FR-008, SC-003)

### 1.1 Markers (exact bytes)

```
# >>> task-linear-sync managed hooks v1 >>>
# <<< task-linear-sync managed hooks v1 <<<
```

(Tool id follows `config.toolId`; the marker pair delimits the managed region.
At most one region per file — verified and repaired on drift.)

### 1.2 Canonical block body

```sh
# >>> task-linear-sync managed hooks v1 >>>
"task-linear-sync" last-run 1>&2 || true
"task-linear-sync" enqueue 1>&2 || true
# <<< task-linear-sync managed hooks v1 <<<
```

- `"task-linear-sync"` = `queue.hookScriptPrefix` (default: bin name) — the
  command token is configurable so installs work under renamed bins or through
  wrapper scripts.
- The block is the **complete file content** for hooks we create; for existing
  hooks it is appended (preserving the user's script above it byte-for-byte).
- Every line ends `|| true` ⇒ the block always exits 0; stderr only ⇒ stdout
  untouched (FR-007: prior outcome visible on stderr; the hook itself always exits zero).
- `git push`/`git merge` behavior with the block installed equals behavior
  without it (SC-001 posture) — asserted by output-diff fixtures.

### 1.3 Splice rules (byte-level; Buffer discipline — R9)

1. Resolve git dir (pure fs: `<repo>/.git` file ⇒ `gitdir:` parse, worktree
   aware; no `git` binary invoked — 003 precedent); hooks dir =
   `queue.hooksDirectory` override else `<gitDir>/hooks`.
2. Hook name set = frozen `config.managedGitHooks`; every name must be in the
   git-hook vocabulary (`pre-push`, `post-merge`, `pre-commit`, …). Unknown
   name ⇒ **abort before any write**, detail lists every offending name.
3. Existing file with no shebang ⇒ leave byte-intact, warn
   (`<name> has no shebang — refusing to manage`), continue other hooks.
4. Absent file ⇒ create `0o755` with `#!/bin/sh\n` + block. Existing managed
   region ⇒ replace in place iff bytes differ (idempotent — reinstall is a
   no-op; SC-003); foreign content after our end-marker ⇒ preserved.
5. Executable bit: set on files we manage; never chmod anything else.

### 1.4 Idempotence, drift and uninstall

- Re-running `install-hooks` **is** the verification lane (009 has no
  verify command): bytes intact ⇒ `{status:"installed"}` with zero writes;
  region drifted ⇒ canonical block re-spliced (repair) and reported in
  `detail`; region absent ⇒ re-appended. Golden-bytes tests pin all three.
- Uninstall (documented operator escape; seam surface unchanged): splice the
  region out; remove created-file remnants only when the file is exactly our
  canonical content; otherwise restore pre-install bytes.

### 1.5 Fired-hook behavior

- cwd = repository root at fire time (git contract) ⇒ the block embeds no repo
  path; CLI resolves `[repo]` from cwd (works in worktrees/`git -C`).
- Fire must complete < 500 ms (SC-001): the enqueue fast path is
  read-config + merge-write + non-blocking spawn (queue-protocol §2/§5).
- Hook stdin/stdout pass through untouched (only stderr is used).

## 2. Agent hook scaffold (FR-009)

- Consume the frozen-pure 003 `agentHookScaffold(frameworkId,
  hookScriptPrefix)`; enrich the JSON **additively**:
  `event: "post-file-save"` + `pathPatterns: config.taskFilePatterns` —
  the 003 record shape stays valid (extra members only).
- Target dir = `config.agentHooksDirectory` override else the 003 framework
  default (e.g. `.kiro/hooks/`); file name from 003; on collision never
  overwrite: first free suffix `-2`, `-3`, … — the written path is reported
  (`{status:"installed", path}`, 009 shape). Unknown `frameworkId` ⇒
  `{status:"refused", detail}` (no partial writes).
- Framework selection: explicit `--framework <id>` on the CLI, else the first
  templated adapter order from 003 (kiro before generic). Zero network —
  scaffolds are static composition (Principle IV).
- The scaffold's `command` action runs `<prefix> enqueue` — the same
  lock-free enqueue lane (single code path for every trigger).

## 3. Hygiene

- Hook/scaffold writers never embed secrets, env values, or absolute paths of
  user home; only the configured prefix token and 003 template constants.
- Install/repair/uninstall are pure-fs deterministic functions of repo bytes +
  config — fully unit-testable with temp trees, no git binary, no wall clock.
