# Contract: Engine Wiring & Pipeline (`src/engine`)

**Surface**: `createSyncEngine(deps: EngineDependencies, options?: EngineOptions): SyncEngine`
plus the `EngineOptions` bag — exported from `task-linear-sync/engine`. The returned object
implements the frozen `SyncEngine` (`specs/002-core-domain-contracts/contracts/engine-gates.md`)
and nothing else; there is no other mutating entry point in the package (constitution V).

```ts
// task-linear-sync/engine (008-local wiring; SyncEngine itself stays frozen in 002)
export function createSyncEngine(
  deps: EngineDependencies,          // frozen: { port, config, state, clock, screener }
  options?: EngineOptions,
): SyncEngine;

export interface EngineOptions {
  /** Manifest/step-journal key source; default: env-var name from config
      (manifestKeyEnvVarName + manifestKeyId). Returning null ⇒ key unavailable ⇒ abort. */
  readonly keyProvider?: KeyProvider;
  /** Normalization-profile registry extension; built-in "default" always present. */
  readonly normalizationProfiles?: Readonly<Record<string, DescriptionNormalizer>>;
  /** Journaling override: false ⇒ applies proceed unjournaled, rollback refuses
      (frozen MANIFEST_UNJOURNALED posture). Default true. */
  readonly journalingEnabled?: boolean;
}

export type DescriptionNormalizer = (text: string) => string; // idempotent, round-trip-equating
```

## buildSyncPlan (read-only pipeline — zero mutations, zero repo writes)

| # | Stage | Consumes | Guarantees |
|---|---|---|---|
| 1 | Discover + parse | 003 `src/discovery`, 004 `parseTaskFile` | Deterministic ordering (frozen 003/004 behavior); conflict blocks → `unresolvedConflict` |
| 2 | Route + derive titles | 005 `resolveRouting`, `deriveTitle` | Round-trip-stable titles (005 contract) |
| 3 | Match | 006 `matchAllTasks` over `port.listIssues` scope | Durable-identity collisions surface as integrity aborts (constitution II) |
| 4 | Mode + classify | §2/§3 data-model; checkpoint store read | FR-001/002; formatting-only drift ⇒ no conflict (R3/R5) |
| 5 | Conflict action resolution | conflict-resolution-matrix.md | Pure; every entry carries conflict type + action reasons (FR-005) |
| 6 | Assemble `Plan` | frozen plan shapes; `derivePlanId` | Structural exclusion of raw bodies/descriptions; guards captured (hashes + HEAD) |
| 7 | Persist plan + reports | `plans/<planId>.json`; `reports/<runId>/report.json` + `report.md` | Report JSON conforms to frozen `plan-report.schema.json`; screener-passed; state dir only |

## applySyncPlan (THE single mutating entry — frozen enforcement order)

```
gates(applyFlag ∧ confirmationKey exact ∧ lowConfidence ∧ planReference)
  ── all failures together ⇒ ApplyResult{ status:"refused", gateFailures }   [no lock, no read-back]
→ lock.acquire ⇒ LOCK_HELD refusal on live contention
→ stability re-check: validatePlanReference(live hashes, HEAD) ∧ per-issue snapshot
  re-fetch (getIssue / getAttachmentByUrl) ⇒ drift ⇒ abort, zero mutations
→ journal complete-before-first-mutation (journal-rollback.md §1)
→ mutations, per op in order: parents-before-children, same-parent siblings reversed
    screen → precondition re-check → mutate → journal step → history append
→ checkpoint store write (atomic) → run report + last-run marker → lock.release
```

- Screening enforcement point: every string handed to `port.updateIssue`,
  `port.upsertAttachmentByUrl` (payload + history), and file writes has passed
  `deps.screener.screen()`; `blocked.length > 0` ⇒ the op is not transmitted, fails with
  sanitized detail, and a report entry names the finding categories only.
- Create ops follow data-model §8 (intent-before-attempt; never auto-replayed; identity
  reconciliation; `>1` ⇒ integrity failure + task create aborted, FR-012).
- Assigned task lines are rewritten via 004 `renderTaskLines` with the issue reference and
  derived title; render targets inside conflict blocks are refused by 004 and skipped
  (freeze rule).
- `fail` action: engine aborts before the next mutation; status `"aborted"`; applied
  journal steps remain rollback-able.

## rollbackRun

See journal-rollback.md §2–§4. Refusals reuse frozen codes `MANIFEST_UNJOURNALED` /
`MANIFEST_EXPIRED`; tamper (envelope tag-check failure) refuses with no plaintext.

## Non-goals (negative contract)

- No HTTP/transport, credential, or GraphQL handling inside `src/engine` (port-only —
  enforced by import-scan contract test).
- No new `GateFailureCode` values; internal errors use the 008-local `EngineError`
  taxonomy and never masquerade as gates.
- No repository writes outside planned `render-file` ops; no state writes outside the
  state directory.
- No attachment-id storage; all attachment addressing by deterministic URLs (frozen scheme).
