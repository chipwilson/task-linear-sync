# Claim Audit: Documentation Truthfulness

- Baseline commit: 1fccd080f41af5a503c16724544dc937083a156d
- Audited documents: README.md, docs/framework-adapters.md, docs/discovery.md,
  docs/parsing.md, specs/requirements.md
- Open false/ambiguous verdicts: 8

Record format and self-check rules:
[contracts/audit-record-format.md](./contracts/audit-record-format.md). Field vocabulary:
[data-model.md](./data-model.md). Entries are append-only except `Correction`/`Guards`
lines and the header counter; ids are never reused or renumbered.

## Claim entries

### C-001 — README.md:195-196 — tags and dependency edges on issues

- **Verdict**: false
- **Framework scope**: spec-kit
- **Claim**: "One milestone per spec folder, one issue per T-task, with `[P]/[US<n>]`
  tags and "Preceded by" edges recorded on the issue."
- **Evidence kind**: absence-search
- **Evidence pointer**: src/tracker/operations/mutations.ts::createIssueImpl
- **Evidence search scope**: no tag/label extraction and no dependency-edge
  construction anywhere in src/; the issue create/patch surface admits title,
  description, state, parent (+ team/project on create) only. The milestone clause of
  this sentence is adjudicated separately under C-007.
- **Requirements check**: requirements-silent
- **Reasoning**: the sentence promises issue-side tag and edge recording as the
  out-of-the-box Spec Kit outcome; the shipped tracker lane writes neither (verified
  at the baseline commit, clean tree).

### C-002 — README.md:186-187 — out-of-the-box T001 id capture

- **Verdict**: false
- **Framework scope**: spec-kit
- **Claim**: "Tasks land at `specs/<feature>/tasks.md` and use T001-style ids — this is
  the out-of-the-box convention, no configuration needed."
- **Evidence kind**: source
- **Evidence pointer**: src/parsing/content.ts:167-168
- **Reasoning**: `LOCAL_ID_SPAN_RE` requires separator punctuation (`[.:—–-]`) plus
  whitespace after the identifier before a checklist line's leading token is captured.
  Spec Kit emits plain `- [ ] T001 …` lines (single space), so those lines sync with no
  `Local_Task_ID` and the seed falls back to `ordinal:filePath`
  (src/domain/task.ts::taskStableSeed). Heading capture (`## T001 …`) does work
  unconfigured — the sentence is false as worded because readers reasonably expect the
  T001 checkbox ids to be the captured ones. (Concrete demo appended by T010.)

### C-003 — README.md:1 (whole-corpus absence) — native `[DEP:]`/`[Dep:]` parsing

- **Verdict**: true-no-claim-present
- **Framework scope**: all
- **Claim**: no audited document claims native `[DEP:]`/`[Dep:]` dependency parsing
  (claim gist; no sentence to quote — vacuous after feature 016 removed it).
- **Evidence kind**: absence-search
- **Evidence pointer**: README.md:1
- **Evidence search scope**: grep for `[DEP:]` and `[Dep:]` across README.md,
  docs/framework-adapters.md, docs/discovery.md, docs/parsing.md,
  specs/requirements.md and src/ — zero hits at the baseline commit.
- **Requirements check**: requirements-silent
- **Reasoning**: the FR-002 suspect "native `[DEP:]`/`[Dep:]` parsing" has no surviving
  claim; the record keeps the topic visible (self-check rule 4) with a guard (family 1)
  preventing reintroduction.

### C-004 — README.md:170-172 — selection precedence

- **Verdict**: true
- **Framework scope**: all
- **Claim**: "When several adapters match one file, selection ranks the longest
  matching path pattern first, then the fixed precedence `kiro` → `open-spec` →
  `spec-kit` → `bmad` → `generic`, then alphabetical tie-break; a file no adapter
  claims falls back to `generic`."
- **Evidence kind**: test
- **Evidence pointer**: tests/contract/framework-support-consistency.test.ts::framework-consistency: README precedence line matches DEFAULT_PRECEDENCE
- **Reasoning**: the quoted precedence matches `DEFAULT_PRECEDENCE`
  (src/discovery/registry.ts:33) element-for-element and the 016 pin test keeps them
  equal; ranking order implemented in src/discovery/registry.ts::selectAdapter.

### C-005 — README.md:322 — agent-hook scaffold options

- **Verdict**: true
- **Framework scope**: all
- **Claim**: "`install-agent-hook [repo] --framework <id>` | Scaffold the agent-hook
  template (`kiro` default, `generic` also available)"
- **Evidence kind**: test
- **Evidence pointer**: tests/contract/framework-support-consistency.test.ts::framework-consistency: agent-hook scaffold claims match the code
- **Reasoning**: `agentHookScaffold` ships kiro and generic templates only, with
  `DEFAULT_FRAMEWORK = "kiro"` (src/queue/agent-hooks.ts:26); the 016 pin test
  re-checks README and the hook-directory table rows against the code.

### C-006 — README.md:7-8, :200-201 — persistent `📋 Task [T###]` marker line

- **Verdict**: false
- **Framework scope**: sync-core
- **Claim**: "A persistent `📋 Task [T###]` marker line keeps the mapping alive even
  when task headings are reworded" and "Re-running `/speckit.tasks` is safe: the
  `📋 Task [T###]` marker and the idempotency guards mean regenerated files re-match
  existing issues instead of duplicating them."
- **Evidence kind**: absence-search
- **Evidence pointer**: README.md:7
- **Evidence search scope**: `📋` occurs only in README.md:7 and README.md:200 across
  the repository — no writer, parser, or test for any marker line exists in src/ or
  tests/; Constitution Principle II forbids reasserting file-identity markers.
  As-built durability is the visible `[KEY-N]` reference token written back on the task
  line plus the deterministic UUID carried in the sync-attachment metadata.
- **Requirements check**: requirements-silent
- **Reasoning**: the marker-line story is a leftover from a pre-014 design; the shipped
  matching and idempotency machinery is reference-token + attachment based
  (src/domain/task.ts::taskStableSeed, src/tracker/operations).

### C-007 — README.md:9, :194 — sections map to Linear milestones

- **Verdict**: false
- **Framework scope**: sync-core
- **Claim**: "task-file *sections* map 1:1 to Linear milestones" and "One milestone
  per spec folder, one issue per T-task"
- **Evidence kind**: absence-search
- **Evidence pointer**: src/engine/report.ts:23-27
- **Evidence search scope**: no milestone creation or assignment anywhere in
  src/engine or src/tracker; the only milestone-shaped structure is the **report's**
  grouping bucket keyed by `featureName` (src/engine/report.ts:23-27, :248), which is
  read-side presentation only. `discover-metadata` reads milestones (read-only).
- **Requirements check**: requirements-silent
- **Reasoning**: the sync engine never creates, assigns, or clears Linear milestones;
  the README states a mapping that does not exist.

### C-008 — README.md:5-6 — delivery state carried on issues

- **Verdict**: ambiguous
- **Framework scope**: sync-core
- **Claim**: "A `tasks.md` file stays the human-editable source of truth; Linear
  issues carry the delivery state (assignee, branch, PR, labels, status) and
  comments."
- **Evidence kind**: source
- **Evidence pointer**: src/tracker/operations/mutations.ts::updateIssueImpl
- **Reasoning**: the tool itself writes only title, description, and workflow state
  (`updateIssueImpl` admits exactly those; `createIssueImpl` adds team/project and an
  optional initial state) — assignee, branch, PR, and labels are values your team
  sets **in Linear**, never synced by the tool. The sentence is ambiguous because
  placed next to the sync description it reads as a list of what the sync keeps
  current. (Companion of C-001: labels are not written either.)

### C-009 — README.md:11-15 — five built-in adapters plus custom adapters

- **Verdict**: true
- **Framework scope**: all
- **Claim**: "Works with any Spec-Driven Development framework that keeps work in
  `tasks.md`-style checklists — five built-in adapters (GitHub Spec Kit, AWS Kiro,
  OpenSpec, BMAD, and a configurable generic lane), plus custom adapters and
  widenable file patterns for anything else"
- **Evidence kind**: source
- **Evidence pointer**: src/config/defaults.ts:43
- **Reasoning**: `frameworkAdapters` default lists exactly the five ids
  (src/config/defaults.ts:43); the custom-adapter discovery API is
  `CustomAdapterDescriptor` (src/discovery/adapter.ts:133) and `taskFilePatterns`
  is a config key (src/config/defaults.ts:44).

### C-010 — README.md:157-160 — layout never hardcoded, all enabled by default

- **Verdict**: true
- **Framework scope**: all
- **Claim**: "Framework layout is never hardcoded: discovery walks the repository,
  and each built-in adapter carries its framework's conventions — detection markers,
  base directories, feature-name rule, sibling documents. Five built-in adapters
  ship, all enabled by default through the `frameworkAdapters` config key"
- **Evidence kind**: source
- **Evidence pointer**: src/config/defaults.ts:43
- **Reasoning**: adapters carry per-framework convention records
  (src/discovery/adapters/{kiro,spec-kit,open-spec,bmad,generic}.ts); the enabled
  set is the `frameworkAdapters` config key, defaulted to all five.

### C-011 — README.md:162-168 — adapter table rows

- **Verdict**: true
- **Framework scope**: all
- **Claim**: adapter table rows for `kiro`, `spec-kit`, `open-spec`, `bmad`,
  `generic` — "Detected by", "Base directories", and "Feature name from" columns
  (quoted in full in the README section)
- **Evidence kind**: source
- **Evidence pointer**: src/discovery/adapters/kiro.ts:14-22
- **Evidence search scope**: row-by-row comparison of the README table against
  `baseDirectories` / `detection` / `featureNameRule` / `siblingDocuments` in all
  five adapter modules — kiro.ts:14-22, spec-kit.ts:14-26, open-spec.ts:14-25,
  bmad.ts:14-25, generic.ts:17-26 — every cell matches (markers, bases, feature-name
  rules, fallback semantics).
- **Reasoning**: adjudicated per framework row; no cell overstates the code.

### C-012 — README.md:173-176 — "every per-adapter convention" configurable

- **Verdict**: false
- **Framework scope**: all
- **Claim**: "Task-file names (default `tasks.md`, `TASKS.md`), base directories,
  and every per-adapter convention are configuration keys — widen
  `taskFilePatterns` / `specsBaseDirectories` in your config file instead of forking
  the tool."
- **Evidence kind**: source
- **Evidence pointer**: src/config/defaults.ts:43-45
- **Evidence search scope**: the configuration surface covers task-file names
  (`taskFilePatterns`), base directories (`specsBaseDirectories`), the enabled
  adapter set (`frameworkAdapters`), and the agent-hook directory
  (`agentHooksDirectory`); detection markers, sibling-document sets, and
  feature-name rules are fixed in the adapter modules (e.g. kiro.ts:15,
  spec-kit.ts:15-19) and are **not** configuration keys.
- **Reasoning**: "every per-adapter convention" is an overclaim — the named advice
  (widen the two keys) is correct, but the sentence promises configurability the
  code does not offer.

### C-013 — README.md:180-184 — Spec Kit detection and siblings

- **Verdict**: true
- **Framework scope**: spec-kit
- **Claim**: "Detection is deliberately conjunctive: a file beneath `specs/` (or
  `spec/`) is `spec-kit` only when a sibling `spec.md` or `plan.md` marks the
  feature — a stray `specs/` file without those markers resolves to `generic`.
  Feature names come from the feature directory, and `spec.md`, `plan.md`, and
  `requirements.md` siblings are attached when present."
- **Evidence kind**: source
- **Evidence pointer**: src/discovery/adapters/spec-kit.ts:3-26
- **Reasoning**: conjunctive detection, base dirs, parent-dir feature name, and the
  sibling set all match the adapter module.

### C-014 — README.md:191-192 — "Linear stays current as you commit"

- **Verdict**: false
- **Framework scope**: sync-core
- **Claim**: "Run `/speckit.tasks`, then `task-linear-sync install-hooks` (one time)
  and start the worker — Linear stays current as you commit."
- **Evidence kind**: source
- **Evidence pointer**: src/config/defaults.ts:119
- **Reasoning**: the default `queue.managedGitHooks` value is
  `["pre-push", "post-merge"]` — out of the box, queued syncs ride pushes and
  merges, not commits (the README's own hook table says every-commit syncing
  requires adding `post-commit`). "as you commit" is false as shipped; the
  sentence must say push/merge (or point at the opt-in).

### C-015 — README.md:197-199 — CI step failure conditions

- **Verdict**: true
- **Framework scope**: sync-core
- **Claim**: "Gate the pull request with the [CI step](#ci-fail-the-pull-request-on-sync-drift)
  — it fails the build only on unmapped high-confidence tasks, unresolved conflict
  blocks, or spec drift."
- **Evidence kind**: source
- **Evidence pointer**: action.yml:24-36
- **Reasoning**: the composite action exposes exactly the three fail-on
  conditions (`fail-on-unmapped`, `fail-on-conflicts`, `fail-on-drift` +
  `drift-threshold`); see also C-025 for the CI-section sentence.

### C-016 — README.md:206-211 — AWS Kiro section

- **Verdict**: true
- **Framework scope**: kiro
- **Claim**: "Anything beneath `.kiro/` is Kiro territory: task files at
  `.kiro/specs/<feature>/tasks.md`, the feature directory is the feature name, and
  `requirements.md` / `design.md` are the sibling documents. `kiro` is also the
  default framework of `install-agent-hook`: it scaffolds a `kiro-json` agent hook
  into `.kiro/hooks/` that enqueues a sync when spec files are saved. No
  configuration needed if you keep Kiro's default layout."
- **Evidence kind**: source
- **Evidence pointer**: src/queue/agent-hooks.ts:26
- **Reasoning**: kiro adapter conventions (kiro.ts:14-22) match the layout
  sentences; `DEFAULT_FRAMEWORK = "kiro"`; the scaffold record's template is
  `kiro-json` landing in `.kiro/hooks/` (src/discovery/conventions.ts:78) with
  additive `event: "post-file-save"` + `pathPatterns` enrichment
  (src/queue/agent-hooks.ts:48-52) so the hook enqueues on spec-file saves.

### C-017 — README.md:215-220 — OpenSpec section

- **Verdict**: true
- **Framework scope**: open-spec
- **Claim**: "Detection is disjunctive — a path containing `openspec/` or
  `open-spec/`, or a task file sitting next to an `openspec.json` or `proposal.md`.
  Feature names come from the meaningful segment after `openspec/`, `changes/`, or
  `specs/`, so both `openspec/changes/<change>/tasks.md` and
  `openspec/specs/<capability>/tasks.md` resolve sensibly; sibling documents are
  `spec.md`, `proposal.md`, and `tasks.md`."
- **Evidence kind**: source
- **Evidence pointer**: src/discovery/adapters/open-spec.ts:14-25
- **Reasoning**: disjunctive detection, `segment-after` feature-name rule with the
  same three markers, and the sibling set all match the adapter module.

### C-018 — README.md:224-230 — BMAD section

- **Verdict**: true
- **Framework scope**: bmad
- **Claim**: "Task files under `bmad/` or `bmad-method/` — or any task file beside a
  `prd.md` / `architecture.md` — resolve to `bmad`; the feature name is the parent
  directory, falling back to the task file's own basename for story-style files
  with no feature dir. `docs/` is deliberately only a base directory, not a BMAD
  marker: a `docs/**` task file without BMAD siblings is `generic`, never silently
  `bmad`. Sibling documents cover the BMAD set: `requirements.md`, `design.md`,
  `architecture.md`, `prd.md`, and `spec.md`."
- **Evidence kind**: source
- **Evidence pointer**: src/discovery/adapters/bmad.ts:14-25
- **Reasoning**: markers, `parent-or-basename` feature-name rule, `docs/` as base
  only (bmad.ts:4-5,14), and the five-member sibling set all match.

### C-019 — README.md:239-240 — generic heading grammar example `Task 1.2`

- **Verdict**: ambiguous
- **Framework scope**: generic
- **Claim**: "The heading grammar is the broad built-in one (`T001`, `TASK-1`,
  `Task 1.2`, …), no framework title prefixes are stripped, and no
  framework-specific exclusions apply."
- **Evidence kind**: source
- **Evidence pointer**: src/config/defaults.ts:50
- **Reasoning**: the shipped `headingIdGrammar` captures a single leading id token
  followed by optional punctuation + whitespace — `## T001 …` and `## TASK-1 …`
  capture `T001` / `TASK-1`, and a bare-dotted id (`## 1.2 …`) captures `1.2`, but
  `## Task 1.2 …` captures the id **`Task`**, leaving `1.2 …` in the title. Listing
  `Task 1.2` as a grammar example promises a two-token id the grammar does not
  capture; the honest example is `Task 1.2:` (separator punctuation) or rewording
  the parenthetical. (Concrete parse appended by T010's demo run.)

### C-020 — README.md:241-243 — generic scaffold location

- **Verdict**: true
- **Framework scope**: generic
- **Claim**: "Its agent-hook scaffold (`install-agent-hook --framework generic`)
  lands in `.task-linear-sync/hooks/`."
- **Evidence kind**: source
- **Evidence pointer**: src/discovery/adapters/generic.ts:26
- **Reasoning**: generic's `agentHooksDirectory` is `.task-linear-sync/hooks/` and
  its template is `command-json` (src/discovery/conventions.ts:78); the prefix-
  stripping/exclusion clauses match the generic conventions record (no prefixes,
  no exclusions).

### C-021 — README.md:247-255 — customAdapters scope note

- **Verdict**: true
- **Framework scope**: all
- **Claim**: "register a custom adapter through the `task-linear-sync/discovery` API
  (`CustomAdapterDescriptor`: your id, path/base-directory patterns, task-file
  names, heading grammar — an incomplete descriptor is refused by naming every
  missing part before any I/O, and a custom id shadows a built-in only with an
  explicit opt-in). Scope note: custom adapters extend **discovery**; the five
  built-in frameworks are the only syncable identities, so a custom id never
  reaches `plan`/`apply`/`rollback` — the engine refuses it with a named error"
- **Evidence kind**: source
- **Evidence pointer**: src/discovery/conventions.ts:222
- **Evidence search scope**: `validateCustomDescriptor` collects **every** missing
  required part before any I/O (conventions.ts:222-239); built-in shadowing
  requires `shadowBuiltInId === true` (src/discovery/registry.ts:57-66); the engine
  refuses non-built-in adapter ids with a named error
  (src/engine/build.ts:497-500).
- **Reasoning**: all four clauses of the scope note verified.

### C-022 — README.md:261-264 — configuration precedence

- **Verdict**: true
- **Framework scope**: sync-core
- **Claim**: "precedence: CLI flag > environment variable > this file > defaults (a
  file value never overrides an explicit flag, so CI stays predictable)"
- **Evidence kind**: source
- **Evidence pointer**: src/config/load.ts::loadConfig
- **Reasoning**: the layered loader applies built-in defaults → JSON file →
  programmatic overrides (src/config/load.ts:2,97), with CLI flags and environment
  read in as explicit overrides above file values; re-derived defaults only fill
  unprovided layers (load.ts:85).

### C-023 — README.md:129-141 — MCP tool surface

- **Verdict**: true
- **Framework scope**: sync-core
- **Claim**: "The package ships an MCP server (`task-linear-sync/mcp`) exposing four
  tools: `task_sync_inventory`, `task_sync_plan` and `task_sync_status` (read-only)
  plus the gated `task_sync_apply` ... The read-only tools are enforced
  structurally, not by convention: no mutating tracker operation is reachable from
  a read-only tool, and CI scans keep it that way."
- **Evidence kind**: source
- **Evidence pointer**: src/mcp/create.ts:169-175
- **Reasoning**: exactly the four named tools are registered; read handlers receive
  no mutating operations (structural, pinned by the 012 contract suite).

### C-024 — README.md:145-153 — history server privacy/mutation posture

- **Verdict**: true
- **Framework scope**: sync-core
- **Claim**: "`task-linear-sync/history-server` serves the reconstructed sync history
  of a task as HTML, JSON, or a Server-Sent Events stream — addresses are exactly
  the URLs the engine records on issue attachments ... token auth from the
  environment, no static assets, no cookies beyond an opaque session, and no
  tracker mutation on any route."
- **Evidence kind**: source
- **Evidence pointer**: src/config/defaults.ts:126
- **Reasoning**: bearer-token env var defaults derive to `TLS_WEB_TOKEN` /
  `TLS_MCP_TOKEN` (src/config/defaults.ts:126,136; docs/configuration.md:79); the
  011 contract suite pins the read-only route posture.

### C-025 — README.md:285-291 — CI action contract

- **Verdict**: true
- **Framework scope**: sync-core
- **Claim**: "A GitHub composite action (`action.yml` at the repository root ...
  wraps the read-only `check`/`plan` commands and gates the step on three
  independently togglable conditions: unmapped high-confidence tasks, unresolved
  conflict blocks, and spec drift. Zero writes, zero tracker mutation — the apply
  path is not reachable from the CI layer by construction, and a Linear/plan
  outage degrades to a warning rather than a false failure"
- **Evidence kind**: source
- **Evidence pointer**: action.yml:24-36
- **Reasoning**: the three `fail-on-*` inputs + `drift-threshold` exist; the CI
  lane runs only read-only commands (013 contract suite).

### C-026 — README.md:309-326 — twelve commands, placeholder-safe output

- **Verdict**: true
- **Framework scope**: sync-core
- **Claim**: "Twelve commands; human output is placeholder-safe (no real identifiers
  ever printed)." (CLI reference table of twelve `| \`cmd\` |` rows)
- **Evidence kind**: source
- **Evidence pointer**: src/cli/commands.ts:174
- **Evidence search scope**: the CLI command registry registers exactly the twelve
  commands tabulated (inventory, discover-metadata, plan, bootstrap, sync, check,
  install-hooks, install-agent-hook, enqueue, worker, last-run, rollback);
  placeholder-safe identifier suppression is pinned by the 009 CLI contract suite.
- **Reasoning**: table rows verified one-for-one against the registry and
  `--help` grammar.

### C-027 — README.md:328-330 — exit-code map

- **Verdict**: true
- **Framework scope**: sync-core
- **Claim**: "Exit codes: `0` success · `1` unexpected · `2` usage · `3`
  configuration · `4` gate-refused · `5` run-aborted · `6` lock-held · `7`
  surface-unavailable · `8` check-findings."
- **Evidence kind**: source
- **Evidence pointer**: src/cli/commands.ts:174
- **Reasoning**: the `--help` exit map prints the identical nine-code contract
  (src/cli/commands.ts:174-175, src/cli/exit-codes.ts).

### C-028 — README.md:332-337 — token environment variables

- **Verdict**: true
- **Framework scope**: sync-core
- **Claim**: "One token drives everything Linear-facing: `LINEAR_ACCESS_TOKEN` (the
  *variable name* is configuration, the value is never read from a file and never
  appears in any output). The history page and the MCP HTTP transport each take
  their own bearer token for their own endpoints (`TLS_WEB_TOKEN` and
  `TLS_MCP_TOKEN` by default — names likewise configurable...)"
- **Evidence kind**: source
- **Evidence pointer**: src/config/defaults.ts:82
- **Reasoning**: `credentialEnvVarNames.token` defaults to `LINEAR_ACCESS_TOKEN`
  (defaults.ts:82); web/MCP bearer env names derive from the tool-id prefix to
  `TLS_WEB_TOKEN` / `TLS_MCP_TOKEN` (defaults.ts:30-31,126,136) and are
  configurable keys.

### C-029 — README.md:28-39 — packaging posture

- **Verdict**: true
- **Framework scope**: sync-core
- **Claim**: "**Available on npm** ... **Version posture**: the package is in its
  0.x line ... **Requires** Node 20 or newer wherever the tool runs ... the tool
  ships with **zero runtime dependencies**"
- **Evidence kind**: source
- **Evidence pointer**: package.json:11-13
- **Evidence search scope**: package.json carries `"node": ">=20.0.0"` and version
  `0.2.0`, and contains no `dependencies` block at all (zero runtime deps); the
  0.x posture is documented in docs/versioning.md.
- **Reasoning**: every Status-section numeric/posture claim matches the manifest.

## Coverage table (appendix)

Populated by T011 once the full enumeration (T004–T008) lands. Rows: one per audited
document, every located framework-behavior sentence verbatim with its claim id or
`N/A` + reason.

## Audit environment notes

- Audited from the dedicated worktree for branch `019-speckit-doc-truthfulness`
  (`/home/agentuser/repos/task-linear-sync-019`) at tip `f2487c1`; the shared checkout
  hosts concurrent 018 work and was not used for evidence gathering.
- Every `src/` pointer in this record was re-verified against the **committed** tree at
  this branch tip (not a working tree carrying a concurrent feature's uncommitted
  edits). Two items seen in a dirty checkout earlier — a `docs/contract-amendments.md`
  2026-11-05 amendment block and `preserveLocalTaskId` mentions in
  `specs/002-core-domain-contracts/**` — are **not** in the baseline and are excluded
  from evidence.
- The report's grouping bucket field is internally named `milestone` but its value is
  the `featureName` grouping key — cited in C-007's search scope so the distinction is
  on record.
