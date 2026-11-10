# Changelog

All notable changes to `task-linear-sync` are documented here. The format
follows keep-a-changelog conventions; versions are the published package
versions (semver), and the release policy — including what `stable` means for
this preview — lives in [docs/versioning.md](docs/versioning.md).

## [Unreleased]

- Feature 017: `spec-kitty` is a real built-in adapter and the sixth syncable
  framework identity, alongside `kiro`, `spec-kit`, `open-spec`, `bmad`, and
  `generic`. Spec Kitty missions are discovered with zero configuration: a task
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
  and a whole-segment `*` in exclusion entries come with it; the existing five
  identities are unchanged byte-for-byte. This supersedes the docs-only removal
  note below — `spec-kitty` now exists in code, so the consistency suite's
  fabricated-name pin narrows to `spec-superpower`.
- Docs: framework support consolidated on the code's actual built-in set
  (`kiro`, `spec-kit`, `open-spec`, `bmad`, `generic`). The README previously
  advertised adapters for `spec-kitty` and `spec-superpower`, which never
  existed in the code; it now documents per-framework discovery behavior for
  every built-in adapter, the real selection precedence, the custom-adapter
  lane (discovery-only — the sync surface admits the five built-in
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
