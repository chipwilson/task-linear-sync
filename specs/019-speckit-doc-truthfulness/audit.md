# Claim Audit: Documentation Truthfulness

- Baseline commit: 1fccd080f41af5a503c16724544dc937083a156d
- Audited documents: README.md, docs/framework-adapters.md, docs/discovery.md,
  docs/parsing.md, specs/requirements.md
- Open false/ambiguous verdicts: 4

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
