# Changelog

All notable changes to `task-linear-sync` are documented here. The format
follows keep-a-changelog conventions; versions are the published package
versions (semver), and the release policy — including what `stable` means for
this preview — lives in [docs/versioning.md](docs/versioning.md).

## [Unreleased]

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
