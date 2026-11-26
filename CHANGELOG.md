# Changelog

All notable changes to `task-linear-sync` are documented here. The format
follows keep-a-changelog conventions; versions are the published package
versions (semver), and the release policy — including what `stable` means for
this preview — lives in [docs/versioning.md](docs/versioning.md).

## [Unreleased]

## [0.8.0] - 2026-11-26

Feature — **default-on task state mapping to Linear default issue states**
(feature 024). Spec Kitty lane moves now work with zero configuration: the
per-team `workflowStates.lanes` map gains a built-in default table resolved
at config load — `planned`/`claimed` → `Todo`, `in_progress`/`for_review`/
`in_review`/`approved` → `In Progress`, `done` → `Done`, and `Backlog` for
creates — so a zero-config team's mission lifecycle drives real Linear states
instead of reporting `lane-state-unmapped` for every lane. Configured
entries keep winning lane by lane; `blocked` stays unmapped until configured
(it has no Linear counterpart), and `canceled` requires a `canceled`-type
state (natively `Canceled`; `Done` serves when there is none).

- **BREAKING** — bootstrap runs now validate every configured lane target
  and workflow-state identity against the live team workflow BEFORE any
  write: a missing name or missing `completed`/`canceled` type category
  refuses the run with exit 3 (`StateMappingBootstrapError`), listing every
  gap with the team's available states and correction steps (sync mode keeps
  the 023 plan-time conflict finding). Teams whose configured states live in
  renamed columns must add the matching `workflowStates` entries or disable
  the mapping.
- The config-shape floor "every team declares ≥ 1 workflow-state identity"
  no longer rejects identity-light configs under default-on mapping — the
  materialized defaults satisfy it at load. It returns verbatim under an
  explicit mapping disable.
- Escape hatches restoring the exact 0.7 posture: `stateMappingEnabled:
  false` (root) or `teams[<key>].workflowStates.mappingEnabled: false`
  (per team) disable the defaults and the validation together;
  `lanes: null` requests no lane moves at all (`{}` is not the null).
- A bootstrap-created task whose lane later names a hidden (`ignoredTypes`)
  state resumes against its own issue after a state round-trip instead of
  creating a duplicate — the durable create-intent anchor records the issue
  before the state patch is issued, and a create resumed from an applied
  intent carries no state at all.

## [0.7.0] - 2026-11-24

Feature — **spec-kitty sub-task depth + event-log status authority**
(feature 023). Spec Kitty missions carry two more conventions the 0.6 adapter
ignored: `### Subtask Tnnn – Title` sections inside work-package documents
(with `subtasks:` rosters in front matter), and an append-only
`status.events.jsonl` lane-event log per mission. 0.7.0 honors both without
touching the flat default: at `maxTaskIssueDepth: 1` (the shipped default) a
work-package document still mirrors byte-identically to v0.6.0, with every
sub-task folded verbatim into its body.

- **Sub-task depth** (`src/parsing/depth.ts`, `src/engine/build.ts`) — at
  `maxTaskIssueDepth: 2` each `### Subtask Tnnn – Title` anchor becomes a
  child issue of its work-package issue (identity: mission + work-package id
  + bare `T` token; durable-only pairing, like the documents), the promoted
  span is holed out of the parent's mirrored body, and Activity-Log
  restatements never double-promote. Roster ids without a body anchor are
  reported as `subtask-no-anchor` exclusions at every depth — never issues,
  never silent drops. Toggling the cap is convergent: folding back to 1
  surfaces the former children as unmapped leftovers with zero
  archive/delete, and toggling back re-matches the SAME issues with zero
  re-creation (SC-005 posture, like 0.4's fold).
- **Event-log status authority** (`src/parsing/status.ts`,
  `src/engine/status-load.ts`, `src/engine/completion.ts`, apply lane) — the
  mission's `status.events.jsonl` is the SOLE status authority: the last
  qualifying line per `wp_id` (string `wp_id` AND string `to_lane` at top
  level; envelope/annotation/blank lines skip without poisoning order)
  decides an optional state move through the NEW per-team
  `workflowStates.lanes` map (nine lane names → workflow-state names, no
  built-in default, `LaneMapError` on a malformed map). A mapped lane patches
  the issue state (idempotent when the live state already matches) or rides
  the create; an unmapped lane leaves state untouched and reports
  `lane-state-unmapped`; a mapped name the team cannot resolve is a plan-time
  conflict finding, never a mutation-time surprise. `status.json` and
  front-matter `lane:` are never read; malformed log lines are counted into
  one report finding and their content never propagates; unknown `wp_id`s are
  named and ignored. Status text never enters mirrored content, and status
  files are never written back (plan-build read-only, Principle I). Lane
  state changes append the additive history kind `lane-changed` (A-023-3;
  frozen kinds unchanged, `checkbox-changed` never reused for lanes).
- **Artifact-folder hygiene** (`src/discovery/adapters/spec-kitty.ts`) — the
  collection gate narrows to direct children of `kitty-specs/<mission>/tasks/`
  (plus the nine legacy lane folder spellings) while the broad claim stays:
  per-WP artifact sub-folders and `tasks/README.md` remain spec-kitty-claimed
  documentation and yield zero tasks at every depth; a duplicated
  `work_package_id` inside a review artifact can no longer collide with the
  canonical document's identity (C2.4 refusals disappear with it).
- **Upgrade note** — no task identity changes at the flat default: existing
  0.6.0 deployments see zero description churn and zero new issues on the
  first 0.7.0 run; only repositories with artifact sub-folders change
  behavior, and only by STOPPING syncing artifact files that should never
  have been issues (their stale issues surface as unmapped leftovers for
  operator cleanup — nothing auto-deletes, same posture as 0.6.0's roll-up
  note). Opt-in depth 2 and lane mapping are per-configuration; both default
  off.
- **Documentation** — README adapter row + Spec Kitty subsection,
  [docs/framework-adapters.md](docs/framework-adapters.md) (claim vs. collect
  split, sub-task promotion/folding, `statusEventFileName`),
  [docs/configuration-reference.md](docs/configuration-reference.md)
  (`maxTaskIssueDepth` document interplay, `workflowStates.lanes` with no
  default, absent-by-default posture); governance records and the amendment
  ledger (A-023-0…A-023-3 + supersessions) in
  [docs/contract-amendments.md](docs/contract-amendments.md).

## [0.6.0] - 2026-11-21

Defect correction — **spec-kitty work-package documents are the task source**
(feature 022). The 0.5.x spec-kitty adapter synced the checkbox lines of the
roll-up `kitty-specs/<mission>/tasks.md` and excluded the per-work-package
`tasks/` folder — inverting Spec Kitty's actual convention. A roll-up line is
an index fragment, not a task: syncing them produced issue swarms of
context-free fragments while the fully detailed work-package prompts were
never synced.

- **Work-package document task source** (`src/discovery/adapters/spec-kitty.ts`,
  `src/parsing/document.ts`) — each `kitty-specs/<mission>/tasks/**/*.md`
  document is ONE task: identity is the mission plus the work-package id
  (front-matter `work_package_id`, else the leading `WP<digits>` file-name
  token), the title cascades front-matter `title:` → first body heading →
  readable file slug, and the mirrored issue content is the document verbatim
  minus its leading front matter. The roll-up stays claimed — as documentation
  yielding zero tasks. Documents are never written back: no confirmation
  prefix, no landed line.
- **Durable-only pairing** (`src/matching/`) — document-kind tasks match a
  tracker issue only through the durable sync-state anchor; title/local-id/
  container heuristics never pair them, at any confidence configuration.
- **Upgrade identity note (users of the roll-up-era syncs)** — every task
  identity changes on the first sync after the upgrade: the previously synced
  roll-up-line issues no longer match anything and are surfaced as
  stale/unmapped for operator cleanup; nothing deletes them automatically.
  The work-package documents create fresh issues with the corrected identities
  and subsequent runs are idempotent. Two missions' `WP01` documents stay two
  distinct tasks.
- **Documentation** — README adapter row and Spec Kitty section,
  [docs/framework-adapters.md](docs/framework-adapters.md) spec-kitty
  narrative, and Requirement 7 in [specs/requirements.md](specs/requirements.md)
  describe the corrected model (022 contracts C0–C8; amendments A-022-0…A-022-4).

## [0.5.0] - 2026-11-21

Feature release — **per-task splitting of Kiro implementation-plan files**
(feature 021) is the headline and carries the release's only behavior
change: a recognized task file whose only heading is a leading title
(`# Implementation Plan`) no longer collapses into one giant issue. Each
top-level checkbox task becomes its own task with its own description
region, and the title heading itself becomes one task titled after the
heading.

- **Document-title heading rule** (`src/parsing/extract.ts`) — a single
  leading title-only heading is no longer a hierarchy anchor: checkbox
  tasks beneath it stay at the default task-depth allowance, the heading
  becomes the plan's title task, and orphan adoption never attaches tasks
  to it. Heading-driven and heading-less files are unchanged (contract
  C1–C3; pinned corpora byte-unchanged).
- **Heading-id grammar amendment** (`src/config/defaults.ts`,
  `src/parsing/content.ts`) — a word-form heading identifier must contain
  at least one digit, so prose titles like `# Implementation Plan` no
  longer read as `Task` ids; dotted-numeric ids (`4.1`) are now captured
  with whitespace-only separators, restoring real local ids for
  sub-numbered plan steps.
- **Identity note (users of the broken shape)** — tasks previously hidden
  inside the giant issue get corrected id seeds on the first sync after
  the upgrade, so they create fresh issues; the old giant issue is no
  longer matched and should be deleted manually or via the stale-issue
  report. Subsequent runs are idempotent.
- **Documentation** — README adapter row,
  [docs/framework-adapters.md](docs/framework-adapters.md) kiro section,
  and [docs/configuration-reference.md](docs/configuration-reference.md)
  (`headingIdGrammar`, id-span capture) describe the amended behavior.

## [0.4.0] - 2026-11-19

Feature release — **task-depth folding** (feature 020) is the headline and
carries the release's only behavior change: `maxTaskIssueDepth` ships with
the built-in default `1` (flat board), so consumers who want sub-issues at
every depth must now set `64` explicitly (details below). Also lands the
exhaustive configuration reference and a README token-default correction
(documentation only).

- **Configuration reference** (`docs/configuration-reference.md`) — a new
  exhaustive catalogue of every configuration parameter (the complete
  `ResolvedConfig`, the additive `queue` group, and the `mcp` launch keys)
  with its intelligent default, validation bounds, and notes; linked from
  the README's Documentation list. Documentation only — no behavior change.
- **README token-default correction** — the history-page and MCP HTTP bearer
  defaults are the tool-id-derived names `TASK_LINEAR_SYNC_WEB_TOKEN` /
  `TASK_LINEAR_SYNC_MCP_TOKEN` (`src/config/defaults.ts`), not the shorthand
  previously printed.
- **Task-depth folding** (`src/parsing/depth.ts`) — the new optional config key
  `maxTaskIssueDepth` (integer, 1–64) caps how deep in the task tree tasks
  become their own Linear issues. The built-in default is `1` — a flat board:
  only depth-1 tasks become issues and deeper nested checklist lines fold
  verbatim into the nearest surviving ancestor issue's mirrored description,
  recorded under the new `depth-folded` parsing exclusion reason; an invalid
  value is refused at the parsing entry with a named diagnostic (CLI exit 3).
  Behavior change for existing consumers: pre-feature behavior — sub-issues
  at every depth — is restored by explicitly setting
  `maxTaskIssueDepth: 64` (effectively unlimited).

## [0.3.1] - 2026-11-13

Release-pipeline only — the publish stage now classifies registry refusals
deterministically, a taxonomy earned during the v0.3.0 first-publish
sequence. No CLI or library behavior changes.

- **Publish-failure taxonomy** — credential refusals (E401/E403 →
  `PUBLISH_FORBIDDEN`) and interactive-OTP interceptions (EOTP →
  `PUBLISH_2FA_REQUIRED`) are now reported as pre-write refusals: nothing
  reached the registry, so fixing the token then retrying is safe. Only
  genuine transport interruption keeps `PUBLISH_AMBIGUOUS` with its
  reconcile-before-retry guidance; existing-version collisions remain
  `PUBLISH_REJECTED`.
- **First-release token guidance** (`docs/release-process.md`) — npm removed
  classic automation tokens in December 2025; the one-time setup now
  specifies the exact Granular Access Token shape (Read And publish, All
  packages, Bypass 2FA, no IP allowlist), each requirement tied to the real
  refusal it prevents, and every publish verdict code routes to its repair.

## [0.3.0] - 2026-11-11

Two more built-in framework identities ship in this release — `spec-kitty`
and `spec-superpower` — alongside the docs consolidation (016) and the
documentation-truthfulness audit and guard suite (019) that made the README,
`specs/requirements.md`, and the adapter registry state only what the code
actually ships.

- Feature 018 — `spec-superpower` ships as the sixth built-in, default-enabled
  framework identity: dated plan files beneath the plans root
  (`docs/superpowers/plans/`) are discovered and claimed, one task per
  `Task N:` heading, every `- [ ] **Step N: …**` checkbox mirrored verbatim
  into the task's issue description and never parsed as a task, and
  date-stripped plan filenames derived as feature names — with file-scoped
  identity seeds so same-name plans on different dates can never cross-match
  (no agent-hook scaffold; installation refuses this identity). Three contract
  amendments land in lockstep (docs/contract-amendments.md): **A-018-0**
  widens the frozen `FrameworkId` union and its mirrored enums/enumerations;
  **A-018-1** narrows discovery's zero-match fallback — an unclaimed file is
  omitted instead of silently absorbed by `generic`; **A-018-2** adds the
  whitelisted `identityFileScope` parse-adapter member without touching the
  frozen seed layout. README, `specs/requirements.md` (Requirement 7 and the
  framework glossary), `docs/framework-adapters.md`, and
  `docs/configuration.md` document the new identity in the same change
  (FR-013); the framework-consistency suite pins README ⇄ requirements ⇄
  registry agreement throughout.
- Feature 017: `spec-kitty` is a real built-in adapter and the seventh syncable
  framework identity, alongside `kiro`, `spec-kit`, `open-spec`, `bmad`,
  `spec-superpower`, and `generic`. Spec Kitty missions are discovered with zero configuration: a task
  file beneath `kitty-specs/` is `spec-kitty` with no sibling-document
  requirement, the mission directory is the feature name, the id printed at the
  start of a checklist line (`- [ ] T001 Create the scaffold`) is the local task
  id, `## Work Package WPnn: …` headings group subtasks into phases without
  becoming tasks themselves, the template/prose sections carry no tasks, and
  `[P]` / `[Pn]` / `[USn]` capability tags stay verbatim in the task file and
  mirrored issue bodies while disappearing from derived titles and issue titles.
  The generated `kitty-specs/<mission>/tasks/` agent-prompt directory is excluded
  from discovery for every adapter, and `install-agent-hook --framework
  spec-kitty` refuses with zero writes like any identity without a template.
  Two optional adapter grammar members (`checklistIdPattern`, `titleTagPattern`)
  and a whole-segment `*` in exclusion entries come with it; every pre-existing
  identity is unchanged byte-for-byte. This supersedes the docs-only removal
  note below — `spec-kitty` now exists in code, so the consistency suite's
  fabricated-name pin moved to a name no feature ships (`spec-fluffy`).
- Docs: framework support consolidated on the code's actual built-in set
  (`kiro`, `spec-kit`, `open-spec`, `bmad`, `generic`). The README previously
  advertised adapters for `spec-kitty` and `spec-superpower`, which never
  existed in the code; it now documents per-framework discovery behavior for
  every built-in adapter, the real selection precedence, the custom-adapter
  lane (discovery-only — the sync surface admits only the built-in
  identities), and truthful config keys (`taskFilePatterns` /
  `specsBaseDirectories` replace the invented `tasks.filename_patterns`).
  `specs/requirements.md` Purpose and the `Supported_Framework` glossary
  align with the same boundary; a new contract suite pins README ⇄
  requirements ⇄ adapter-registry agreement so the three cannot drift.
- Docs: documentation-truthfulness audit of every framework-behavior claim
  across README.md, the framework docs, and requirements.md — 99
  evidence-backed entries in `specs/019-speckit-doc-truthfulness/audit.md`.
  The README Spec Kit section no longer promises issue tags, dependency
  edges, per-folder milestones, or sync on every commit (the managed hooks
  are `pre-push` + `post-merge` by default); mapping durability is now told
  as the visible `[KEY-N]` reference token plus the issue's sync-attachment
  anchor — no in-file marker line. The delivery-state enumeration reads as
  your team's Linear state, the "every convention is a configuration key"
  overclaim is narrowed to `taskFilePatterns` / `specsBaseDirectories`, and
  the heading-grammar examples match the shipped single-token capture (a
  plain `- [ ] T001 …` checkbox line syncs with the ordinal identity
  fallback — routed as follow-up FU-001). The sweep was then extended over
  the merged 017/018 frameworks: the shipped-adapter count and the
  `spec-kitty` feature-name derivation now match the seven-adapter registry,
  the `checklistIdPattern` / `titleTagPattern` overclaim is narrowed to the
  programmatic `overrides.adapters` lane (neither has a config-file key),
  and a stale "other five rows" count is corrected. A new `doc-truthfulness`
  guard suite (29 checks) pins the corrected wording, preserves
  unimplemented requirement mandates until FU-002/FU-003 land, and
  self-checks the audit record itself.

## [0.2.0] - 2026-11-06

As-built preview baseline. The 014 hardening program promotes the
sync-history web page and the MCP agent-tool surface to `stable`; the package
publish tooling ships its first release from this entry.

- Core engine: discovery → parse → route → match → sync with journaled apply
  and rollback (`task-linear-sync`, `task-linear-sync/engine`).
- Operator CLI: twelve commands under `task-linear-sync` (plan/check read-only,
  bootstrap/sync gate-guarded; `--version` reports the package version).
- Background queue and git hooks (post-commit / post-merge / post-rewrite);
  the `worker` command drives deferred sync passes.
- Read-only sync-history web page and its `./history-server` component
  (`task-linear-sync/history-server`) — status `stable` (014).
- MCP agent tools over stdio and HTTP bearer mode (`task-linear-sync/mcp`) —
  status `stable` (014).
- CI enforcement: the composite action `./.github/workflows/ci-drift-action`
  with fail-closed defaults scanning and the drift-check lane.
