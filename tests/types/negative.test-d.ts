/**
 * T050 — negative-type assertions ("types as tests", quickstart "Gate sanity").
 * Compiled by `npm run typecheck` (tsconfig.test includes tests/). Each @ts-expect-error
 * must fail to compile for the RIGHT reason — if the code becomes legal, the unused
 * expectation itself is a typecheck error, failing the build. This file is never executed
 * (the runner's glob does not match *.test-d.js).
 */
import type {
  ApplyResult,
  BuildPlanOptions,
  EngineDependencies,
  GateRequest,
  LinearPort,
  Plan,
  PlanTaskEntry,
  ResolvedConfig,
  SecurityScreener,
  StateStore,
  StoredPlan,
  SyncEngine,
  Clock,
  SyncStatePayload,
  Match,
} from "task-linear-sync";

declare const engine: SyncEngine;
declare const plan: Plan;
declare const cfg: ResolvedConfig;
declare const state: StateStore;
declare const clock: Clock;
declare const screener: SecurityScreener;
declare const port: LinearPort;

// ── 1. applySyncPlan REQUIRES a full GateRequest argument (constitution I gates) ──────

// @ts-expect-error — applySyncPlan takes (plan, gates); the GateRequest argument is mandatory
void engine.applySyncPlan(plan);

// @ts-expect-error — a partial GateRequest is not a GateRequest (all four gate fields required)
void engine.applySyncPlan(plan, { applyFlag: true });

// The complete form compiles (no @ts-expect-error here — if this line ever errors,
// the gate contract broke).
const gateRequest: GateRequest = {
  applyFlag: true,
  confirmationKey: "SYNC",
  acceptLowConfidence: false,
  planReference: "f".repeat(64),
};
void engine.applySyncPlan(plan, gateRequest);

// @ts-expect-error — confirmationKey must be a string (configured value, never a bare boolean/number)
void engine.applySyncPlan(plan, { applyFlag: true, confirmationKey: 1, acceptLowConfidence: false });

// ── 2. LinearPort is the ONLY tracker-typed dependency in engine options (constitution V) ──

const deps: EngineDependencies = { port, config: cfg, state, clock, screener };
void deps;

// @ts-expect-error — the engine refuses any non-LinearPort tracker dependency (fetch/hook backdoors are compile errors)
const badDeps: EngineDependencies = { port: { fetch: globalThis.fetch }, config: cfg, state, clock, screener };
void badDeps;

// Positive assertion instead: EngineDependencies has NO credential field at all.
type NoCredentialField = EngineDependencies extends { token: unknown } ? true : false;
const _noCred: NoCredentialField extends false ? true : false = true;

// @ts-expect-error — omitting the port entirely is not constructible engine state
const missingPort: EngineDependencies = { config: cfg, state, clock, screener };
void missingPort;

// ── 3. Read-only command result types expose no mutation surface (constitution I) ─────

/** A Plan is a value, never an object with mutating methods: no function members. */
type AnyMethodKey<T> = { [K in keyof T]-?: T[K] extends (...args: never[]) => unknown ? K : never }[keyof T];
type _planNoMethods = AnyMethodKey<Plan>;
type _assertPlanPure<T extends never> = T;
type _planPureCheck = _assertPlanPure<_planNoMethods>;

// @ts-expect-error — Plan (the buildSyncPlan result) is deeply readonly: mutation is a compile error
plan.entries.push({});

// @ts-expect-error — ApplyResult.status never includes a mutating/partial-apply state beyond the frozen vocabulary
const _applyStatus: ApplyResult["status"] = "half-applied";

// @ts-expect-error — BuildPlanOptions is closed: no dryRun/apply flags smuggled into plan-building (read-only command)
const buildOpts: BuildPlanOptions = { repositoryRoot: "/repo", applyNow: true };
void buildOpts;

// ── 4. Structural exclusion of raw body/description from plan & payload types ─────────

type RawTextKey = "description" | "body" | "content" | "rawBody" | "rawDescription" | "taskBody";
type HasRawText<T> = Extract<keyof T, RawTextKey>;
type _assertNever<T extends never> = T;

type _entryCheck = _assertNever<HasRawText<PlanTaskEntry>>; // *ContentHash replaces raw text
type _payloadCheck = _assertNever<HasRawText<SyncStatePayload>>; // hash + screened summaries only
type _matchCheck = _assertNever<HasRawText<Match>>;

// TaskBodyExtent stays on Task (internal model) but NEVER appears on the plan entry;
// StoredPlan adds exactly one field: storedAt (no mutation surface).
type StoredAdds = Exclude<keyof StoredPlan, "plan">;
type _storedAddsOnly<T extends "storedAt"> = T;
type _storedCheck = _storedAddsOnly<StoredAdds>;

// Keep tsc from pruning the file's declares when isolated.
export type TypeTestSurface = [
  _planPureCheck,
  _entryCheck,
  _payloadCheck,
  _matchCheck,
  _storedCheck,
  NoCredentialField,
];
