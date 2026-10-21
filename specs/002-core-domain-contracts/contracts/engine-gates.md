# Contract: Engine Apply Entry & Gate Vocabulary

Module: `src/gates/gates.ts` + `src/ports/engine.ts`. 002 freezes the vocabulary, request,
and result types; **008 implements** the engine behind these signatures. CLI (009), queue
worker (010), and agent tool (012) are callers — the one-engine rule (constitution V) is a
contract property, not a suggestion.

```ts
// ── Gate vocabulary (constitution Principle I) ─────────────────────────────────
/** Caller-supplied gate state for the single gated apply operation. */
export interface GateRequest {
  readonly applyFlag: boolean;              // surface-level explicit apply flag
  readonly confirmationKey: string;         // must match config confirmationKey EXACTLY
  readonly acceptLowConfidence: boolean;    // required when any match is below "high"
  readonly planReference?: string;          // planId of a stored plan (task_sync_apply path)
}

/** Discrete machine-readable refusal codes — identical across every surface (009 exit
 *  rendering, 012 tool errors, 013 matching). Additions are amendments (FR-008). */
export type GateFailureCode =
  | "APPLY_FLAG_MISSING"
  | "CONFIRMATION_KEY_MISMATCH"
  | "LOW_CONFIDENCE_NOT_ACCEPTED"
  | "PLAN_REFERENCE_UNKNOWN"     // no stored plan for this id
  | "PLAN_REFERENCE_STALE"       // stored plan exists; guards broken (hash/HEAD drift)
  | "LOCK_HELD"                  // live-process lock; loser reports and exits
  | "MANIFEST_EXPIRED"           // rollback/apply dependency past expiry
  | "MANIFEST_UNJOURNALED";      // rollback with journaling off or no journal

export interface GateFailure {
  readonly code: GateFailureCode;
  readonly detail: string;                  // sanitized, human-readable, names the offending value
}

/** Validation of a stored plan's freshness (data-model § 9). Pure predicate; 008 re-runs it
 *  at apply start; 012 uses it for Plan_Reference acceptance. */
export function validatePlanReference(plan: StoredPlan,
                                      current: { fileHashes: Record<string, string>;
                                                 headCommit: string | null }):
  { readonly valid: true } | { readonly valid: false; readonly failure: GateFailure };

// ── Engine entry points (008 implements; signatures frozen) ────────────────────
export interface EngineDependencies {                 // everything injectable — hermetic VI
  readonly port: LinearPort;
  readonly config: ResolvedConfig;
  readonly state: StateStore;                          // run-state.md contract
  readonly clock: Clock;
  readonly screener: SecurityScreener;                 // behavior owned by engine run; shape here
}

export interface BuildPlanOptions { /* repositoryRoot, mode hint, … (008 semantics) */ }

/** READ-ONLY: zero tracker mutations, zero repository writes (constitution I). */
export interface SyncEngine {
  buildSyncPlan(o: BuildPlanOptions): Promise<Plan>;

  /** THE single mutating entry. Order of enforcement (normative):
   *  1. gates (GateRequest → GateFailure[]; all failures reported together);
   *  2. advisory lock acquisition (run-state.md; LOCK_HELD on loss);
   *  3. plan stability re-check (guards + per-issue snapshot re-fetch → abort, no mutation);
   *  4. manifest complete-before-first-mutation (or MANIFEST_UNJOURNALED refusal for
   *     rollback; manifest-disabled applies proceed unjournaled per spec);
   *  5. mutations (screened, journaled, create-intent-before-attempt, parent-before-child). */
  applySyncPlan(plan: Plan, gates: GateRequest): Promise<ApplyResult>;

  /** Rolls back a journaled run; refuses (MANIFEST_UNJOURNALED / MANIFEST_EXPIRED)
   *  rather than proceeding unjournaled. Resumable; history never rewound (008 FR-013..016). */
  rollbackRun(runId: string): Promise<RollbackResult>;
}

export interface ApplyResult {
  readonly runId: string;
  readonly status: "applied" | "aborted" | "refused";
  readonly gateFailures: readonly GateFailure[];   // populated when status === "refused"
  readonly operations: readonly OperationOutcome[];
  readonly reportPaths?: { readonly json: string; readonly markdown: string };
}

export interface SecurityScreener {
  /** Blocking findings (secrets/PII classes) => propagation of affected content is aborted;
   *  non-blocking findings (emails, review terms) redact/annotate per constitution. */
  screen(text: string): { readonly output: string;
                          readonly blocked: readonly string[];   // category labels
                          readonly findings: readonly string[] };
}
```

## Normative gate rules (frozen here, exercised by every surface's tests)

1. `confirmationKey` equality is exact-string against `config.confirmationKey` (default
   `SYNC`); the constant `SYNC` is never special-cased (001 R17.7).
2. `acceptLowConfidence === false` refuses when any plan entry has `confidence` below
   `high`; the refusal names the count and the lowest band (`LOW_CONFIDENCE_NOT_ACCEPTED`).
3. `task_sync_apply` (and the CLI `sync`/`bootstrap` apply path) requires a
   `planReference`; `PLAN_REFERENCE_UNKNOWN` and `PLAN_REFERENCE_STALE` are distinct codes
   so 012 can advise re-planning vs. re-identifying.
4. Read-only surfaces (`plan`, `check`, `inventory`, `discover-metadata`, read-only MCP
   tools, CI action) construct no `GateRequest` and reach no mutating engine method — the
   type system makes `applySyncPlan`/`rollbackRun` unreachable from read-only command types
   (`contracts` test asserts read-only command result types carry no mutation fields).
5. All gate failures are reported together (complete listing, mirroring config validation's
   no-fail-fast posture) so a reviewer fixes everything in one pass.
