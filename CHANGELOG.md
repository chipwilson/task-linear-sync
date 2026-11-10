# Changelog

All notable changes to `task-linear-sync` are documented here. The format
follows keep-a-changelog conventions; versions are the published package
versions (semver), and the release policy — including what `stable` means for
this preview — lives in [docs/versioning.md](docs/versioning.md).

## [Unreleased]

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
  across README.md, the framework docs, and requirements.md — 79
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
  fallback — routed as follow-up FU-001). A new `doc-truthfulness` guard
  suite (25 checks) pins the corrected wording, preserves unimplemented
  requirement mandates until FU-002/FU-003 land, and self-checks the audit
  record itself.

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
