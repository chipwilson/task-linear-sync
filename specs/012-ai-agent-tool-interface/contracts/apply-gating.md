# Contract: Apply gating pipeline (`task_sync_apply`)

Modules: `src/mcp/handlers.ts` + `src/mcp/plan-store.ts` (research R5/R6). Constitution V
invariant: the module owns ZERO gate/sync logic — exactly one `GateRequest` and one
`engine.applySyncPlan` call, the `src/queue/apply-runner.ts` posture. The module's own
checks are policy it OWNS (enablement, session membership, argument shape) and run BEFORE
the engine call; they only ever REFUSE — they never widen what the engine accepts.

## 1. Pipeline (normative order)

```
tools/call(task_sync_apply, args)
 1. settings.enabled === false      ⇒ refusal MUTATING_TOOLS_DISABLED      [zero engine/port/state touch]
 2. argument shape (tool-definitions.md §2) ⇒ refusal INVALID_ARGUMENTS    [zero engine/port/state touch]
 3. sessionStore.has(planReference) === false
                                    ⇒ refusal PLAN_REFERENCE_UNKNOWN       [zero engine/port/state touch]
                                       ("no plan reference produced in this session; run task_sync_plan")
 4. stored = state.readJson(`plans/${planReference}.json`)
    stored === null                ⇒ refusal PLAN_REFERENCE_UNKNOWN       [zero port calls]
 5. engine.applySyncPlan(stored.plan, {
      applyFlag: true,
      confirmationKey: args.confirmationKey,            // verbatim; never defaulted, never echoed
      acceptLowConfidence: args.acceptLowConfidence ?? false, // never implied (010 posture)
      planReference: args.planReference,                // engine reads stored plan BY REFERENCE
    })
 6. ApplyResult:
    refused ⇒ isError listing EVERY gateFailures[i].code + detail (complete listing;
              codes verbatim: CONFIRMATION_KEY_MISMATCH, LOW_CONFIDENCE_NOT_ACCEPTED,
              PLAN_REFERENCE_STALE, LOCK_HELD, …) — zero state changes (engine pre-lock design)
    aborted ⇒ isError naming runId + "reversed where possible; see run reports"
    applied ⇒ §3 success payload
```

Steps 1–4 short-circuit refusals are surface POLICY (registration/visibility +
session-scoping), not gate evaluation: they add strictness the engine does not model
(a plan stored by an earlier process is still refused without a session reference) and
re-implement nothing from `src/gates` beyond reusing its frozen CODE VOCABULARY.

## 2. Session-scoped plan-reference store

1. Record path: successful `task_sync_plan` ONLY (exit 0/8 + report provenance verified,
   tool-definitions.md §3). In-memory `Map` (data-model §5) — the module never writes it.
2. Restart ⇒ empty store ⇒ every presented reference refuses at step 3 with
   `PLAN_REFERENCE_UNKNOWN` (spec edge case "Session restart"; SC-001 counts it as a
   zero-mutation refusal path).
3. No TTL, no expiry clock: "earlier this session" freshness = session membership (this
   section) + the engine's stability guards (section 3) — never wall-clock (spec
   Assumptions).
4. Multiple references may accumulate; each apply consumes nothing (re-applying the same
   fresh reference follows the engine's own idempotency/lock behavior).

## 3. Drift and stability (engine-owned, passed through verbatim)

1. The engine re-runs, pre-mutation: gate set (all failures listed together) → advisory
   lock → `validatePlanReference` against LIVE guard-file hashes + VCS HEAD → per-issue
   tracker read-back. Drift (file edited / HEAD moved / tracker moved) ⇒
   `PLAN_REFERENCE_STALE` refusal, ZERO mutations (frozen engine-gates.md behavior —
   asserted in `tests/integration/mcp-apply.test.ts`, never re-implemented here).
2. The module NEVER calls `validatePlanReference` itself: a pre-check could only race the
   engine's live re-read (research R6).

## 4. Success payload (§3 of tool-definitions) and safety

```jsonc
{ "schemaVersion": 1, "runId": "<engine run id>", "status": "applied",
  "counts": { "applied": 3, "skipped": 1, "failed": 0 },
  "reportPaths": { "json": "<state-dir path>", "markdown": "<state-dir path>" } }
```

SC-001 harness rule: every refusal path (disabled, wrong confirmation, missing flag,
low-confidence, unknown reference, drifted reference, pre-restart reference) is exercised
with fake-port mutation-call assertions AND state-dir/repo-tree before/after equality —
0 mutations, 0 writes across the corpus.
