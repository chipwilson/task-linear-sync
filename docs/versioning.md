# Versioning policy

How `task-linear-sync` versions the package, what a surface's `stable` status
actually pins, and what it takes to reach 1.0.0. The release mechanics that
enforce parts of this policy live in [docs/release-process.md](release-process.md);
the machine-checked rules are in
[`specs/015-package-publish-tooling/contracts/versioning-policy.md`](../specs/015-package-publish-tooling/contracts/versioning-policy.md).

## Semver discipline

Package versions follow the semantic-versioning rules. While the major version
is `0` the **0.x posture** applies: breaking changes are permitted at minor
bumps (`0.2.0 → 0.3.0`), and the `patch` component carries fixes only. 1.0.0
switches the package to strict semver: no breaking change outside a major bump,
deprecations announced one minor ahead (the
[contract-amendments](contract-amendments.md) discipline already in force for
frozen surfaces becomes the package-wide rule).

The single version source is `package.json.version`; every embedded version
(`SERVER_VERSION`, the CLI `--version` line) is derived from it at build time —
see [release-process.md](release-process.md#publishing-steps-maintainer).

## Surface-stability mapping

Every public surface and what its `stable` status pins. The pinned scope is
always the surface's contract documents plus its checked-in surface snapshot —
the pointer is the definition, this table never restates it. A row's
"reopen" column names the package-version event that may legitimately change
the pinned elements.

| Surface | `stable` pins (frozen contract elements) | Reopened by |
|---|---|---|
| Core library + CLI — `task-linear-sync` root export and the `task-linear-sync` bin | the 002–009 contract set: command names, flags, exit-code map, JSON report schema; `tests/contract/snapshots/frozen-surface.json` | major bump (≥1.0.0) or a 0.x minor bump under the 0.x posture + amendment entry |
| Programmatic API — `task-linear-sync/engine` (with `./domain`, `./config`, `./ports`, `./tracker`, …) | `buildSyncPlan`/`applySyncPlan` signatures and port contracts (`specs/008-*/contracts/`), same snapshot as above | same as core library |
| Worker & hooks — `task-linear-sync/queue` + `install-hooks` / `install-agent-hook` commands | queue semantics and hook trigger set (`docs/queue-hooks.md`, `specs/010-*/`) | same as core library |
| Sync-history web page — `task-linear-sync/history-server` | the 011 contract set + `tests/contract/snapshots/history-surface.json`; promoted by feature 014 (`docs/history-server.md ## Stability`) | a major bump with an amendment entry (post-1.0.0); pre-1.0.0 only via amendment + the surface-freeze snapshot-refresh procedure |
| MCP agent tools — `task-linear-sync/mcp` | the 012 contract set + `tests/contract/snapshots/mcp-surface.json`; promoted by feature 014 (`docs/agent-tools.md ## Stability`) | same as the history server |
| CI enforcement action — the composite action `./.github/workflows/ci-drift-action` + `task-linear-sync/ci` | action inputs/outputs and exit-code posture (`docs/ci-enforcement.md`, `specs/013-*/`) | same as core library; consumers pin repository tags, so the release tag gates it (see below) |

The two feature-014 promotions carry their own `## Stability` sections (status
line, guaranteed scope, non-goals, deployment assumptions); this table is the
package-level index, not a second declaration. Any change to the
surface-stability set — a promotion, a demotion, a new public surface — must
update this document **in the same change** (the documentation duty mirroring
014 FR-003's consistency rule); `versioning-policy.test.ts` greps the stability
set and fails a promoted surface with no row here.

## The 1.0.0 condition

1.0.0 is cut when, and only when: **every public surface declared stable under the 014 regime AND real-workspace dogfooding complete**. Both clauses are
required — stability labels alone do not justify the major bump; at least one
real workspace (a real repository with real task specs syncing against a real
Linear team, driven through the normal CI setup for a sustained period) must
have completed dogfooding with its findings recorded. This document states the
policy only; feature 015 executes nothing toward it.

## Action alignment

The CI composite action is consumed by pinning repository tags — the same tags
the release workflow creates. There is no separate action publishing channel:
the release tag **is** the action ref, and the orchestrator's preflight (clean
tree, HEAD at the tag, tag version === `package.json.version`) is what prevents
the tag an action consumer pins from ever drifting from the package the same
tag publishes (the 013 posture).
