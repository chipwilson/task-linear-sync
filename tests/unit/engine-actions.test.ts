/**
 * T014 [P] [US1] — Unit tests for conflict action resolution (`src/engine/actions.ts`;
 * FR-003/004/005; research R6; data-model §4; contracts/conflict-resolution-matrix.md
 * §1–§3, §6). Pins the FR-004 built-in default-map exports (`bootstrapConflictDefaults`,
 * `syncConflictDefaults` — contract §1 table, frozen, identical to the 002 config
 * built-ins that seed the deep-merge chain), the 36-cell SC-004 matrix (6 actions ×
 * 3 conflict types × 2 modes) as one table-driven test per cell over the pure resolver
 * `resolveConflictAction(mode, conflictType, map, context?)`, the §3 `prefer-newer`
 * recency rule (strict-advancement gate, same-instant/stale/both-changed ⇒ degrade to
 * `report-only` with `degraded: true`), and the FR-005 result shape bound to a task via
 * `appliedAction` (`{ taskUuid, conflictType, action, effect, degraded, reason }`).
 *
 * RED posture (implementation lands later as T021): the stub exports the REAL built-in
 * map constants, so the pure defaults-export cells may already pass; every cell that
 * calls `resolveConflictAction`/`appliedAction` fails with `not implemented: actions`.
 *
 * Modeling choices T021 must honor (derived from stub JSDoc + matrix §2–§3 + R6):
 *  1. `ResolvedConflictAction.action` is the action READ FROM THE MAP — a degraded
 *     `prefer-newer` still reports `action: "prefer-newer"`; the degradation surfaces as
 *     `effect: "none"` + `degraded: true` + a reason naming `report-only` as the fallback
 *     actually taken (stub JSDoc: "Action read from the mode's (merged) map").
 *  2. Every reason is sanitized machine-readable text CONTAINING the conflict-type and
 *     action names verbatim (FR-005 "conflict type + action taken + reason").
 *  3. `skip` reasons additionally mark the record as internal-only (matrix §2: skip is
 *     "recorded internally only (journal/plan reasons; NOT a report conflict entry)") —
 *     asserted case-insensitively as the word "internal".
 *  4. Mode is map-selection context only: with identical map entries, type, and context
 *     the resolver returns identical results under `bootstrap` and `sync` (asserted per
 *     cell as a cross-mode mirror).
 *  5. `prefer-newer` with missing/partial recency context is indeterminable ⇒ degrades
 *     (R6 "never guessed"); recency context is INERT for every non-`prefer-newer` action
 *     (stale context never degrades an overwrite; advancing context never upgrades
 *     `report-only`/`skip`/`fail`).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  appliedAction,
  bootstrapConflictDefaults,
  resolveConflictAction,
  syncConflictDefaults,
} from "../../src/engine/actions.js";
import type {
  ActionEffect,
  ConflictResolutionContext,
  ResolvedConflictAction,
} from "../../src/engine/actions.js";
import type { SyncMode } from "../../src/engine/mode.js";

import type {
  ConflictAction,
  ConflictResolutionMap,
  DescriptionConflictType,
} from "task-linear-sync/domain";
import { builtInDefaults } from "task-linear-sync/config";
import { syntheticUuid } from "task-linear-sync/tracker/testing";

// ── Contract constants (matrix §1–§3) ───────────────────────────────────────────────

const MODES: readonly SyncMode[] = ["bootstrap", "sync"];
const TYPES: readonly DescriptionConflictType[] = ["linear-changed", "spec-changed", "both-changed"];
const ACTIONS: readonly ConflictAction[] = [
  "overwrite-linear",
  "overwrite-spec",
  "report-only",
  "skip",
  "prefer-newer",
  "fail",
];

/** Matrix §2 effect column for the five non-`prefer-newer` actions (fixed consequences). */
const EFFECT_FOR_ACTION: Record<Exclude<ConflictAction, "prefer-newer">, ActionEffect> = {
  "overwrite-linear": "update-issue",
  "overwrite-spec": "render-file",
  "report-only": "none",
  skip: "none",
  fail: "abort-run",
};

/** The mode's built-in default map (matrix §1; FR-004). */
function defaultMap(mode: SyncMode): ConflictResolutionMap {
  return mode === "bootstrap" ? bootstrapConflictDefaults : syncConflictDefaults;
}

/** Default map with exactly one cell overridden — each entry is independently overridable (§1). */
function overriddenMap(
  mode: SyncMode,
  type: DescriptionConflictType,
  action: ConflictAction,
): ConflictResolutionMap {
  return { ...defaultMap(mode), [type]: action };
}

// Fixed injected timestamps (hermetic — no wall clock; constitution VI).
const CHECKPOINT_TS = "2026-01-01T12:00:00.000Z";
const LATER_TS = "2026-01-02T12:00:00.000Z";
const EARLIER_TS = "2025-12-31T12:00:00.000Z";

/** Tracker attests a strictly later update than the checkpoint baseline. */
const trackerNewer: ConflictResolutionContext = {
  issueUpdatedAt: LATER_TS,
  checkpointIssueUpdatedAt: CHECKPOINT_TS,
};
/** Same-instant edit — non-advancing clock, recency undecidable (§3 row 3). */
const sameInstant: ConflictResolutionContext = {
  issueUpdatedAt: CHECKPOINT_TS,
  checkpointIssueUpdatedAt: CHECKPOINT_TS,
};
/** Issue timestamp stale relative to the checkpoint baseline (§3 row 3, `<` half). */
const trackerStale: ConflictResolutionContext = {
  issueUpdatedAt: EARLIER_TS,
  checkpointIssueUpdatedAt: CHECKPOINT_TS,
};

/** Expected §2/§3 outcome for one matrix input — the table's oracle. */
function expectResolution(
  action: ConflictAction,
  type: DescriptionConflictType,
  context: ConflictResolutionContext | undefined,
): { effect: ActionEffect; degraded: boolean } {
  if (action !== "prefer-newer") {
    return { effect: EFFECT_FOR_ACTION[action], degraded: false };
  }
  // §3 recency rule, re-derived independently of the implementation under test:
  if (type === "spec-changed") {
    return { effect: "update-issue", degraded: false }; // single-sided by construction
  }
  if (type === "both-changed") {
    return { effect: "none", degraded: true }; // no trustworthy spec-side timestamp ⇒ always degrade
  }
  const advanced =
    context !== undefined &&
    context.issueUpdatedAt !== undefined &&
    context.checkpointIssueUpdatedAt !== undefined &&
    context.issueUpdatedAt > context.checkpointIssueUpdatedAt;
  return advanced ? { effect: "render-file", degraded: false } : { effect: "none", degraded: true };
}

// ── FR-004 built-in default maps (contract §1) ──────────────────────────────────────

test("engine-actions — bootstrapConflictDefaults: all three conflict types ⇒ overwrite-linear (§1 bootstrap row)", () => {
  assert.deepEqual({ ...bootstrapConflictDefaults }, {
    "linear-changed": "overwrite-linear",
    "spec-changed": "overwrite-linear",
    "both-changed": "overwrite-linear",
  } satisfies ConflictResolutionMap);
});

test("engine-actions — syncConflictDefaults: spec-changed⇒overwrite-linear, linear-changed⇒overwrite-spec, both-changed⇒report-only (§1 sync row)", () => {
  assert.deepEqual({ ...syncConflictDefaults }, {
    "linear-changed": "overwrite-spec",
    "spec-changed": "overwrite-linear",
    "both-changed": "report-only",
  } satisfies ConflictResolutionMap);
});

test("engine-actions — built-in maps are frozen (frozen ConflictResolutionMap shape) and match the 002 config merge-chain base", () => {
  // Frozen values — consumers cannot mutate the built-ins (override goes through the
  // built-in ⇒ config-file ⇒ programmatic deep-merge chain, never in place).
  assert.ok(Object.isFrozen(bootstrapConflictDefaults), "bootstrapConflictDefaults must be frozen");
  assert.ok(Object.isFrozen(syncConflictDefaults), "syncConflictDefaults must be frozen");
  assert.throws(
    () => {
      (bootstrapConflictDefaults as { [key: string]: ConflictAction })["spec-changed"] = "skip";
    },
    TypeError,
  );
  assert.throws(
    () => {
      (syncConflictDefaults as { [key: string]: ConflictAction })["both-changed"] = "fail";
    },
    TypeError,
  );

  // Keys are exactly the frozen DescriptionConflictType trio — the full §1 rows exist
  // even though bootstrap only ever *observes* both-changed (FR-002, override completeness).
  assert.deepEqual(Object.keys(bootstrapConflictDefaults).sort(), [...TYPES].sort());
  assert.deepEqual(Object.keys(syncConflictDefaults).sort(), [...TYPES].sort());

  // FR-004 built-ins are the base of the frozen merge chain — identical to the 002
  // config defaults (src/config/defaults.ts bootstrapConflictMap / syncConflictMap).
  assert.deepEqual({ ...bootstrapConflictDefaults }, { ...builtInDefaults.bootstrapConflictMap });
  assert.deepEqual({ ...syncConflictDefaults }, { ...builtInDefaults.syncConflictMap });
});

test("engine-actions — resolving against the un-overridden built-in maps lands on the §1 rows with §2 effects", () => {
  for (const type of TYPES) {
    const b = resolveConflictAction("bootstrap", type, bootstrapConflictDefaults);
    assert.equal(b.action, "overwrite-linear", `bootstrap × ${type}`);
    assert.equal(b.effect, "update-issue", `bootstrap × ${type} effect (§2 overwrite-linear column)`);
    assert.equal(b.degraded, false, `bootstrap × ${type} is not a degradation`);
    assert.ok(b.reason.includes(type), `bootstrap × ${type} reason names the conflict type (FR-005)`);

    const expected = {
      "linear-changed": { action: "overwrite-spec", effect: "render-file" },
      "spec-changed": { action: "overwrite-linear", effect: "update-issue" },
      "both-changed": { action: "report-only", effect: "none" },
    } as const;
    const s = resolveConflictAction("sync", type, syncConflictDefaults);
    assert.equal(s.action, expected[type].action, `sync × ${type}`);
    assert.equal(s.effect, expected[type].effect, `sync × ${type} effect (§2)`);
    assert.equal(s.degraded, false, `sync × ${type} is not a degradation`);
    assert.ok(s.reason.includes(type), `sync × ${type} reason names the conflict type (FR-005)`);
  }
});

// ── SC-004: 36-cell matrix (6 actions × 3 types × 2 modes), one test per cell ───────

interface MatrixCell {
  readonly id: string;
  readonly mode: SyncMode;
  readonly type: DescriptionConflictType;
  readonly action: ConflictAction;
  readonly context: ConflictResolutionContext | undefined;
  readonly effect: ActionEffect;
  readonly degraded: boolean;
}

const CELLS: readonly MatrixCell[] = MODES.flatMap((mode) =>
  TYPES.flatMap((type) =>
    ACTIONS.map((action) => {
      // Deterministic contexts for `prefer-newer`: spec-changed carries NONE (self-
      // attesting per §3), linear-changed and both-changed carry a strictly-advancing
      // tracker clock — the strongest possible recency evidence (§3 still forces
      // both-changed to degrade). Non-prefer-newer cells carry no context (§2 fixed).
      const context =
        action === "prefer-newer" && type !== "spec-changed" ? trackerNewer : undefined;
      const { effect, degraded } = expectResolution(action, type, context);
      return { id: `${mode} × ${type} × ${action}`, mode, type, action, context, effect, degraded };
    }),
  ),
);

for (const cell of CELLS) {
  test(
    `engine-actions — matrix ${cell.id} ⇒ effect ${cell.effect}${cell.degraded ? " (degraded)" : ""}`,
    () => {
      const map = overriddenMap(cell.mode, cell.type, cell.action);
      const result = resolveConflictAction(cell.mode, cell.type, map, cell.context);

      // Action comes from the map (§6: selected from classification + map, never
      // elsewhere) — and stays map-read even when a prefer-newer resolution degrades.
      assert.equal(result.action, cell.action, `${cell.id}: action read from the mode's map`);
      assert.equal(result.effect, cell.effect, `${cell.id}: §2 effect`);
      assert.equal(result.degraded, cell.degraded, `${cell.id}: degraded flag`);

      // FR-005: every resolution carries a sanitized machine-readable reason naming the
      // conflict type and the configured action verbatim.
      assert.equal(typeof result.reason, "string", `${cell.id}: reason is a string`);
      assert.ok(result.reason.trim().length > 0, `${cell.id}: reason is non-empty`);
      assert.ok(result.reason.includes(cell.type), `${cell.id}: reason names the conflict type`);
      assert.ok(result.reason.includes(cell.action), `${cell.id}: reason names the action taken`);
      if (cell.degraded) {
        assert.ok(
          result.reason.includes("report-only"),
          `${cell.id}: degraded reason names the report-only fallback taken (§3)`,
        );
      }
      if (cell.action === "skip") {
        assert.match(result.reason, /internal/i, `${cell.id}: skip is internal-record only (§2)`);
      }

      // Mode is map-selection context only (modeling choice 4): same entry, same type,
      // same context ⇒ identical resolution under the other mode.
      const other: SyncMode = cell.mode === "bootstrap" ? "sync" : "bootstrap";
      const mirror = resolveConflictAction(
        other,
        cell.type,
        overriddenMap(other, cell.type, cell.action),
        cell.context,
      );
      assert.deepEqual(mirror, result, `${cell.id}: cross-mode parity for identical map entries`);
    },
  );
}

// ── §3 prefer-newer recency rule ────────────────────────────────────────────────────

test("engine-actions — prefer-newer × spec-changed resolves overwrite-linear effect, context-free and context-proof (§3 row 1)", () => {
  const map = overriddenMap("sync", "spec-changed", "prefer-newer");
  // Single-sided by construction — no recency input needed…
  const bare = resolveConflictAction("sync", "spec-changed", map);
  assert.equal(bare.action, "prefer-newer");
  assert.equal(bare.effect, "update-issue", "spec newer ⇒ §2 overwrite-linear effect");
  assert.equal(bare.degraded, false, "determinable — never degraded");
  assert.ok(bare.reason.includes("spec-changed") && bare.reason.includes("prefer-newer"));
  // …and a stale tracker clock never changes that verdict.
  const despiteStale = resolveConflictAction("sync", "spec-changed", map, trackerStale);
  assert.deepEqual(despiteStale, bare, "spec-changed is self-attesting regardless of context");
});

test("engine-actions — prefer-newer × linear-changed with issue.updatedAt strictly after checkpoint resolves overwrite-spec effect (§3 row 2)", () => {
  for (const mode of MODES) {
    const result = resolveConflictAction(
      mode,
      "linear-changed",
      overriddenMap(mode, "linear-changed", "prefer-newer"),
      trackerNewer,
    );
    assert.equal(result.action, "prefer-newer", `${mode}: action stays map-read`);
    assert.equal(result.effect, "render-file", `${mode}: tracker newer ⇒ §2 overwrite-spec effect`);
    assert.equal(result.degraded, false, `${mode}: determinable — no degradation`);
  }
});

test("engine-actions — prefer-newer × linear-changed with issue.updatedAt EQUAL to checkpoint degrades to report-only (§3 row 3, boundary ≤)", () => {
  const result = resolveConflictAction(
    "sync",
    "linear-changed",
    overriddenMap("sync", "linear-changed", "prefer-newer"),
    sameInstant,
  );
  assert.equal(result.action, "prefer-newer", "configured action stays map-read (modeling choice 1)");
  assert.equal(result.effect, "none", "same-instant edit is undecidable ⇒ report-only effect");
  assert.equal(result.degraded, true, "degradation must be flagged (FR-003, US1 AC6)");
  assert.ok(result.reason.includes("report-only"), "reason names the fallback actually taken");
});

test("engine-actions — prefer-newer × linear-changed with issue.updatedAt BEFORE checkpoint degrades to report-only (§3 row 3, never guess)", () => {
  const result = resolveConflictAction(
    "sync",
    "linear-changed",
    overriddenMap("sync", "linear-changed", "prefer-newer"),
    trackerStale,
  );
  assert.equal(result.effect, "none");
  assert.equal(result.degraded, true);
  assert.ok(result.reason.includes("linear-changed"));
  assert.ok(result.reason.includes("report-only"));
});

test("engine-actions — prefer-newer × both-changed ALWAYS degrades to report-only — advancing, equal, or absent context (§3 row 4)", () => {
  const map = overriddenMap("sync", "both-changed", "prefer-newer");
  for (const context of [trackerNewer, sameInstant, trackerStale, undefined]) {
    const result = resolveConflictAction("sync", "both-changed", map, context);
    assert.equal(result.effect, "none", `context=${JSON.stringify(context)} ⇒ report-only effect`);
    assert.equal(result.degraded, true, `context=${JSON.stringify(context)} ⇒ degraded`);
    assert.equal(result.action, "prefer-newer");
    assert.ok(result.reason.includes("report-only"), "reason names the fallback taken");
  }
});

test("engine-actions — prefer-newer × linear-changed with missing or partial recency context degrades — indeterminable is never guessed (R6)", () => {
  const map = overriddenMap("sync", "linear-changed", "prefer-newer");
  const partials: readonly (ConflictResolutionContext | undefined)[] = [
    undefined,
    {},
    { issueUpdatedAt: LATER_TS }, // no checkpoint baseline to compare against
    { checkpointIssueUpdatedAt: CHECKPOINT_TS }, // no issue timestamp
  ];
  for (const context of partials) {
    const result = resolveConflictAction("sync", "linear-changed", map, context);
    assert.equal(
      result.effect,
      "none",
      `context=${JSON.stringify(context)} ⇒ degrade to report-only effect`,
    );
    assert.equal(result.degraded, true, `context=${JSON.stringify(context)} ⇒ degraded: true`);
  }
});

test("engine-actions — recency context is inert for non-prefer-newer actions (§2 effects are fixed consequences)", () => {
  const inert: readonly {
    type: DescriptionConflictType;
    action: Exclude<ConflictAction, "prefer-newer">;
    context: ConflictResolutionContext;
  }[] = [
    { type: "linear-changed", action: "overwrite-spec", context: trackerStale }, // stale clock does NOT degrade
    { type: "both-changed", action: "report-only", context: trackerNewer }, // advancing clock does NOT upgrade
    { type: "both-changed", action: "skip", context: trackerNewer },
    { type: "linear-changed", action: "fail", context: trackerNewer },
    { type: "spec-changed", action: "overwrite-linear", context: trackerStale },
  ];
  for (const { type, action, context } of inert) {
    const result = resolveConflictAction("sync", type, overriddenMap("sync", type, action), context);
    assert.equal(result.effect, EFFECT_FOR_ACTION[action], `sync × ${type} × ${action} ignores context`);
    assert.equal(result.degraded, false, `${action} never reports a prefer-newer degradation`);
  }
});

// ── FR-005 result shape → data-model §4 AppliedAction ───────────────────────────────

test("engine-actions — appliedAction binds a resolution to its task as the exact §4 record (taskUuid, conflictType, action, effect, degraded, reason)", () => {
  const taskUuid = syntheticUuid(1401);
  const resolved: ResolvedConflictAction = {
    action: "prefer-newer",
    effect: "none",
    degraded: true,
    reason: "both-changed: prefer-newer configured; no trustworthy spec-side recency source — degraded to report-only",
  };
  const applied = appliedAction(taskUuid, "both-changed", resolved);

  // Exact record: same six members, no extras, values passed through verbatim.
  assert.deepEqual(applied, {
    taskUuid,
    conflictType: "both-changed",
    action: resolved.action,
    effect: resolved.effect,
    degraded: resolved.degraded,
    reason: resolved.reason,
  });
  assert.deepEqual(Object.keys(applied).sort(), [
    "action",
    "conflictType",
    "degraded",
    "effect",
    "reason",
    "taskUuid",
  ]);
});

test("engine-actions — appliedAction supports the null-conflict path (non-conflict actions, e.g. completion; matrix §5 independence)", () => {
  const taskUuid = syntheticUuid(1402);
  const resolved: ResolvedConflictAction = {
    action: "overwrite-linear",
    effect: "update-issue",
    degraded: false,
    reason: "no description conflict — checkbox-driven completion push",
  };
  const applied = appliedAction(taskUuid, null, resolved);
  assert.equal(applied.taskUuid, taskUuid);
  assert.equal(applied.conflictType, null, "conflictType is null on the non-conflict path");
  assert.equal(applied.action, "overwrite-linear");
  assert.equal(applied.effect, "update-issue");
  assert.equal(applied.degraded, false);
  assert.equal(applied.reason, resolved.reason, "reason is carried through verbatim (FR-005)");
});
