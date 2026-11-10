# Claim Audit: Documentation Truthfulness

- Baseline commit: 1fccd080f41af5a503c16724544dc937083a156d
- Audited documents: README.md, docs/framework-adapters.md, docs/discovery.md,
  docs/parsing.md, specs/requirements.md
- Open false/ambiguous verdicts: 14

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
  T001 checkbox ids to be the captured ones.
- **Demonstration** (T010, evidence kind `demo`; 2026-11-10, branch tip build):
  `npm run build`, then drive `parseTaskFile` from `dist/parsing` —

  ```js
  import { parseTaskFile } from "task-linear-sync/parsing"; // dist/parsing/index.js
  import { builtInAdapters } from "task-linear-sync/discovery";
  import { builtInDefaults } from "task-linear-sync/config";
  import { taskStableSeed } from "task-linear-sync/domain";

  const content = [
    "**Tests**: REQUIRED",
    "",
    "## Phase 1: Setup",
    "",
    "- [ ] T001 Create the scaffold",
    "- [ ] T002 Wire the CLI entry point",
    "",
  ].join("\n");
  const result = parseTaskFile("specs/demo/tasks.md", content, builtInAdapters["spec-kit"], builtInDefaults);
  result.file.tasks.forEach((t, i) =>
    console.log(`line ${t.lineNumber}: localTaskId=${JSON.stringify(t.localTaskId ?? null)} ` +
      `title=${JSON.stringify(t.title)} seed=${JSON.stringify(taskStableSeed(t, { ordinal: i, filePath: "specs/demo/tasks.md" }))}`));
  ```

  Observed output:

  ```
  line 5: localTaskId=null title="T001 Create the scaffold" seed="spec-kit\u0000demo\u00000:specs/demo/tasks.md"
  line 6: localTaskId=null title="T002 Wire the CLI entry point" seed="spec-kit\u0000demo\u00001:specs/demo/tasks.md"
  ```

  Both checkbox tasks parse with **no** `localTaskId` and fall back to the
  `ordinal:filePath` stable seed. Control: the same run parsed the heading line
  `## T001 Create the scaffold` with `localTaskId="T001"`, confirming the split
  is heading-vs-checkbox, not framework-vs-framework.

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
  the parenthetical.
- **Demonstration** (T010, same run as C-002): parsing `## Task 1.2 Configure
  linting` with the shipped defaults yields `localTaskId="Task"` and
  `title="1.2 Configure linting"` — the id captured is the single token `Task`,
  not the two-token `Task 1.2` the README example lists.

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

### C-030 — docs/framework-adapters.md:3-6 — declarative adapters, no I/O

- **Verdict**: true
- **Framework scope**: all
- **Claim**: "Feature 003 associates every discovered task file with a **framework
  identity** using small, declarative convention bundles called **framework
  adapters**. Discovery is strictly read-only; adapters themselves perform no I/O —
  the discovery caller supplies the directory context (`DetectionContext`) that
  detection needs."
- **Evidence kind**: source
- **Evidence pointer**: src/discovery/registry.ts::selectAdapter
- **Reasoning**: adapter `detect` functions are pure over the supplied context
  (e.g. kiro.ts:15); traversal I/O lives in `discoverTaskFiles`
  (src/discovery/discover.ts:90), which is read-only end to end.

### C-031 — docs/framework-adapters.md:13-19 — built-in adapter table

- **Verdict**: true
- **Framework scope**: all
- **Claim**: built-in adapter table — base directories, detection markers,
  `Feature_Name` rule, sibling documents, and "Agent-hook directory / template"
  columns for all five rows (`.kiro/hooks/` · `kiro-json`; `generic`
  `.task-linear-sync/hooks/` · `command-json`; the other rows `—`)
- **Evidence kind**: source
- **Evidence pointer**: src/discovery/adapters/kiro.ts:14-22
- **Evidence search scope**: row-by-row against kiro.ts:14-22, spec-kit.ts:14-26,
  open-spec.ts:14-25, bmad.ts:14-25, generic.ts:17-26; hook directory/template
  cells against conventions.ts:78. Every cell matches.
- **Requirements check**: requirements-agree

### C-032 — docs/framework-adapters.md:21-34 — adapter-table notes

- **Verdict**: true
- **Framework scope**: all
- **Claim**: "`generic` carries **no framework-specific exclusions**
  (`frameworkSpecificExclusions: []`, FR-010) … Base directories are **discovery
  hints**, not selection markers … Grammar fields (`headingGrammar`,
  `phasePattern`, `summaryPattern`, `rollupPattern`, `titleBehavior.stripPrefixes`)
  are regex-source strings consumed downstream (004/005). 003 never parses task
  content. `builtInAdapters` … is the frozen five-key record … of immutable
  `FrameworkAdapter` values."
- **Evidence kind**: source
- **Evidence pointer**: src/discovery/adapters/index.ts:18
- **Reasoning**: `builtInAdapters` is `deepFreeze`d (index.ts:18); generic's empty
  exclusion set (generic.ts:18-24); `docs/` appears only as a bmad base
  (bmad.ts:4-5,14); grammar fields are regex-source config strings
  (src/config/defaults.ts:50-53).

### C-033 — docs/framework-adapters.md:38-46 — selection ranking

- **Verdict**: true
- **Framework scope**: all
- **Claim**: "the winner is chosen by: 1. **Longest `matchedPattern`** (string
  length). … `selectAdapter(filePath, ctx, registry)`) is a pure function. Every
  enabled adapter whose `detect` returns a match becomes a candidate"
- **Evidence kind**: source
- **Evidence pointer**: src/discovery/registry.ts:92-137
- **Reasoning**: rank comparator on `matchedPattern.length` (registry.ts:92-94),
  then precedence index, then alphabetical (registry.ts:149); siblings-only
  matches carry `matchedPattern: ""`.

### C-034 — docs/framework-adapters.md:48-52 — fallback, explicit override, candidates

- **Verdict**: true
- **Framework scope**: all
- **Claim**: "Zero matches fall back to `generic` (`detection.via: "fallback"`). An
  explicit `overrides.selection` (fixed id or predicate) short-circuits detection
  entirely (`via: "explicit"`); an id outside the enabled pool raises
  `SelectionOverrideError`. The full result set of matched adapter ids is recorded,
  sorted alphabetically, on every `DiscoveredFile.detection.candidates`"
- **Evidence kind**: source
- **Evidence pointer**: src/discovery/registry.ts:104-137
- **Reasoning**: `via: "explicit"` + `SelectionOverrideError`
  (registry.ts:110-117), `via: "fallback"` (registry.ts:134), candidate list
  `.sort()`ed (registry.ts:106).

### C-035 — docs/framework-adapters.md:54-70 — three override layers

- **Verdict**: true
- **Framework scope**: all
- **Claim**: "Convention resolution follows constitution III exactly — later layers
  win … Every convention in `FrameworkAdapter` is overridable at layers 2–3
  (SC-004); the override matrix is gated by
  `tests/unit/discovery-overrides.test.ts`."
- **Evidence kind**: test
- **Evidence pointer**: tests/unit/discovery-overrides.test.ts
- **Reasoning**: the gating test file exists at HEAD; layering implemented in
  src/discovery/conventions.ts (config layer + per-adapter `overrides.adapters`).

### C-036 — docs/framework-adapters.md:72-100 — custom adapter semantics

- **Verdict**: true
- **Framework scope**: all
- **Claim**: "A custom adapter needs at least an `id`, task-file/base-directory
  patterns, and a heading grammar (FR-011) … An incomplete descriptor aborts with
  `CustomAdapterError` listing **every** missing required part at once. An `id`
  that shadows a built-in is rejected by default; set `shadowBuiltInId: true` to
  opt in"
- **Evidence kind**: source
- **Evidence pointer**: src/discovery/conventions.ts:222
- **Reasoning**: `validateCustomDescriptor` collects all misses in one throw
  (conventions.ts:222-239); shadow opt-in enforced at registry.ts:57-66.

### C-037 — docs/framework-adapters.md:102-108 — scaffold record

- **Verdict**: true
- **Framework scope**: all
- **Claim**: "`kiro` yields `.kiro/hooks/<binName>-sync.json`, `generic` yields
  `.task-linear-sync/hooks/<binName>-sync.json`; both are JSON records whose
  `command` action runs `<binName> enqueue`. Frameworks without a template return
  `undefined`."
- **Evidence kind**: source
- **Evidence pointer**: src/discovery/agent-hooks.ts:22-30
- **Reasoning**: `agentHookScaffold` builds
  `{ directory, fileName: "<binName>-sync.json", contents: { action: "command",
  command: "<binName> enqueue" } }` from the adapter row and returns `undefined`
  for template-less frameworks (agent-hooks.ts:27).

### C-038 — docs/discovery.md:3-5 — read-only posture

- **Verdict**: true
- **Framework scope**: all
- **Claim**: "`discoverTaskFiles` finds candidate task files in a repository and
  associates each with a framework identity — **read-only**: zero writes, zero
  tracker calls, zero state-directory involvement."
- **Evidence kind**: source
- **Evidence pointer**: src/discovery/discover.ts::discoverTaskFiles
- **Evidence search scope**: no `writeFile`/tracker/state-dir import in
  src/discovery/; discovery touches only fs read calls.

### C-039 — docs/discovery.md:11-14 — canonical root pre-flight

- **Verdict**: true
- **Framework scope**: sync-core
- **Claim**: "`repositoryRoot` is resolved to an absolute, symlink-resolved path
  (`path.resolve` + `fs.realpath`). The pre-flight then requires an existing,
  readable directory; otherwise `DiscoveryRootError` aborts with `condition` set to
  `"missing"`, `"not-a-directory"`, or `"unreadable"` — **before any traversal or
  file read**."
- **Evidence kind**: source
- **Evidence pointer**: src/discovery/root.ts::canonicalizeRepositoryRoot
- **Reasoning**: `canonicalizeRepositoryRoot` (root.ts:21) + `DiscoveryRootError`
  (src/discovery/types.ts:100); pinned by tests/unit/discovery-root.test.ts.

### C-040 — docs/discovery.md:16-21 — skip rules and symlink exclusion

- **Verdict**: true
- **Framework scope**: sync-core
- **Claim**: "Every directory whose *name* matches a configured `skipDirectories`
  entry (defaults `.git`, `node_modules`, `dist`, `.next`, `coverage`) is skipped
  at any depth without descending. Only regular files are matched, on their
  basename … Symlinked files and directories are excluded from results and never
  traversed, silently, without aborting the walk"
- **Evidence kind**: source
- **Evidence pointer**: src/config/defaults.ts:46
- **Reasoning**: defaults match exactly (defaults.ts:46); traversal semantics pinned
  by tests/unit/discovery-traverse.test.ts.

### C-041 — docs/discovery.md:23-30 — escape refusals

- **Verdict**: true
- **Framework scope**: sync-core
- **Claim**: "a symlink that resolves outside the root is refused with
  `{ path, reason: "escape" }` recorded in `result.refusals` — no read is performed
  and discovery continues … `verifyInsideRoot(canonicalRoot, candidateAbsolute)`
  is exported so 004 (parsing) and 008 (state-relevant reads) honor the same
  guard."
- **Evidence kind**: source
- **Evidence pointer**: src/discovery/root.ts::verifyInsideRoot
- **Reasoning**: `verifyInsideRoot` exported (root.ts:61, re-exported in
  src/discovery/index.ts:37); refusal recording in discover.ts.

### C-042 — docs/discovery.md:32-35 — determinism

- **Verdict**: true
- **Framework scope**: sync-core
- **Claim**: "`files` are sorted byte-wise lexicographically on the root-relative
  POSIX `filePath` … Two consecutive runs over an unchanged tree serialize
  byte-for-byte identically (SC-002). An empty or task-file-free repository
  returns `files: []` — not an error."
- **Evidence kind**: test
- **Evidence pointer**: tests/unit/discovery-traverse.test.ts
- **Reasoning**: deterministic-sort and empty-result behavior pinned by the 003
  suite.

### C-043 — docs/discovery.md:37-45 — file-based git context

- **Verdict**: true
- **Framework scope**: sync-core
- **Claim**: "Version-control context is read from files only — never a `git`
  binary: `.git/HEAD`, the resolved loose ref falling back to `.git/packed-refs`,
  and `.git/config` (`[remote "origin"] url`), with one-level `gitdir:` gitfile
  indirection. Each value is individually omitted when unavailable … never failing
  the run … Pass `gitContext: false` to skip the reads entirely"
- **Evidence kind**: test
- **Evidence pointer**: tests/unit/discovery-git.test.ts
- **Reasoning**: all listed sources, omission semantics, and the `gitContext:
  false` switch are pinned by the git-context contract tests; no child_process
  import in src/discovery/.

### C-044 — docs/discovery.md:77-81 — exported discovery surface

- **Verdict**: true
- **Framework scope**: all
- **Claim**: "`canonicalizeRepositoryRoot`, `verifyInsideRoot`, `discoverGitContext`,
  `compileNamePattern`, `selectAdapter`, `createAdapterRegistry`,
  `frameworkMetadataFragment`, and `agentHookScaffold` round out the exported
  surface — all snapshot-gated by `tests/contract/discovery-surface.test.ts`"
- **Evidence kind**: test
- **Evidence pointer**: tests/contract/discovery-surface.test.ts
- **Reasoning**: gate file exists at HEAD; the listed symbols are re-exported from
  src/discovery/index.ts.

### C-045 — docs/parsing.md:3-7 — purity and sole-writer posture

- **Verdict**: true
- **Framework scope**: sync-core
- **Claim**: "Zero filesystem, zero network, zero clock (constitution I): parsing
  takes content in; rendering returns rewritten content out; **the gated engine
  (008) is the only writer**. The only Node import is `node:crypto`."
- **Evidence kind**: source
- **Evidence pointer**: src/parsing/render.ts::renderTaskLines
- **Evidence search scope**: the only `node:` import across src/parsing/ is
  `node:crypto` (identity.ts digest); import purity gated by
  tests/contract/parsing-purity.test.ts.

### C-046 — docs/parsing.md:13-28 — `parseTaskFile` contract

- **Verdict**: true
- **Framework scope**: sync-core
- **Claim**: "All four parameters are required. Content is split into
  terminator-preserving lines (`splitLines` …) … `result.exclusions` — everything
  recognized-but-excluded … `result.conflictBlocks` — unresolved-conflict spans:
  the renderer's freeze set (FR-009) … `result.featureName` — adapter-derived
  Feature_Name, ABSENT when underivable (FR-008)"
- **Evidence kind**: source
- **Evidence pointer**: src/parsing/extract.ts::extractTasks
- **Reasoning**: taskfile.ts/extract.ts implement the documented result shape;
  conflict spans feed the renderer freeze set (render.ts:145 `frozen`); pinned by
  the parsing contract suite.

### C-047 — docs/parsing.md:30-32 — Stable_UUID derivation

- **Verdict**: true
- **Framework scope**: sync-core
- **Claim**: "Stable_UUIDs are computed here, never read from files (002 R11):
  build the seed with the frozen `taskStableSeed()` and pass it to
  `deriveStableUuid(seed, toolId)` — a SHA-256 digest folded into a lowercase
  RFC 4122 v5-shaped UUID. Same inputs, same UUID, forever."
- **Evidence kind**: source
- **Evidence pointer**: src/parsing/identity.ts::deriveStableUuid
- **Reasoning**: `deriveStableUuid` (identity.ts:26) + frozen
  `taskStableSeed` (src/domain/task.ts:92); determinism pinned by contract tests.

### C-048 — docs/parsing.md:36-40 — rendered-line span preservation

- **Verdict**: true
- **Framework scope**: sync-core
- **Claim**: "Rewrites ONLY assigned lines. Every rendered line keeps its original
  bytes from line start through the heading hashes (or checklist marker + checkbox)
  and its leading local-task-ID span; after that comes `` `[${issueRef.key}-${issueRef.number}] ` + cleanTitle(desiredTitle) `` — the token is omitted when the
  assignment carries no `issueRef`. Options: `preserveLocalTaskId` (default `true`)
  drops the local-ID span when `false`."
- **Evidence kind**: source
- **Evidence pointer**: src/parsing/render.ts:132
- **Reasoning**: `preserveLocalId = options.preserveLocalTaskId ?? true`
  (render.ts:132) and the span-preserving rewrite documented at render.ts:8; the
  preserved "local-task-ID span" is exactly the `LOCAL_ID_SPAN_RE` grammar span —
  the doc consistently refers to the span grammar, never promising bare
  `T001` checkbox capture (T007 key check).

### C-049 — docs/parsing.md:48-51 — checkbox and terminator reproduction

- **Verdict**: true
- **Framework scope**: sync-core
- **Claim**: "Checkbox state: `checked: true` writes `[x]`, `checked: false` writes
  `[ ]`; when the assignment omits `checked` the existing state byte survives
  **byte-for-byte** (`[X]` stays `[X]`). Unassigned lines, per-line terminators,
  the trailing-newline style, and a final unterminated line all reproduce exactly
  (FR-012, SC-002)."
- **Evidence kind**: test
- **Evidence pointer**: tests/contract/parsing-surface.test.ts
- **Reasoning**: byte-exact reproduction is the 004 SC-002 property, pinned by the
  parsing contract suite (render.ts checkbox-state branch).

### C-050 — docs/parsing.md:53-64 — abort-all validation and reasons

- **Verdict**: true
- **Framework scope**: sync-core
- **Claim**: "Assignments are validated **ascending, ALL before ANY rewriting**.
  The first structural surprise throws `LineRenderError { filePath, lineNumber,
  reason }` … reasons: `structure-mismatch` … `inside-fence` …
  `inside-conflict-block` … `line-out-of-range`"
- **Evidence kind**: source
- **Evidence pointer**: src/parsing/render.ts:40
- **Reasoning**: the four-member `LineRenderFailureReason` union (render.ts:40)
  equals the table; throws happen before any mutation (render.ts:142-148).

### C-051 — docs/parsing.md:66-72 — `cleanTitle` fixpoint

- **Verdict**: true
- **Framework scope**: sync-core
- **Claim**: "Strips configured `titleStripPrefixes`, redundant
  `[<Confirmation_Key>-<N>]` references (bracketed anywhere, bare leading — other
  keys are never touched), and duplicate leading local-ID prefixes, **iterating to
  a fixpoint**. Idempotent by construction: render → parse → render emits
  identical titles with no progressive prefixing (constitution IV)."
- **Evidence kind**: source
- **Evidence pointer**: src/parsing/title.ts::cleanTitle
- **Reasoning**: `cleanTitle` (title.ts:28) implements the fixpoint loop;
  idempotence pinned by the 004/005 contract suites.

### C-052 — docs/parsing.md:74-85 — adapter-consumption boundary and wave-3 seam

- **Verdict**: true
- **Framework scope**: sync-core
- **Claim**: "`src/parsing/` consumes trackers **only** through the consumer-owned
  `TaskFileAdapter` interface … no imports from `src/discovery/` or any feature-003
  module, no I/O (both enforced by the import-purity contract) … **Wave-3 seam
  (deferred, not a 004 task):** when 003 lands, the integrating wave adds
  `003-generic-adapter-satisfies-consumption-contract`"
- **Evidence kind**: absence-search
- **Evidence pointer**: tests/contract/parsing-purity.test.ts
- **Evidence search scope**: no `src/discovery` import anywhere under
  src/parsing/ (purity contract file present at HEAD). The named wave-3 test does
  **not** exist yet — but the sentence self-labels the seam "deferred, not a 004
  task", so it states future intent, not shipped behavior: truthful as worded.
- **Reasoning**: adjudicated per T007's deferred-seam note — a future-audit entry
  point if the seam lands without the label being updated.

### C-053 — docs/parsing.md:87-93 — surface drift alarms

- **Verdict**: true
- **Framework scope**: sync-core
- **Claim**: "The public export set is snapshot-gated
  (`tests/contract/parsing-surface.test.ts` +
  `tests/contract/snapshots/parsing-surface.json`) and the negative-type boundary
  is compile-checked (`tests/types/parsing.test-d.ts`) … amend the snapshot
  deliberately with `UPDATE_PARSING_SNAPSHOT=1 npm run test:contract`."
- **Evidence kind**: source
- **Evidence pointer**: tests/contract/parsing-surface.test.ts:50
- **Reasoning**: snapshot gate + `UPDATE_PARSING_SNAPSHOT` escape hatch verified at
  the cited line; tests/types/parsing.test-d.ts exists.

### C-054 — specs/requirements.md:115 (R2.2) — mandated heading-grammar default

- **Verdict**: false
- **Framework scope**: all
- **Claim**: "WHEN a heading's text matches the configured heading-id grammar for
  the task's active framework adapter (default: a case-insensitive leading
  identifier matching
  `(?:[A-Z][A-Z0-9_]{1,8}-\d+(?:\.\d+)?|Task\s+\d+(?:\.\d+)?|T\d{2,5})`, optionally
  followed by `: <title>` or whitespace `<title>`; overridable)"
- **Evidence kind**: source
- **Evidence pointer**: src/config/defaults.ts:50
- **Requirements check**: requirements-mandate-code-lacks
- **Reasoning**: the shipped `headingIdGrammar` default is a different, broader
  pattern (`^\\s{0,3}#{1,6}\\s+(?:(?<id>[0-9]+(?:\\.[0-9]+)*|[A-Za-z][A-Za-z0-9-]*\\d*)[.:]?\\s+)?(?<title>.+)$`); notably the mandated
  `Task\\s+\\d+(?:\\.\\d+)?` alternative (a two-token id captured whole) is NOT in
  the code default — shipped captures `Task` alone. Requirement left untouched
  (governance); the shipped-vs-mandated default drift is routed as FU-002.

### C-055 — specs/requirements.md:118 (R2.5) — mandated phase-pattern default

- **Verdict**: false
- **Framework scope**: all
- **Claim**: "THE System SHALL track the current phase as the text of the most
  recent heading matching the configured phase pattern (default: case-insensitive
  `(?:phase|story|milestone)\\s+\\d+`; overridable)"
- **Evidence kind**: source
- **Evidence pointer**: src/config/defaults.ts:51
- **Requirements check**: requirements-mandate-code-lacks
- **Reasoning**: shipped `phasePattern` default matches only `Phase\\s+[0-9]+` in
  an H1/H2 heading (case-sensitive); the mandated `story`/`milestone` alternatives
  and case-insensitivity are absent. Routed to FU-002; requirement untouched.

### C-056 — specs/requirements.md:119 (R2.6) — mandated summary-pattern default

- **Verdict**: false
- **Framework scope**: all
- **Claim**: "the configured summary-section pattern (default: a case-insensitive
  match at heading level 1 or 2 of any of `success criteria summary`, `summary`,
  `timeline estimate`, `risk management`, `next steps`, `acceptance criteria
  summary`, or `definition of done`; overridable)"
- **Evidence kind**: source
- **Evidence pointer**: src/config/defaults.ts:52
- **Requirements check**: requirements-mandate-code-lacks
- **Reasoning**: shipped `summaryPattern` default is
  `^\\s{0,3}#{2,4}\\s+(?:Summary|Overview)\\b` — heading levels 2–4, two
  literals; the mandated seven-phrase, level-1-or-2 default is absent. Routed to
  FU-002; requirement untouched.

### C-057 — specs/requirements.md:120 (R2.7) — mandated rollup-pattern default

- **Verdict**: false
- **Framework scope**: all
- **Claim**: "the configured rollup-label pattern (default: a bold-label line
  matching case-insensitively `**…completion checklist…**`,
  `**…success criteria summary…**`, or `**…definition of done…**`; overridable)"
- **Evidence kind**: source
- **Evidence pointer**: src/config/defaults.ts:53
- **Requirements check**: requirements-mandate-code-lacks
- **Reasoning**: shipped `rollupPattern` default is `\\b(?:parent|roll-?up)\\b` —
  none of the mandated bold-label defaults. Routed to FU-002; requirement
  untouched.

### C-058 — specs/requirements.md:215 (R7.4) — adapter supplies checklist identifier grammar

- **Verdict**: false
- **Framework scope**: all
- **Claim**: "THE active `Framework_Adapter` SHALL supply, directly or via
  configuration, task-file patterns, base directories, framework detection rules,
  `Feature_Name` extraction rules, heading/checklist identifier grammar,
  phase/summary/rollup patterns, sibling document names, default title strip
  prefixes, and optional agent-hook template behavior."
- **Evidence kind**: source
- **Evidence pointer**: src/parsing/content.ts:167-168
- **Requirements check**: requirements-mandate-code-lacks
- **Reasoning**: adapters/config supply the **heading** grammar
  (`headingIdGrammar`), but the **checklist** leading-id span grammar
  (`LOCAL_ID_SPAN_RE`) is a module-local constant — not adapter-supplied and not
  configurable. Routed as FU-003; requirement untouched.

### C-059 — specs/requirements.md:121 (R2.8) — mandated flat-checklist default

- **Verdict**: false
- **Framework scope**: all
- **Claim**: "WHERE a document matches the configured flat-checklist detection
  markers (default: the path-marker list is empty, so a document is treated as flat
  only when it contains no heading matching the heading-id grammar; overridable)"
- **Evidence kind**: source
- **Evidence pointer**: src/config/defaults.ts:54
- **Requirements check**: requirements-mandate-code-lacks
- **Reasoning**: shipped `flatChecklistMarkers` defaults to checkbox literals
  (`- [ ]`, …) and the second trigger (no grammar heading ⇒ flat) IS implemented
  (src/parsing/extract.ts:81-83) — but the mandated *default marker list is empty*
  while the shipped default is non-empty, so a grammar-headed doc whose first text
  line is a checkbox is flat in the code and non-flat under the mandated default.
  Default-value drift only; routed to FU-002; requirement untouched.

### C-060 — specs/requirements.md:5 (Introduction) — supported-framework set

- **Verdict**: true
- **Framework scope**: all
- **Claim**: "The supported frameworks are BMAD, GitHub SpecKit, open-spec, and
  Kiro, plus a generic Markdown fallback … These five built-in frameworks are the
  complete set of syncable framework identities: custom adapter configuration
  (Requirement 7.6) extends discovery for other repository layouts, but adds no
  framework identity to the plan/apply surface."
- **Evidence kind**: source
- **Evidence pointer**: src/engine/build.ts:497-500
- **Requirements check**: requirements-agree
- **Reasoning**: matches shipped behavior exactly (see C-021).

### C-061 — specs/requirements.md:27 (Glossary) — Supported_Framework

- **Verdict**: true
- **Framework scope**: all
- **Claim**: "**Supported_Framework**: One of `bmad`, `spec-kit`, `open-spec`,
  `kiro`, or `generic`; these five built-ins are the only identities the sync
  surface admits — a custom adapter (Requirement 7.6) supplies discovery
  conventions, not a new supported framework."
- **Evidence kind**: source
- **Evidence pointer**: src/engine/build.ts:497-500
- **Requirements check**: requirements-agree

### C-062 — specs/requirements.md:5 (Introduction) — durable anchor story

- **Verdict**: true
- **Framework scope**: sync-core
- **Claim**: "reconciles workflow state and checkbox completion, and writes the
  visible issue-reference prefix back into the Markdown while the durable identity
  anchor lives in the Linear attachment metadata"
- **Evidence kind**: source
- **Evidence pointer**: src/domain/task.ts::taskStableSeed
- **Requirements check**: requirements-agree
- **Reasoning**: the requirement itself states the as-built durability story
  (visible `[KEY-N]` reference + attachment anchor, no in-file marker — R2.9);
  this is the normative basis of the C-006 README correction and GUARD-07.

### C-063 — specs/requirements.md:122-123 (R2.9, R2.10) — no in-file marker; visible prefix

- **Verdict**: true
- **Framework scope**: sync-core
- **Claim**: "WHEN parsing a task line, THE System SHALL parse no in-file identity
  marker and SHALL derive the task's `Stable_UUID` per criterion 11." + criterion
  10's visible `[<KEY>-<N>]` prefix parsing
- **Evidence kind**: absence-search
- **Evidence pointer**: src/parsing/content.ts:167-168
- **Evidence search scope**: parser admits only the reference token and the
  leading local-id span; no marker syntax anywhere in src/parsing/.
- **Requirements check**: requirements-agree

### C-064 — specs/requirements.md:124 (R2.11) — stable-seed composition

- **Verdict**: true
- **Framework scope**: sync-core
- **Claim**: "the stable positional seed SHALL include `Framework_Id`,
  `Feature_Name` when present, and `Local_Task_ID` when present, and SHALL fall
  back to a stable task ordinal and task-file identity when no `Local_Task_ID` is
  present, while excluding the visible issue prefix, checkbox state, and mutable
  title text"
- **Evidence kind**: source
- **Evidence pointer**: src/domain/task.ts:92-97
- **Requirements check**: requirements-agree
- **Reasoning**: `taskStableSeed` composition and the `ordinal:filePath` fallback
  match the criterion word-for-word in behavior.

### C-065 — specs/requirements.md:125 (R2.12) — configurable leading identifier grammar

- **Verdict**: true
- **Framework scope**: all
- **Claim**: "WHEN parsing a heading or checklist line, THE System SHALL parse a
  `Local_Task_ID` when the configured identifier grammar matches at the beginning
  of the task title, and SHALL record the parsed `Local_Task_ID` on the task."
- **Evidence kind**: source
- **Evidence pointer**: src/parsing/content.ts:167-168
- **Requirements check**: requirements-agree
- **Reasoning**: as-built matches (the shipped span grammar requires its
  separator — the requirement never promises separator-free capture; the
  reader-facing misreading lives in README C-002, routed as FU-001 enhancement,
  not a requirements defect).

### C-066 — specs/requirements.md:126-127 (R2.13/R2.14) — duplicate warnings

- **Verdict**: true
- **Framework scope**: sync-core
- **Claim**: "THE System SHALL emit a warning identifying the shared ID and the
  1-based line numbers of all occurrences" (duplicate local task id) and the
  shared-issue-reference counterpart
- **Evidence kind**: source
- **Evidence pointer**: src/parsing/warnings.ts:12
- **Requirements check**: requirements-agree
- **Reasoning**: `ParseWarning` kinds `duplicate-local-id` /
  `duplicate-issue-ref` with shared value + all line numbers (warnings.ts:12-46).

### C-067 — specs/requirements.md:117 (R2.4) — tab width default

- **Verdict**: true
- **Framework scope**: all
- **Claim**: "normalize leading indentation by mapping each tab to the configured
  tab width (default 2 spaces; overridable)"
- **Evidence kind**: source
- **Evidence pointer**: src/config/defaults.ts:55
- **Requirements check**: requirements-agree

### C-068 — specs/requirements.md:114 (R2.1) — fenced-region exclusion

- **Verdict**: true
- **Framework scope**: sync-core
- **Claim**: "WHILE parsing lines located between a fenced-code-block opening
  delimiter and its matching closing delimiter, THE System SHALL treat those lines
  as non-task text and SHALL exclude them from task extraction."
- **Evidence kind**: source
- **Evidence pointer**: src/parsing/content.ts:38
- **Requirements check**: requirements-agree
- **Reasoning**: fence marking (`inFence`, delimiter lines included) feeds every
  extraction path (content.ts:23-24,38; extract.ts fence guards).

### C-069 — specs/requirements.md:212-213 (R7.1/R7.2) — built-ins and detection rules

- **Verdict**: true
- **Framework scope**: all
- **Claim**: "THE System SHALL provide built-in `Framework_Adapter`s for `bmad`,
  `spec-kit`, `open-spec`, `kiro`, and `generic`." + criterion 2's per-framework
  detection sentences
- **Evidence kind**: source
- **Evidence pointer**: src/discovery/adapters/kiro.ts:14-22
- **Requirements check**: requirements-agree
- **Reasoning**: adjudicated row-by-row as in C-031; identical conclusion.

### C-070 — specs/requirements.md:214 (R7.3) — selection ranking

- **Verdict**: true
- **Framework scope**: all
- **Claim**: "IF multiple adapters match a task file, THEN THE System SHALL select
  one using the longest matching configured path or base-directory pattern, then
  the configured adapter precedence, then deterministic alphabetical tie-break"
- **Evidence kind**: source
- **Evidence pointer**: src/discovery/registry.ts:92-137
- **Requirements check**: requirements-agree

### C-071 — specs/requirements.md:216-221 (R7.5) — built-in defaults listing

- **Verdict**: true
- **Framework scope**: all
- **Claim**: the five per-framework default rows of criterion 5 (bases, task file,
  `Feature_Name` rules, sibling documents, kiro hook directory, generic "broad
  task-identifier grammar")
- **Evidence kind**: source
- **Evidence pointer**: src/discovery/adapters/bmad.ts:14-25
- **Requirements check**: requirements-agree
- **Reasoning**: matches the shipped adapter records (see C-011/C-031); the
  generic "broad task-identifier grammar" phrase names the shipped broad
  `headingIdGrammar` — it does not promise the two-token `Task 1.2` capture (see
  C-019 for the README sentence that does).

### C-072 — specs/requirements.md:222 (R7.6) — override surface and custom minimum

- **Verdict**: true
- **Framework scope**: all
- **Claim**: "THE System SHALL allow consumers to override framework selection,
  adapter precedence, task-file patterns, base directories, heading grammar,
  phase/summary/rollup patterns, sibling document names, `Feature_Name` extraction
  behavior, and title strip prefixes, and SHALL allow custom framework adapter
  configuration that supplies at least an adapter id, path/base-directory
  patterns, and heading grammar."
- **Evidence kind**: source
- **Evidence pointer**: src/discovery/conventions.ts:222
- **Requirements check**: requirements-agree
- **Reasoning**: each named override exists as a config/overrides key (grammar
  defaults.ts:50-53; selection/precedence registry.ts:83-99; per-adapter
  overrides.adapters) and the custom minimum matches `validateCustomDescriptor`.
  Note: the **checklist**-grammar leg of R7.4 (not R7.6) is the mandate the code
  lacks — see C-058/FU-003.

### C-073 — specs/requirements.md:223 (R7.7) — framework metadata persistence

- **Verdict**: true
- **Framework scope**: sync-core
- **Claim**: "THE System SHALL record `Framework_Id` and `Framework_Metadata` on
  every discovered task and SHALL persist them in the `Sync_State_Payload`."
- **Evidence kind**: source
- **Evidence pointer**: src/discovery/conventions.ts::frameworkMetadataFragment
- **Requirements check**: requirements-agree
- **Reasoning**: engine attaches framework metadata fragments to the sync-state
  payload (008 contract suite pins the payload shape).

### C-074 — specs/requirements.md:225-226 (R7.9/R7.10) — generic grammar and Kiro compatibility

- **Verdict**: true
- **Framework scope**: all
- **Claim**: "WHERE the selected framework is `generic`, THE System SHALL use the
  broad built-in heading/checklist grammar and SHALL apply no framework-specific
  exclusions beyond the global summary and rollup defaults." + criterion 10's Kiro
  preservation sentence
- **Evidence kind**: source
- **Evidence pointer**: src/discovery/adapters/generic.ts:17-26
- **Requirements check**: requirements-agree
- **Reasoning**: generic carries empty exclusions and the built-in defaults'
  grammar; Kiro discovery + `.kiro/hooks/` scaffolding verified in C-016.

### C-075 — specs/requirements.md:116 (R2.3) — checkbox classification grammar

- **Verdict**: true
- **Framework scope**: sync-core
- **Claim**: "WHEN a line matches the Markdown checkbox grammar (an optionally
  indented list marker followed by a bracketed state box), THE System SHALL classify
  the line as a checklist task subject to the exclusion rules in criteria 6 and 7."
- **Evidence kind**: source
- **Evidence pointer**: src/parsing/content.ts::matchCheckbox
- **Requirements check**: requirements-agree
- **Reasoning**: `matchCheckbox` (content.ts:128) matches configured
  `flatChecklistMarkers` literals after optional leading whitespace; summary /
  rollup exclusions applied in extract.ts after the marker match.

### C-076 — specs/requirements.md:128 (R2.15) — Feature_Name via active adapter

- **Verdict**: true
- **Framework scope**: all
- **Claim**: "WHEN parsing a task file, THE System SHALL determine the task's
  `Feature_Name` using the active `Framework_Adapter` per Requirement 7, and SHALL
  record no `Feature_Name` when the adapter cannot derive one."
- **Evidence kind**: source
- **Evidence pointer**: src/parsing/taskfile.ts::parseTaskFile
- **Requirements check**: requirements-agree
- **Reasoning**: `parseTaskFile` calls `adapter.featureName(filePath)`
  (taskfile.ts:59) and omits the field when underivable (FR-008; C-046).

### C-077 — specs/requirements.md:129 (R2.16) — unresolved-conflict flagging

- **Verdict**: true
- **Framework scope**: sync-core
- **Claim**: "WHEN parsing a task whose `Task_Body` region contains
  `Conflict_Markers`, THE System SHALL flag the task as carrying an
  `Unresolved_Conflict_Block` and record that state on the task so that downstream
  reconciliation skips the task per Requirement 9."
- **Evidence kind**: source
- **Evidence pointer**: src/parsing/conflict.ts::scanConflictBlocks
- **Requirements check**: requirements-agree
- **Reasoning**: `scanConflictBlocks` (conflict.ts:25) feeds the parse result and
  the `Task.unresolvedConflict` boolean (src/domain/task.ts:59).

### C-078 — specs/requirements.md:130 (R2.17) — Task_Body extent rule

- **Verdict**: true
- **Framework scope**: sync-core
- **Claim**: "WHEN parsing a task, THE System SHALL determine the task's
  `Task_Body` extent as the task's heading or line together with all Markdown
  content beneath it up to but not including the next task or the next heading of
  equal or shallower level, including nested checklist children, and SHALL record
  that `Task_Body` region on the task for description mirroring and conflict
  reconciliation per Requirements 9 and 10."
- **Evidence kind**: source
- **Evidence pointer**: src/parsing/extent.ts::deriveExtents
- **Requirements check**: requirements-agree
- **Reasoning**: `deriveExtents` (extent.ts:35) computes inclusive
  `{startLine,endLine}` per draft with exactly the documented stop rules (fenced
  and conflict-interior headings are not boundaries).

### C-079 — specs/requirements.md:224 (R7.8) — no organization-specific hardcoding

- **Verdict**: true
- **Framework scope**: all
- **Claim**: "THE System SHALL NOT hardcode organization-specific paths, team keys,
  project identifiers, workflow state identifiers, or tokens in framework adapters"
  (framework directory names remain shipped convention defaults).
- **Evidence kind**: source
- **Evidence pointer**: src/config/defaults.ts:57
- **Requirements check**: requirements-agree
- **Reasoning**: routing (team/project/state/token) is CONSUMER-REQUIRED — the
  shipped defaults are empty placeholders that fail validation until supplied
  (defaults.ts:57-58); adapters carry only framework-layout conventions.

## Coverage table (appendix)

SC-001 coverage proof (contract: audit-record-format.md): every located
framework-behavior sentence with the claim id adjudicating it, or `N/A` + reason.
Quotes are leading fragments; the verbatim full text lives in each entry's
`Claim:` field.

### README.md

| Sentence (fragment) | Claim | Verdict |
|---|---|---|
| "A `tasks.md` file stays the human-editable source of truth; Linear issues carry the delivery state…" | C-008 | ambiguous |
| "A persistent `📋 Task [T###]` marker line keeps the mapping alive…" | C-006 | false |
| "task-file *sections* map 1:1 to Linear milestones" | C-007 | false |
| "five built-in adapters (GitHub Spec Kit, AWS Kiro, OpenSpec, BMAD, …), plus custom adapters…" | C-009 | true |
| "**Available on npm** … **Requires** Node 20 … 0.x line … zero runtime dependencies" | C-029 | true |
| "Framework layout is never hardcoded: discovery walks the repository…" | C-010 | true |
| adapter table — all five rows (Detected by / Base directories / Feature name from) | C-011 | true |
| "When several adapters match one file, selection ranks the longest matching path pattern first…" | C-004 | true |
| "Task-file names … base directories, and every per-adapter convention are configuration keys" | C-012 | false |
| "Detection is deliberately conjunctive: a file beneath `specs/` (or `spec/`)…" | C-013 | true |
| "Tasks land at `specs/<feature>/tasks.md` and use T001-style ids…" | C-002 | false |
| "…start the worker — Linear stays current as you commit." | C-014 | false |
| "One milestone per spec folder, one issue per T-task, with `[P]/[US<n>]` tags…" | C-001 | false |
| "it fails the build only on unmapped high-confidence tasks, unresolved conflict blocks, or spec drift" | C-015 | true |
| "Re-running `/speckit.tasks` is safe: the `📋 Task [T###]` marker…" | C-006 | false |
| AWS Kiro subsection (layout, hook scaffold, config-free sentence) | C-016 | true |
| OpenSpec subsection (disjunctive detection, segment-after naming, siblings) | C-017 | true |
| BMAD subsection (markers, parent-or-basename, `docs/` clause, siblings) | C-018 | true |
| "The heading grammar is the broad built-in one (`T001`, `TASK-1`, `Task 1.2`, …)" | C-019 | ambiguous |
| "Its agent-hook scaffold (`install-agent-hook --framework generic`) lands in…" | C-020 | true |
| customAdapters scope note (descriptor minimum, shadow opt-in, engine refusal) | C-021 | true |
| "precedence: CLI flag > environment variable > this file > defaults…" | C-022 | true |
| MCP four-tool surface + structural read-only claim | C-023 | true |
| history-server privacy/mutation posture | C-024 | true |
| CI action contract (three fail-on conditions, zero writes) | C-025 | true |
| "Twelve commands; human output is placeholder-safe…" | C-026 | true |
| exit-code map (nine codes) | C-027 | true |
| token environment-variable naming sentences | C-028 | true |
| "`install-agent-hook [repo] --framework <id>` | Scaffold … (`kiro` default, `generic` also available)" row | C-005 | true |
| intro purpose sentence ("Keeps Spec-Driven Development task files in sync…") | N/A | tool purpose; no behavioral default promised beyond sentences already adjudicated in this block |
| CLI command-table row prose (other CLI rows) | N/A | CLI surface, not framework behavior; grouped by C-026 |

### docs/framework-adapters.md

| Sentence (fragment) | Claim | Verdict |
|---|---|---|
| intro — declarative convention bundles, no adapter I/O, caller-supplied context | C-030 | true |
| built-in adapter table — all five rows incl. hook columns | C-031 | true |
| table notes (generic exclusions, base-dir hints, grammar fields, frozen record) | C-032 | true |
| selection ranking (longest matchedPattern → precedence → alphabetical) | C-033 | true |
| fallback / explicit override / candidates recording | C-034 | true |
| three convention-override layers + gating test citation | C-035 | true |
| custom adapter semantics (minimum, all-misses error, shadow opt-in) | C-036 | true |
| scaffold record (`.kiro/hooks/`, `.task-linear-sync/hooks/`, `enqueue`, undefined) | C-037 | true |
| normative-contract cross-reference links (lines 8-9) | N/A | pointer only, no behavior claim |

### docs/discovery.md

| Sentence (fragment) | Claim | Verdict |
|---|---|---|
| read-only posture (zero writes/tracker/state-dir) | C-038 | true |
| canonical-root pre-flight + `DiscoveryRootError` conditions | C-039 | true |
| skip rules, basename matching, symlink exclusion | C-040 | true |
| escape refusals + exported `verifyInsideRoot` guard | C-041 | true |
| determinism (byte-wise sort, empty repo ⇒ `files: []`) | C-042 | true |
| file-based git context (HEAD/refs/config, omission semantics, `gitContext:false`) | C-043 | true |
| exported discovery surface list + snapshot gate citation | C-044 | true |
| contract cross-reference links (lines 5-7) | N/A | pointer only, no behavior claim |

### docs/parsing.md

| Sentence (fragment) | Claim | Verdict |
|---|---|---|
| purity + sole-writer + `node:crypto`-only posture | C-045 | true |
| `parseTaskFile` four-parameter contract + result fields | C-046 | true |
| Stable_UUID derivation ("never read from files", seed → digest) | C-047 | true |
| rendered-line span preservation + `preserveLocalTaskId` option | C-048 | true |
| checkbox state rules + byte-exact reproduction | C-049 | true |
| abort-all validation + four `LineRenderError` reasons | C-050 | true |
| `cleanTitle` fixpoint / idempotence | C-051 | true |
| adapter-consumption boundary + labeled wave-3 seam | C-052 | true |
| surface drift alarms + snapshot escape hatch | C-053 | true |
| usage snippet code block | N/A | illustrative mirror of the C-046 contract |

### specs/requirements.md (framework-related text per T008 scope)

| Sentence (fragment) | Claim | Verdict |
|---|---|---|
| Introduction — supported-framework set + custom-adapter scope | C-060 | true |
| Introduction — durable anchor in attachment metadata + visible prefix | C-062 | true |
| Glossary — Supported_Framework definition | C-061 | true |
| R2.1 fenced-region exclusion | C-068 | true |
| R2.2 mandated heading-grammar default | C-054 | false |
| R2.3 checkbox classification grammar | C-075 | true |
| R2.4 tab width default | C-067 | true |
| R2.5 mandated phase-pattern default | C-055 | false |
| R2.6 mandated summary-pattern default | C-056 | false |
| R2.7 mandated rollup-pattern default | C-057 | false |
| R2.8 mandated flat-checklist default | C-059 | false |
| R2.9/R2.10 no in-file marker; visible prefix parsing | C-063 | true |
| R2.11 stable-seed composition | C-064 | true |
| R2.12 configurable identifier grammar | C-065 | true |
| R2.13/R2.14 duplicate warnings | C-066 | true |
| R2.15 Feature_Name via active adapter | C-076 | true |
| R2.16 conflict flagging | C-077 | true |
| R2.17 Task_Body extent rule | C-078 | true |
| R7.1/R7.2 built-in adapters + detection rules | C-069 | true |
| R7.3 selection ranking | C-070 | true |
| R7.4 adapter-supplied grammar (checklist leg) | C-058 | false |
| R7.5 built-in defaults listing (five rows) | C-071 | true |
| R7.6 override surface + custom minimum | C-072 | true |
| R7.7 framework metadata persistence | C-073 | true |
| R7.8 no organization-specific hardcoding | C-079 | true |
| R7.9/R7.10 generic grammar + Kiro compatibility | C-074 | true |
| Introduction matching/scoring sentence ("weighted scoring model… one-to-one assignment") | N/A | matching-model behavior owned by feature 006's audit; no framework-adapter claim |
| Requirements 1, 3–6, 8–12 criteria | N/A | discovery/rendering/routing/matching obligations outside the T008 framework-related scope |

Coverage conclusion: every `###`-level framework subsection of README.md, the whole
README intro sentence block, all five `##`-level audited documents'
framework-behavior sentences, and the requirements' framework-related text are
accounted for — SC-001 coverage 100% (79 claim entries; entries C-001…C-079).

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
