# Sync Engine (`task-linear-sync/engine`)

Feature 008 — the single gated sync core. The engine composes discovery (003), parsing
and rendering (004), routing and titles (005), matching (006), and the tracker port (007)
into the frozen `SyncEngine` contract of 002 (`specs/002-core-domain-contracts/contracts/
engine-gates.md`, mirrored in `src/ports/engine.ts`): `buildSyncPlan` → `applySyncPlan` →
`rollbackRun`. Behavior is normative in [`specs/008-sync-engine-apply-rollback/contracts/`](
../specs/008-sync-engine-apply-rollback/contracts/README.md) — this page is the usage tour,
not the authority. `applySyncPlan` is the **only** mutating entry point in the package
(constitution V), and the module adds **zero runtime dependencies** (research R1).

## Subpath usage

```ts
// The composition root — the one engine entry point.
import { createSyncEngine } from "task-linear-sync/engine";
import type { EngineOptions, KeyProvider } from "task-linear-sync/engine";

// The frozen contract the engine implements (002 — imported, never reshaped).
import type {
  SyncEngine,
  EngineDependencies,
  BuildPlanOptions,
  ApplyResult,
  RollbackResult,
} from "task-linear-sync/ports";
import type { GateRequest, GateFailure } from "task-linear-sync/gates";
```

The barrel also exports the engine's building blocks for the surfaces that legitimately
reuse a single stage — `classifyTask`, `resolveConflictAction`, the FR-004 default maps
(`bootstrapConflictDefaults` / `syncConflictDefaults`), `synthesizeConflictMarkerBlock`,
the normalization-profile registry, the default security screener, and the report helpers
(`persistPlan`, `writeRunReportWithMarker`, …). Reuse of a helper never creates a second
mutation path: only `createSyncEngine` composes the mutating pipelines.

## Construction

```ts
const engine: SyncEngine = createSyncEngine(
  { port, config, state, clock, screener }, // EngineDependencies — the frozen injectable five
  { keyProvider },                          // EngineOptions — all fields optional
);
// never throws at composition; resolution of options happens once here
```

`EngineDependencies` (`task-linear-sync/ports`) is the totality of the engine's reach:

| Field | Type | Notes |
| --- | --- | --- |
| `port` | `LinearPort` | 007 real port in production; the fake in tests — the engine never touches transport, credentials, or GraphQL |
| `config` | `ResolvedConfig` | 002 frozen config — routing tables, confirmation key, conflict maps, `toolId`, manifest settings |
| `state` | `StateStore` | owner-only state directory **outside** the repository working tree; placement violations abort |
| `clock` | `Clock` | injected time — every `at`/`generatedAt`/expiry stamp; deterministic in tests |
| `screener` | `SecurityScreener` | constitution II gate over every propagated string; overridable via `EngineOptions.screener` |

`EngineOptions` (implemented in `src/engine/options.ts`):

| Option | Default | Semantics |
| --- | --- | --- |
| `keyProvider` | `envVarKeyProvider(config)` | manifest/step-journal key source, keyed by `config.manifestKeyId`; the default reads the env var **named by** `config.manifestKeyEnvVarName` (derived from `toolId` — default `TASK_LINEAR_SYNC_MANIFEST_KEY`), accepting 64-char hex or 32-byte base64. Returning `null` ⇒ key unavailable ⇒ the run aborts before any manifest I/O — never an unsealed run |
| `normalizationProfiles` | none | registry extension for description-normalization profiles; the built-in `"default"` profile (config alias `"standard"`) is always present; unknown names fail loudly, never silently fall back |
| `journalingEnabled` | `true` | `false` (or `config.auditManifestEnabled: false`) ⇒ applies run unjournaled and `rollbackRun` refuses `MANIFEST_UNJOURNALED` |
| `screener` | `deps.screener` | ruleset/screening override (research R12) |

## Lifecycle: plan → apply → rollback

### `buildSyncPlan({ repositoryRoot })` — read-only (constitution I)

Seven stages (`contracts/engine-pipeline.md`): discover + parse (003/004) → route + derive
titles (005) → match over `port.listIssues` (006) → mode selection + three-way
classification against the checkpoint store → conflict-action resolution from the mode's
map → assemble the `Plan` (`derivePlanId`; structurally excludes raw bodies and
descriptions) → persist `plans/<planId>.json` + the plan report under
`reports/<runId>/`. Zero tracker mutations, zero repository writes.

Mode selection is presence-based (data-model §2): **no checkpoints ⇒ bootstrap** (the
built-in `bootstrapConflictMap` — every conflict type to `overwrite-linear`; a normalized
side-vs-side difference is `both-changed`; matched converged tasks seed checkpoints on the
first apply); checkpoints present ⇒ **sync** mode.

Classification is two predicates against the single stored baseline hash (R3):
`linear-changed` (tracker moved), `spec-changed` (spec moved), `both-changed` (both) —
formatting-only drift normalizes to identical text and is **never** a conflict (SC-002).

### `applySyncPlan(plan, gates)` — THE single mutating entry

The frozen enforcement order (all gate failures are reported together, before anything
else happens):

```
gates(applyFlag ∧ confirmationKey exact ∧ lowConfidence accepted ∧ planReference)
  ⇒ ApplyResult{ status: "refused", gateFailures }      [no lock, no mutation]
→ advisory lock                                          ⇒ LOCK_HELD refusal
→ plan-stability re-check (validatePlanReference + per-issue snapshot re-fetch)
  ⇒ drift aborts with zero mutations                     [PLAN_REFERENCE_* / integrity]
→ journal complete-before-first-mutation (sealed manifest + step journal)
→ mutations — parents before children, same-parent siblings in reversed working order
  screen → precondition re-check → mutate → journal step → history append
→ checkpoint store write (atomic, last) → run report + last-run marker → lock release
```

The frozen `GateRequest` and its refusal vocabulary (no engine-local codes exist —
`GateFailureCode` is closed; every failure carries a sanitized `detail`):

| `GateRequest` field | Failure code when unsatisfied |
| --- | --- |
| `applyFlag: true` | `APPLY_FLAG_MISSING` |
| `confirmationKey` — must match `config.confirmationKey` exactly | `CONFIRMATION_KEY_MISMATCH` |
| `acceptLowConfidence: true` when `plan.lowConfidencePresent` | `LOW_CONFIDENCE_NOT_ACCEPTED` |
| `planReference` — the `planId` of the persisted plan (`plans/<planId>.json`) | `PLAN_REFERENCE_UNKNOWN` (no stored plan) / `PLAN_REFERENCE_STALE` (guards broken: file-hash or HEAD drift) |
| — (apply/rollback environment) | `LOCK_HELD`, `MANIFEST_EXPIRED`, `MANIFEST_UNJOURNALED` |

Screening is enforced at every outbound string (port writes, payload/history fields,
file writes, journal material): a `blocked` finding means the string is **never
transmitted** — the operation fails with the finding categories only, never the content.
Created issues carry `intent-before-attempt` (data-model §8): indeterminate creates are
recorded and **never replayed**. Landed `overwrite-spec` markers are the research-R4
git-style block embedding the LOCAL section body then the TRACKER description — the
tool-managed mirror region is the section body below the task line, never the task line
itself — and a section carrying unresolved markers is frozen: `skip-unresolved`, bytes
byte-stable across arbitrary intervening runs (SC-004).

`ApplyResult.status` is `"applied"`, `"aborted"` (a `fail`-mapped cell stops the run
before the next mutation — applied steps stay rollback-able; no automatic rollback), or
`"refused"` (gates). Either way `reportPaths` names the run's report pair and
`last-run.json` carries the outcome marker.

### Conflict resolution matrix (defaults, FR-004)

| Conflict type | bootstrap mode | sync mode | Effect of the sync-mode action |
| --- | --- | --- | --- |
| `linear-changed` | `overwrite-linear` | `overwrite-spec` | marker block into the section (render-file); issue untouched |
| `spec-changed` | `overwrite-linear` | `overwrite-linear` | screened rendered region pushed (update-issue); spec file untouched |
| `both-changed` | `overwrite-linear` | `report-only` | nothing on either side; one `conflict-detected` history event |

Every entry is independently overridable through the frozen config merge
(`bootstrapConflictMap` / `syncConflictMap`). `prefer-newer` resolves recency and
degrades to report-only when recency is indeterminable (US1 AC6); `skip` records only;
`fail` aborts. Checkbox movement maps through the completion table **independently of the
conflict machinery** (`checkbox-changed` + `update-issue(stateTypeId)`). The normative
table is [`contracts/conflict-resolution-matrix.md`](../specs/008-sync-engine-apply-rollback/contracts/conflict-resolution-matrix.md).

### `rollbackRun(runId)` — resumable, guarded, total restoration

Reverse-order walk of the journaled run (`contracts/journal-rollback.md` §2–§4), refusing
before any mutation when the run cannot be trusted:

| Condition | Refusal (`RollbackResult.refusal.code`) |
| --- | --- |
| journaling off / no journal artifacts | `MANIFEST_UNJOURNALED` |
| clock past `config.manifestExpiryDays` (strict `>`) | `MANIFEST_EXPIRED` |
| envelope tamper (tag check fails) | refuses with **no plaintext** exposure |

Per-step guards halt the walk with `status: "partial"` and a `conflict-halted` step state
when live state matches neither the before- nor after-snapshot; a completed walk ends
with every step `rolled-back` and `status: "rolled-back"`. Restoration is total —
repository files byte-equal to their journaled backups, issue fields reverted, checkpoint
entries restored (or removed when the run created them), created issues **archived, never
deleted** — while history is **never rewound**: pages are retained, prior events are
never altered, and exactly one `rollback` event per affected task references the reversed
opIds (FR-016, SC-003). Interruption at any step is safe: rerunning `rollbackRun(runId)`
resumes and never repeats a completed step (FR-014). The rollback is itself a run: it
writes its own report and `last-run.json` marker under its own deterministic run id.

## State-directory artifacts

Everything the engine writes lands in the `StateStore` (never the repo tree except
planned `render-file` operations):

| Artifact | Path | Posture |
| --- | --- | --- |
| checkpoint store | `sync-state.json` | plain JSON; one checkpoint per task with a completed sync |
| stored plan | `plans/<planId>.json` | the `StoredPlan` the `planReference` gate reads back |
| run/plan reports | `reports/<runId>/report.json` + `report.md` | JSON conforms field-for-field to the frozen [`plan-report.schema.json`](../specs/002-core-domain-contracts/contracts/plan-report.schema.json); markdown is screener-passed (no raw bodies/descriptions) |
| audit manifest | `manifests/<runId>.json` | frozen 002 shape, AES-256-GCM sealed envelope, expiry per `config.manifestExpiryDays` |
| step journal | `runs/<runId>/journal.json` | 008-local sealed envelope carrying the per-step before/after snapshots the frozen manifest shape cannot (research R9 — documented amendment candidate) |
| create intents | `intents/<intentId>.json` | intent-before-attempt; terminal `indeterminate` never replayed |
| outcome marker | `last-run.json` | `runId` + `outcome` (`completed`/`failed`/`aborted`) + report paths |

## Who consumes the engine (009 / 010 / 012)

All consumers compose the same frozen surface and never import engine internals as a
mutation path:

- **009 (operator CLI)** — `buildSyncPlan` prints the plan/report paths; `apply` maps
  operator intent onto the `GateRequest` (explicit apply flag, typed confirmation key,
  low-confidence acceptance, the plan id as `planReference`) and renders
  `gateFailures` per code; `rollbackRun(runId)` consumes the run id from the last-run
  marker or report.
- **010 (background queue & sync hooks)** — a single long-lived engine instance drives
  queued applies; it leans on the contract's own protection: `LOCK_HELD` resolves
  concurrent runs, plan-stability re-check refuses stale queued plans, and unjournaled or
  expired runs refuse rollback rather than proceeding blind.
- **012 (AI agent tool interface)** — tool calls map one-to-one onto the three methods;
  refusals surface as structured errors carrying the frozen `GateFailureCode`; low
  confidence and conflict markers are by design **human** decisions the tool may report
  but never accept on the operator's behalf.

## Hermetic testing posture (constitution VI)

Engine tests drive `createSyncEngine` against the 007 fake — zero network, zero
credentials, zero wall-clock:

```ts
import { createFakeLinearPort } from "task-linear-sync/tracker/testing";

const engine = createSyncEngine(
  {
    port: createFakeLinearPort(world),       // seeded teams/issues/attachments, scripted failures
    config,                                  // built-in defaults + placeholder overrides (TEAM-A, ACME-*)
    state,                                   // temp directory OUTSIDE the repo (StateStore placement rule)
    clock,                                   // fixed injected clock
    screener,                                // deterministic ruleset
  },
  { keyProvider },                           // deterministic test key (a placeholder value, never a credential)
);
```

The shared harness (`tests/helpers/engine-harness.ts`) materializes fixture worlds from
`tests/fixtures/engine/worlds/<world>/`, wraps the port in a call-recording decorator
(`world.calls` is the authoritative "what did the engine attempt" log), and injects
create-failure and rollback-interruption mechanics. Fixture identities are placeholders
and synthetic UUIDs only (Principle III) — the hygiene contract test fails the release on
any real organization identifier. Run the tiers per
[`specs/008-sync-engine-apply-rollback/quickstart.md`](../specs/008-sync-engine-apply-rollback/quickstart.md);
the composed journey is pinned end-to-end by `tests/e2e/engine-user-stories.test.ts`.

## Further reading

| Document | Pins |
| --- | --- |
| [`contracts/engine-pipeline.md`](../specs/008-sync-engine-apply-rollback/contracts/engine-pipeline.md) | wiring surface, stage order, screening enforcement points, stability re-check |
| [`contracts/conflict-resolution-matrix.md`](../specs/008-sync-engine-apply-rollback/contracts/conflict-resolution-matrix.md) | 6 actions × 3 types × 2 modes, defaults, recency, freeze rule |
| [`contracts/history-log.md`](../specs/008-sync-engine-apply-rollback/contracts/history-log.md) | page-0 rewrite, exactly-one append, rollover, preservation |
| [`contracts/journal-rollback.md`](../specs/008-sync-engine-apply-rollback/contracts/journal-rollback.md) | journal artifacts, step-state machine, rollback guards |
| `specs/002-core-domain-contracts/contracts/engine-gates.md` | the frozen `SyncEngine` / `GateRequest` contract |
| `specs/002-core-domain-contracts/contracts/plan-report.schema.json` | the report JSON schema every `report.json` validates against |
