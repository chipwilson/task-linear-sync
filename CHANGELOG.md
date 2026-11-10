# Changelog

All notable changes to `task-linear-sync` are documented here. The format
follows keep-a-changelog conventions; versions are the published package
versions (semver), and the release policy — including what `stable` means for
this preview — lives in [docs/versioning.md](docs/versioning.md).

## [Unreleased]

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
