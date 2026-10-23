/**
 * T008 [Foundational] — Stable-UUID unit tests (research R3, constitution II, 002 R11).
 * Seed obtained ONLY via the frozen `taskStableSeed`; verbatim frozen layout:
 *   frameworkId + "\u0000" + (featureName ?? "") + "\u0000" + (localTaskId ?? `${ordinal}:${filePath}`)
 * `deriveStableUuid(seed, toolId)` is v5-shaped/lowercase and deterministic; the seed
 * excludes title text, checkbox state, and the visible issue prefix (property re-check
 * at the UUID level).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { deriveStableUuid } from "task-linear-sync/parsing";
import { taskStableSeed } from "task-linear-sync/domain";

import { makeTestConfig } from "../helpers/parsing-fixtures.js";

const cfg = makeTestConfig();
const V5_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Minimal stable-identity inputs (the frozen seed consumes only these three fields). */
const stable = { frameworkId: "kiro" as const, featureName: "auth", localTaskId: "Task 1.2" };
const fallback = { ordinal: 4, filePath: ".kiro/specs/auth/tasks.md" };

test("parsing identity — frozen seed layout is consumed verbatim (taskStableSeed)", () => {
  assert.equal(taskStableSeed(stable, fallback), "kiro\u0000auth\u0000Task 1.2");
  assert.equal(
    taskStableSeed({ frameworkId: "generic" }, { ordinal: 3, filePath: "specs/a/tasks.md" }),
    "generic\u0000\u00003:specs/a/tasks.md",
  );
});

test("parsing identity — deriveStableUuid is v5-shaped and lowercase", () => {
  const uuid = deriveStableUuid(taskStableSeed(stable, fallback), cfg.toolId);
  assert.match(uuid, V5_SHAPE);
});

test("parsing identity — same seed bytes ⇒ same UUID across calls; distinct seed or toolId ⇒ distinct UUID", () => {
  const seed = taskStableSeed(stable, fallback);
  assert.equal(deriveStableUuid(seed, cfg.toolId), deriveStableUuid(seed, cfg.toolId));
  const other = taskStableSeed({ ...stable, localTaskId: "Task 1.3" }, fallback);
  assert.notEqual(deriveStableUuid(seed, cfg.toolId), deriveStableUuid(other, cfg.toolId));
  assert.notEqual(deriveStableUuid(seed, cfg.toolId), deriveStableUuid(seed, "other-tool"));
});

test("parsing identity — constitution II: Stable_UUID is invariant under title, checkbox state, and visible issue prefix", () => {
  // Verbatim principle: "Every task MUST have a deterministic `Stable_UUID` derived from
  // its stable positional seed ... excluding mutable content such as title text, checkbox
  // state, and the visible issue prefix".
  const before = deriveStableUuid(taskStableSeed(stable, fallback), cfg.toolId);

  // Mutable fields (title text, checkbox state) are not seed inputs — declared as
  // variables (not literals) because the frozen parameter is a structural Pick.
  const titleAndStateMutated = { ...stable, title: "Totally new title", checked: true };
  assert.equal(before, deriveStableUuid(taskStableSeed(titleAndStateMutated, fallback), cfg.toolId));

  // A visible `[SYNC-9]` prefix appearing/disappearing on the line (an issueRef change)
  // never touches the seed inputs, so the UUID is unchanged.
  const withRef = { ...stable, issueRef: { key: "SYNC", number: 9 } };
  const withoutRef = { ...stable };
  assert.equal(
    deriveStableUuid(taskStableSeed(withRef, fallback), cfg.toolId),
    deriveStableUuid(taskStableSeed(withoutRef, fallback), cfg.toolId),
  );
});
