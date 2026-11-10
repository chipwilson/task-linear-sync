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
