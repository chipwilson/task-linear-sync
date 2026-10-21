<!--
Sync Impact Report
==================
- Version change: (none — initial adoption) → 1.0.0 (MAJOR: first ratified constitution)
- Modified principles: none (initial adoption; scaffold contained placeholders only)
- Added sections:
  - Core Principles I. Safety First (NON-NEGOTIABLE) — extracted from spec Introduction ("Safety first"),
    Requirements 10, 11, 12, 15, 25, 26
  - Core Principles II. Durable Identity — extracted from spec Introduction ("Durable identity"),
    Requirements 2, 5, 8, 9, 12
  - Core Principles III. Intelligent Defaults, Overridable Configuration — extracted from spec
    Introduction and Requirements 4, 6, 7, 17, 18, 20, 22, 24–26
  - Core Principles IV. Determinism and Idempotency — extracted from Requirements 1, 2, 3, 5, 8, 9, 12, 28
  - Core Principles V. One Engine, Additive Surfaces — extracted from Requirements 8, 12, 15, 20–26
  - Core Principles VI. Test-First and Quality Gates (NON-NEGOTIABLE) — extracted from Requirements 28, 29
  - Additional Constraints — extracted from Requirements 8, 10, 11, 18, 24, 25, 29
  - Development Workflow and Quality Gates — extracted from Requirements 27, 28, 29
  - Governance — established for first adoption
- Removed sections: none (template placeholder comments replaced by ratified content)
- Follow-up TODOs: none — no placeholders intentionally deferred
-->

# task-linear-sync Constitution

## Core Principles

### I. Safety First (NON-NEGOTIABLE)

Read-only surfaces MUST perform zero issue-tracker mutations and zero repository file writes;
this covers `inventory`, `discover-metadata`, `plan`, `check`, the read-only MCP tools, and the
`CI_Enforcement_Action`. Every mutating operation MUST pass explicit gates before any mutation:
the apply flag plus an exact `Confirmation_Key` match, the accept-low-confidence gate when any
match is below the `high` band, and, for `task_sync_apply`, a fresh valid `Plan_Reference` whose
stability guards (input content hashes and version-control HEAD) still hold. All text propagated
to Linear, reports, manifests, logs, web responses, or MCP outputs MUST first pass the
`Security_Screener`; a blocked finding aborts propagation of the affected content and none of it
is transmitted. Run state MUST live outside the repository working tree with owner-only
permissions and atomic writes. Applied runs are, by default, journaled to an encrypted, resumable
`Audit_Manifest` that enables resumable rollback; disabling the manifest removes that capability
and rollback MUST then refuse rather than proceed unjournaled.

Rationale: the tool writes simultaneously to an external system of record and to the user's
specification files; unrecoverable damage or secret leakage MUST be structurally impossible, not
merely unlikely.

### II. Durable Identity

Every task MUST have a deterministic `Stable_UUID` derived from its stable positional seed
(`Framework_Id`, `Feature_Name` when present, `Local_Task_ID` when present, stable ordinal
fallback), excluding mutable content such as title text, checkbox state, and the visible issue
prefix. The durable identity anchor MUST live in the `Attachment_Metadata` of the page-0
canonical `Sync_Attachment` addressed by the deterministic idempotent `Attachment_URL` — never in
the issue description and never as an in-file marker. Matching MUST prefer the durable identity;
a durable-identity match bypasses team/project/framework gating and margin downgrade so an issue
moved or renamed across containers is never orphaned. More than one issue carrying the same task
UUID is a hard integrity failure: the run MUST abort with no changes applied.

Rationale: idempotent re-runs, safe renames/moves, and human-clean spec files all rest on one
authoritative, deterministic identity that neither side of the sync can casually mutate.

### III. Intelligent Defaults, Overridable Configuration

THE System MUST ship a sensible built-in default for every value that admits a reasonable
generic default (adapters, file patterns, base directories, grammars, weights, thresholds,
retry/backoff limits, timeouts, credential variable names, `toolId`-derived tool identity), and
MUST apply each default when the consumer does not override it. EVERY default MUST be
overridable via configuration, deep-merged in precedence order: built-in defaults, then config
file, then programmatic overrides. Only values intrinsically tied to a specific workspace MAY be
required from the consumer — team identities, per-team project identities, per-team workflow
state identities, `ProjectByPath` entries, and default team/project — and these MUST have no
built-in default. Distributed defaults, example configs, and documentation MUST contain zero real
organization identifiers, team keys, tokens, or UUID values; tool-owned names derive from the
configurable `toolId` and placeholders MUST remain benign and generic.

Rationale: the library is reusable across organizations, repositories, and spec frameworks only
if it ships no organization-specific literals yet demands configuration only where a generic
default would be meaningless.

### IV. Determinism and Idempotency

Repeated runs over unchanged inputs MUST produce byte-for-byte identical results: discovery
ordering, framework adapter selection, one-to-one match assignment with deterministic tie-breaks,
confidence banding, title derivation, `Stable_UUID` derivation, and rendering round-trips (parse
→ derive → render → parse reproduces identical titles with no progressive prefixing). Upsert by
deterministic `Attachment_URL` MUST never duplicate an attachment on any page, and re-running an
interrupted apply over unchanged inputs MUST be safe. Plan stability guards and immediate
re-fetch before each mutation MUST abort the apply when inputs or issue snapshots drifted since
plan build. The `Sync_History_Log` is append-only: recorded `Sync_History_Event` entries are
never modified or deleted, and rollback is recorded by appending a `rollback` event rather than
by rewinding or removing earlier entries.

Rationale: reviewers, CI enforcement, and rollback are only meaningful if the same inputs always
yield the same observable outputs and partial or repeated runs converge rather than diverge.

### V. One Engine, Additive Surfaces

All interfaces — the CLI, the programmatic API (`buildSyncPlan` / `applySyncPlan`), the
background worker, the `Sync_History_Server`, the `MCP_Server`, and the `CI_Enforcement_Action` —
MUST route through the same core engine and enforce the same safety, confirmation, locking,
journaling, and screening guarantees; no surface MAY reimplement a divergent gating, locking, or
screening path. Optional surfaces are strictly additive: they MAY depend on existing sync
capabilities but MUST NOT remove or replace any of them. The `CI_Enforcement_Action` MUST wrap
the published read-only CLI rather than engine logic and MUST provide no apply or mutate mode.
All Linear access MUST flow through the injectable `Linear_Port` so no component bypasses the
port's retry, rate-limit, and diagnostic posture.

Rationale: every guarantee needs to hold exactly once, in the engine; a per-interface shortcut is
a bypass vector, and new surfaces must never regress the established capability set.

### VI. Test-First and Quality Gates (NON-NEGOTIABLE)

Every behavioral change lands with automated tests: tests are written or updated alongside (and
where practical before) the implementation they cover, and every acceptance criterion in the
specification MUST be enforced by at least one automated test. THE System MUST maintain the
`Test_Pyramid`: a broad base of fast unit tests over the pure core logic, a middle layer of
integration tests driving an injected fake `Linear_Port` with zero real Linear API requests, and
a thin top layer of end-to-end tests over each user-facing surface. Property-based, contract
(fake-versus-real `Linear_Port`), and security tests are required cross-cutting types, not
optional extras. Tests MUST be deterministic and hermetic — no real network, real credentials, or
wall-clock nondeterminism. Coverage below the configured minimum threshold, any failed required
test, or any newly skipped required test MUST fail the run.

Rationale: the safety, identity, and determinism principles above are behavioral guarantees that
only enforced, repeatable tests can keep true as the surface count grows.

## Additional Constraints

- **Port and adapter architecture:** All Linear GraphQL access MUST be routed through the
  injectable `Linear_Port` interface; no component may issue Linear requests otherwise. The fake
  `Linear_Port` used in tests MUST conform to the same behavioral contract as the real
  implementation and be contract-tested against it.
- **Credential handling:** Credentials MUST be read only from configured environment-variable
  names, MUST be rejected with a naming diagnostic before any request when unset or empty, and
  MUST NEVER appear in diagnostics, logs, reports, web responses, or MCP outputs. Web and MCP
  HTTP transports MUST keep all credentials server-side and never transmit them to clients.
- **Resilience:** Non-create Linear requests that fail with HTTP 429, 5xx, or network errors MUST
  retry with exponential backoff and randomized jitter up to the configurable maximum, honoring
  `Retry-After`. Issue creation MUST never be automatically retried; a failed create is recorded
  as indeterminate and reconciled, not replayed.
- **Locking and integrity:** Mutating runs MUST acquire an advisory lock recording process id and
  timestamp, proceeding only when no valid live-process lock exists and stale takeover exceeds the
  configured threshold. Encrypted `Audit_Manifest`s MUST use AES-256-GCM in a versioned envelope;
  keys MUST NOT be stored with the ciphertext; a failed authentication-tag check MUST reject the
  manifest without returning plaintext.
- **Technology stack:** THE System ships as a standalone publishable npm package: ECMAScript
  Module output with a generated TypeScript declaration per exported module, a declared `exports`
  and `types` field, Node.js engine constraint ≥ 20.0.0, runtime dependencies limited to Node
  built-ins plus exactly one platform transport dependency (the MCP SDK MAY be scoped to the
  `<pkg>/mcp` subpath), and zero organization-internal packages or peer dependencies.
  The `CI_Enforcement_Action` ships as `action.yml` plus a wrapper that invokes the published CLI.
- **No organization-specific literals:** Framework directory names (`.kiro/specs/`, `specs/`,
  `openspec/`, `bmad/`) are generic discovery defaults, not routing defaults; routing values
  (`Team_Key`, projects, workflow states, path prefixes) MUST always come from consumer
  configuration.

## Development Workflow and Quality Gates

- **Merge-blocking validation:** The `Project_CICD_Pipeline` (GitHub Actions) MUST run dependency
  installation from a locked manifest, lint, type-check, build, and the full test suite (unit,
  integration, end-to-end, property-based, contract, and security) on every pull request and
  every push to a main or protected branch; any failure or coverage below the configured minimum
  MUST fail the workflow with a merge-blocking result.
- **Hermetic pipelines:** Pipeline runs MUST complete without any real Linear credential or real
  organization identifier; secrets for privileged or publishing steps MUST come from the CI
  platform secret store and MUST never be exposed in logs or annotations.
- **Release gates:** A release MUST build the ESM output and declarations, publish all declared
  entry points (programmatic API, CLI binary, `<pkg>/mcp` subpath), and pass a
  distributed-defaults scan that fails the release — publishing nothing — if any real organization
  identifier, token, or UUID value is detected.
- **Documentation duty:** Documentation MUST cover installation, the configuration model
  (defaults plus the consumer-required workspace identities), the supported frameworks, and at
  least one usage scenario for every surface (core library and CLI, programmatic API, worker and
  hook triggers, `Sync_History_Server`, `MCP_Server`, `CI_Enforcement_Action`), plus the safety
  and screening model; whenever a public API, CLI command, configuration key, or action input
  changes, the documentation MUST be updated in the same change. Documentation examples MUST use
  placeholder identifiers only.
- **Conflict-free sync:** Formatting-only differences normalized by the configured
  `Description_Normalization_Profile` MUST never trigger a conflict action, a description write,
  or conflict-marker writes, so repeated syncs over unchanged content neither oscillate nor
  rewrite.

## Governance

This constitution supersedes all other development practices for `task-linear-sync`. When a
specification, plan, task list, or implementation conflicts with these principles, the artifact
MUST be corrected or a documented amendment MUST be adopted first; silent deviation is not
permitted.

- **Amendment procedure:** Amendments are proposed as a pull request that (1) edits this
  constitution directly, (2) includes a Sync Impact Report at the top of the file listing the
  version change, modified/added/removed sections, and follow-up TODOs, and (3) notes any
  migration or documentation impact for dependent templates. Amendments require maintainer
  review and approval before merge. The Sync Impact Report is scratch material for the review
  and is expected to be removed before the amended file is committed.
- **Versioning policy:** The constitution follows semantic versioning. MAJOR: backward-incompatible
  governance changes — removed or redefined principles, or narrowing of non-negotiable gates.
  MINOR: a new principle or section, or materially expanded guidance. PATCH: clarifications,
  wording, and typo fixes with no semantic change. The version line below MUST be updated in the
  same change as any amendment.
- **Compliance review:** Every `/speckit.specify` / `/speckit.plan` / `/speckit.tasks` artifact
  and every code review MUST verify compliance with these principles; complexity that appears to
  circumvent a principle MUST be justified in the plan, and property-based, contract, and security
  tests (Principle VI) are the primary enforcement evidence. Functional detail remains authored in
  `specs/requirements.md`; where functional detail and a governance principle conflict, this
  constitution governs and the conflict MUST be resolved by amendment or by correcting the
  requirement.

**Version**: 1.0.0 | **Ratified**: 2026-10-20 | **Last Amended**: 2026-10-20
