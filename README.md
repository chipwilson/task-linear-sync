# task-linear-sync

Keeps Spec-Driven Development task files in sync with **Linear** issues, so the
plan you author with your AI agent and the tickets your team tracks stay one
artifact. A `tasks.md` file stays the human-editable source of truth; Linear
issues carry the delivery state (assignee, branch, PR, labels, status) and
comments. A persistent `📋 Task [T###]` marker line keeps the mapping alive even
when task headings are reworded, and task-file *sections* map 1:1 to Linear
milestones.

Works with any Spec-Driven Development framework that keeps work in
`tasks.md`-style checklists — six built-in adapters (GitHub Spec Kit, AWS
Kiro, OpenSpec, BMAD, Spec Kitty, and a configurable generic lane), plus custom adapters
and widenable file patterns for anything else (per-framework behavior:
[SDD frameworks](#using-it-with-your-sdd-framework)).

It ships as the public npm package **`task-linear-sync`**, and you consume it in
**your** repository through its CLI, git hooks, and MCP server. The engine talks
to Linear's GraphQL API through one injectable port — no SDK, which is why the
tool ships with **zero runtime dependencies** — and reads its API token from a
configurable environment variable (`LINEAR_ACCESS_TOKEN` by default), never from
a file and never echoing it into any output.

## Status

[![CI](https://github.com/chipwilson/task-linear-sync/actions/workflows/ci.yml/badge.svg)](https://github.com/chipwilson/task-linear-sync/actions/workflows/ci.yml)

- **Available on npm**: install [`task-linear-sync`](https://www.npmjs.com/package/task-linear-sync)
  — no clone, no build step required to use it.
- **Install it as a development dependency** (`npm install --save-dev`): every
  surface — CLI, git hooks, worker, MCP server — runs at development time
  against your repository. Your shipped code never imports it, so it has no
  business in a production `dependencies` block (and none of its own would
  follow it there: zero runtime dependencies).
- **Version posture**: the package is in its 0.x line — under the
  [0.x posture](docs/versioning.md) breaking changes may ride minor bumps until
  the documented 1.0.0 condition is met. Surface-level stability guarantees
  (below) hold throughout.
- **Requires** Node 20 or newer wherever the tool runs; nothing else to install.

> **Consumers, start here.** Install the CLI, install its git hooks, and read
> the SDD-framework guide below — no library code required.

## Getting started (two minutes)

```bash
# in YOUR repository — the sync runs right here, no clone needed
npm install --save-dev task-linear-sync    # dev dependency on purpose (see Status)

# 0. one Linear API token in the environment (read-only use included —
#    planning reads issue state); the value is never logged or printed
export LINEAR_ACCESS_TOKEN="lin_api_..."

# 1. see what the tool discovers (read-only)
npx task-linear-sync inventory

# 2. compute a sync plan + review report (still zero writes)
npx task-linear-sync plan

# 3. gate-approve the plan and apply it (creates/updates Linear issues + markers)
npx task-linear-sync sync --plan <planId> --apply --confirm SYNC
```

`plan` prints the plan id and stores the plan durably; `sync` accepts only a
stored plan id and requires `--apply` plus `--confirm` with the configured
confirmation key (default: `SYNC`, change it in the configuration file).
An unreviewed plan id or wrong key is refused (exit 4) — there is no force
flag. That completes the happy path: commit your `specs/` tree, and the hooks
below keep Linear current from there on.

Because the package is a dev dependency, everything runs through `npx` (or your
package.json `scripts`) — `npx task-linear-sync --version` prints the installed
version if you want to confirm the install.

## Installing the git hooks

One command splices a managed block into every git hook listed in the
`queue.managedGitHooks` configuration key (default: `pre-push` and
`post-merge`), appending to any hooks you already have. The block runs
`last-run` (status to stderr) followed by `enqueue`, both under `|| true` —
the hooks **fail open**, so a sync problem can never block a push or merge:

```bash
npx task-linear-sync install-hooks      # splice the managed blocks
```

### Which hooks to configure for what

| Goal | Configure | Why |
|---|---|---|
| Linear learns about work when you push — the main workflow | the defaults: `queue.managedGitHooks: ["pre-push", "post-merge"]` | Pushes and merges queue a job; the worker drains it asynchronously — you never wait on sync |
| Learn about work at every commit, not just pushes | add `"post-commit"` to `queue.managedGitHooks`, re-run `install-hooks` | Each commit queues a job; repeated enqueues coalesce into a single pending job, so a commit burst costs one sync |
| Sync on demand only — e.g. CI clones that must not enqueue | `queue.managedGitHooks: []`, run `enqueue --mode sync` (or `--mode bootstrap` for the first bulk apply) by hand | Hooks stay untouched; the CLI still syncs whenever you ask |
| Always block a push/merge when task files and Linear have drifted | your own hook running `task-linear-sync check --json` and exiting on findings | **Deliberately not installed for you.** The managed block queues work instead of blocking it (fails-open philosophy) — hard gating stays your decision |

Queue state (pending job + lock) lives in the per-repository **state
directory** — by default outside the repo tree in your OS state dir (e.g.
`~/.local/state/task-linear-sync/<hash>` on Linux) — so there is nothing to
gitignore (placement rules: [docs/configuration.md](docs/configuration.md)). A
`queue.hooksDirectory` override exists for unusual layouts (worktrees,
shared hooks dirs).

**Always pair the hooks with the worker**: queued jobs only execute when a
worker drains them. Start the worker (below) wherever you want syncs to
actually run.

## Running the background worker

The worker is the component that drains the queue: it re-reads your files,
computes a plan, and executes the approved writes through the sync engine.
History (what synced, what failed, what was skipped) is recorded so `last-run`
and the tool interface can report it. Run it in a spare terminal, tmux pane,
or process supervisor; it shuts down gracefully on `SIGINT`/`SIGTERM`
(finishing the in-flight job) and exits when a stop request arrives:

```bash
npx task-linear-sync worker                # run until interrupted
npx task-linear-sync worker --once         # drain the queue once, then exit (cron-friendly)
npx task-linear-sync last-run              # outcome of the most recent recorded run
npx task-linear-sync last-run --json       # the same, machine-readable
```

The worker executes the queue's approved writes through the same sync engine
the CLI uses, with the same configuration and the same environment-provided
Linear token — nothing else needs to be running for queued syncs to complete.

## Using it from your coding agent

The package ships an MCP server (`task-linear-sync/mcp`) exposing four tools:
`task_sync_inventory`, `task_sync_plan` and `task_sync_status` (read-only)
plus the gated `task_sync_apply` — the same plan-review-confirm contract as
the CLI, so your agent can answer "what would sync?" and drive an approved
apply without shell access. It is a library factory, not a bin: register a
small launcher (the pattern in [docs/agent-tools.md](docs/agent-tools.md)
§Usage) as your client's stdio or authenticated-HTTP MCP server. That doc
also covers the tool schemas, session-scoped plan references, and refusal
codes.

The read-only tools are enforced structurally, not by convention: no
mutating tracker operation is reachable from a read-only tool, and CI scans
keep it that way.

## The read-only sync-history web page

`task-linear-sync/history-server` serves the reconstructed sync history of a
task as HTML, JSON, or a Server-Sent Events stream — addresses are exactly
the URLs the engine records on issue attachments. Also a library factory
(no bin): `createSyncHistoryServer(...).listen(port, "127.0.0.1")`, or bind
the request handler directly on a serverless host. Private by default: token
auth from the environment, no static assets, no cookies beyond an opaque
session, and no tracker mutation on any route. Full guide — routing,
auth tiers, caching, SSE vs polling, deployment patterns:
[docs/history-server.md](docs/history-server.md).

## Using it with your SDD framework

Framework layout is never hardcoded: discovery walks the repository, and each
built-in adapter carries its framework's conventions — detection markers, base
directories, feature-name rule, sibling documents. Six built-in adapters ship,
all enabled by default through the `frameworkAdapters` config key:

| Adapter id | Framework | Detected by | Base directories | Feature name from |
|---|---|---|---|---|
| `kiro` | AWS Kiro | path beneath `.kiro/` | `.kiro/specs/` | feature dir under `.kiro/specs/` |
| `spec-kit` | GitHub Spec Kit | beneath `specs/`/`spec/` **and** a sibling `spec.md`/`plan.md` | `specs/`, `spec/` | feature dir under a base |
| `open-spec` | OpenSpec | path contains `openspec/`/`open-spec/` **or** sibling `openspec.json`/`proposal.md` | `openspec/`, `open-spec/` | segment after `openspec/`, `changes/`, or `specs/` |
| `bmad` | BMAD | path contains `bmad/`/`bmad-method/` **or** sibling `prd.md`/`architecture.md` | `bmad/`, `bmad-method/`, `docs/` | parent dir, else task-file basename |
| `spec-kitty` | Spec Kitty | path beneath `kitty-specs/` (no sibling requirement) | `kitty-specs/` | mission dir under `kitty-specs/`, else parent dir |
| `generic` | any Markdown layout | fallback — never claims a file by marker | configured base dirs | parent dir under a base |

When several adapters match one file, selection ranks the longest matching
path pattern first, then the fixed precedence
`kiro` → `open-spec` → `spec-kit` → `bmad` → `spec-kitty` → `generic`,
then alphabetical tie-break; a file no adapter claims falls back to `generic`.
Task-file names (default `tasks.md`, `TASKS.md`), base directories, and every
per-adapter convention are configuration keys — widen `taskFilePatterns` /
`specsBaseDirectories` in your config file instead of forking the tool. Full
adapter contract: [docs/framework-adapters.md](docs/framework-adapters.md).

### GitHub Spec Kit (`spec-kit`)

Detection is deliberately conjunctive: a file beneath `specs/` (or `spec/`) is
`spec-kit` only when a sibling `spec.md` or `plan.md` marks the feature — a
stray `specs/` file without those markers resolves to `generic`. Feature names
come from the feature directory, and `spec.md`, `plan.md`, and
`requirements.md` siblings are attached when present.

Tasks land at `specs/<feature>/tasks.md` and use T001-style ids — this is the
out-of-the-box convention, no configuration needed. Spec Kit runs
`/speckit.specify → /speckit.plan → /speckit.tasks` before any code is
written, which is exactly where the sync belongs:

1. Run `/speckit.tasks`, then `task-linear-sync install-hooks` (one time) and
   start the worker — Linear stays current as you commit. For a first-time
   bulk apply use `plan` + `bootstrap --plan <id> --apply --confirm <key>`;
   day-to-day changes go through `sync` with the same gate. One milestone per
   spec folder, one issue per T-task, with `[P]/[US<n>]` tags and
   "Preceded by" edges recorded on the issue.
2. Gate the pull request with the [CI step](#ci-fail-the-pull-request-on-sync-drift)
   — it fails the build only on unmapped high-confidence tasks, unresolved
   conflict blocks, or spec drift.
3. Re-running `/speckit.tasks` is safe: the `📋 Task [T###]` marker and the
   idempotency guards mean regenerated files re-match existing issues instead
   of duplicating them.

### AWS Kiro (`kiro`)

Anything beneath `.kiro/` is Kiro territory: task files at
`.kiro/specs/<feature>/tasks.md`, the feature directory is the feature name,
and `requirements.md` / `design.md` are the sibling documents. `kiro` is also
the default framework of `install-agent-hook`: it scaffolds a `kiro-json`
agent hook into `.kiro/hooks/` that enqueues a sync when spec files are
saved. No configuration needed if you keep Kiro's default layout.

### OpenSpec (`open-spec`)

Detection is disjunctive — a path containing `openspec/` or `open-spec/`, or
a task file sitting next to an `openspec.json` or `proposal.md`. Feature
names come from the meaningful segment after `openspec/`, `changes/`, or
`specs/`, so both `openspec/changes/<change>/tasks.md` and
`openspec/specs/<capability>/tasks.md` resolve sensibly; sibling documents
are `spec.md`, `proposal.md`, and `tasks.md`.

### BMAD (`bmad`)

Task files under `bmad/` or `bmad-method/` — or any task file beside a
`prd.md` / `architecture.md` — resolve to `bmad`; the feature name is the
parent directory, falling back to the task file's own basename for
story-style files with no feature dir. `docs/` is deliberately only a base
directory, not a BMAD marker: a `docs/**` task file without BMAD siblings is
`generic`, never silently `bmad`. Sibling documents cover the BMAD set:
`requirements.md`, `design.md`, `architecture.md`, `prd.md`, and `spec.md`.

### Spec Kitty (`spec-kitty`)

Spec Kitty keeps one mission per directory: the checklist is
`kitty-specs/<mission>/tasks.md`, the mission directory is the feature name,
and `spec.md`, `plan.md`, and `research.md` ride along as sibling documents.
Anything beneath `kitty-specs/` is claimed — no sibling marker is required —
and the `kitty-specs/<mission>/tasks/` bookkeeping directory (the per-work-package
agent-prompt files Spec Kitty generates) is excluded from discovery, because
those prompts are not tasks.

Checklist lines carry their own id, printed without the `[]` Spec Kit uses —
`- [ ] T001 Create the scaffold` — so the local id is read out of the line body
(`<id> <text>`), and `## Work Package WP01: <title>` headings group the subtasks
into phases rather than becoming tasks themselves. `[P]`, `[P1]`, and `[US1]`
capability tags stay verbatim in the file and in the mirrored issue body but are
stripped from derived task titles, so the issue title is the plain task text.
Task-file names, base directories, and both grammars are configuration or
override keys — `overrides.adapters["spec-kitty"]` re-points `baseDirectories`,
`checklistIdPattern`, or `titleTagPattern` for a forked kit layout.

### Generic Markdown (`generic`)

Any repository with task-shaped Markdown — a homegrown `tasks.md`
convention, an SDD tool with no fixed layout (add its task-file names to
`taskFilePatterns`), or a repo that just wants one rule for everything.
`generic` never claims a file by marker: it is the fallback when no adapter
matches, and an explicit choice (`frameworkAdapters`, or a selection
override) when you want it everywhere. The heading grammar is the broad
built-in one (`T001`, `TASK-1`, `Task 1.2`, …), no framework title prefixes
are stripped, and no framework-specific exclusions apply. Its agent-hook
scaffold (`install-agent-hook --framework generic`) lands in
`.task-linear-sync/hooks/`.

### Your own framework (`customAdapters`)

For a layout none of the six models, register a custom adapter through the
`task-linear-sync/discovery` API (`CustomAdapterDescriptor`: your id,
path/base-directory patterns, task-file names, heading grammar — an
incomplete descriptor is refused by naming every missing part before any
I/O, and a custom id shadows a built-in only with an explicit opt-in).
Scope note: custom adapters extend **discovery**; the six built-in
frameworks are the only syncable identities, so a custom id never reaches
`plan`/`apply`/`rollback` — the engine refuses it with a named error instead
of mislabeling your tasks.

<details>
<summary>Per-repository configuration example (optional — click to expand)</summary>

```jsonc
// task-linear-sync.json (repo root) — precedence: CLI flag > environment
// variable > this file > defaults (a file value never overrides an explicit
// flag, so CI stays predictable). Keys are camelCase schema fields; every
// one is optional — these are the ones teams actually touch.
{
  "taskFilePatterns": ["tasks.md", "TASKS.md"],
  "specsBaseDirectories": ["specs/", ".kiro/specs/", "openspec/", "bmad/"],
  "frameworkAdapters": ["kiro", "spec-kit", "open-spec", "bmad", "generic"],
  "teams": {
    "acme": {
      "projects": ["proj-alpha"],
      "workflowStates": { "backlog": "Backlog", "done": "Done", "completedTypes": ["completed"], "ignoredTypes": ["canceled", "duplicate"] }
    }
  },
  "defaultTeamKey": "acme",
  "defaultProject": "proj-alpha",
  "confirmationKey": "SYNC"
}
```

</details>

## CI: fail the pull request on sync drift

A GitHub composite action (`action.yml` at the repository root — consume it
as `owner/repo@vN` from the tag you publish) wraps the read-only
`check`/`plan` commands and gates the step on three independently
togglable conditions: unmapped high-confidence tasks, unresolved conflict
blocks, and spec drift. Zero writes, zero tracker mutation — the apply path
is not reachable from the CI layer by construction, and a Linear/plan outage
degrades to a warning rather than a false failure:

```yaml
- uses: owner/task-linear-sync@v1     # where you host this repository
  env:
    LINEAR_ACCESS_TOKEN: ${{ secrets.LINEAR_ACCESS_TOKEN }}
  with:
    fail-on-unmapped: "true"
    fail-on-conflicts: "true"
    fail-on-drift: "true"
    drift-threshold: "0"
```

Full input/output reference and the step's exit-code contract:
[docs/ci-enforcement.md](docs/ci-enforcement.md).

## CLI command reference

Twelve commands; human output is placeholder-safe (no real identifiers ever
printed). Run `npx task-linear-sync --help` for the whole grammar and exit-code
map.

| Command | What it does |
| --- | --- |
| `inventory [repo]` | Discovered task files and parsed task counts (read-only) |
| `discover-metadata [repo]` | Configured projects, workflow states and milestones (read-only) |
| `plan [repo]` | Build a sync plan **and** its paired review report (read-only; prints the plan id + gate key) |
| `bootstrap [repo] --plan <id> --apply --confirm <key>` | First-time bulk apply of a stored plan through the gate |
| `sync [repo] --plan <id> --apply --confirm <key>` | Apply a stored plan through the gate (`--confirm` must equal the configured key, default `SYNC`) |
| `check [repo] [--json]` | Plan lane with one machine-readable JSON summary on stdout (read-only; exit 8 = findings) |
| `install-hooks [repo]` | Install the managed git hooks (above) |
| `install-agent-hook [repo] --framework <id>` | Scaffold the agent-hook template (`kiro` default, `generic` also available) |
| `enqueue [repo] --mode bootstrap\|sync` | Record a single pending sync job by hand |
| `worker [repo] [--once]` | Drain the queue: `--once` exits after one pass, no flag runs until stopped |
| `last-run [repo] [--json]` | Outcome of the most recent recorded run |
| `rollback [repo] <runId>` | Reverse a journaled run |

Exit codes: `0` success · `1` unexpected · `2` usage · `3` configuration ·
`4` gate-refused · `5` run-aborted · `6` lock-held · `7` surface-unavailable ·
`8` check-findings.

One token drives everything Linear-facing: `LINEAR_ACCESS_TOKEN` (the
*variable name* is configuration, the value is never read from a file and
never appears in any output). The history page and the MCP HTTP transport
each take their own bearer token for their own endpoints (`TLS_WEB_TOKEN`
and `TLS_MCP_TOKEN` by default — names likewise configurable, so CI
conventions can override them).

## Documentation

- [CLI reference](docs/cli.md)
- [Configuration file & precedence](docs/configuration.md)
- [Queue & git hooks](docs/queue-hooks.md)
- [Agent tools (MCP)](docs/agent-tools.md)
- [Sync-History web component](docs/history-server.md)
- [CI enforcement action](docs/ci-enforcement.md)
- [Release process](docs/release-process.md) · [Versioning policy](docs/versioning.md)
- [Framework adapters](docs/framework-adapters.md)
- [Module docs](docs/) (engine, discovery, parsing, matching, routing, tracker)
- [Active contracts](specs/) · [contract amendments](docs/contract-amendments.md)

## Stability

Every library entry point — `task-linear-sync`, `task-linear-sync/engine`,
`task-linear-sync/history-server`, `task-linear-sync/mcp`,
`task-linear-sync/ci` and the rest of the export map — is **Stable**: machine-
checked by the frozen-surface snapshots and contract suites in this repository.
The CLI's command names, flags, exit codes and machine-readable output
(`--json`) are **Stable**; its human-facing prose, colours and layout are
**Unstable**. Package versioning follows the [0.x posture](docs/versioning.md)
until the 1.0.0 condition is met: breaking changes may ride minor bumps, but
each one still arrives with an entry in
[docs/contract-amendments.md](docs/contract-amendments.md); from 1.0.0 they
require a major release plus a deprecation cycle. The sync-history web page and
the MCP tool contract carry their own `## Stability` sections in their guides,
each pinned by its contract list.

## Running the project from source

Only needed if you're hacking on the tool itself:

```bash
npm ci
npm test              # unit + contract + integration + e2e + performance tiers
npm run build && node dist/cli/main.js --help
node scripts/release.mjs --dry-run   # rehearse the full release gate (publishes nothing)
```

