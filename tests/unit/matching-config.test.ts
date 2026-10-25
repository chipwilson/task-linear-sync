/**
 * T006 [foundational] — matching config-slice validation unit tests (research R9).
 * Verbatim rules honored:
 * - weights: "configurable weights each greater than or equal to 0" + "weighted INTEGER sum"
 * - floors: "where the medium floor is greater than or equal to the plausible-match floor"
 * - margin: "default 10, minimum allowed value 1"
 * Typed failure: MatchingConfigError { key, value, rule }; "006 does not silently clamp,
 * round, or ignore bad values".
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { loadConfig } from "task-linear-sync/config";
import type { ConfigOverrides, ResolvedConfig } from "task-linear-sync/config";
import { checkMatchingConfig, MatchingConfigError } from "task-linear-sync/matching";

function configWith(overrides: ConfigOverrides): ResolvedConfig {
  return loadConfig({ overrides });
}

function expectConfigError(
  run: () => void,
  key: string,
  ruleFragment: string,
  value?: unknown,
): MatchingConfigError {
  let caught: unknown;
  try {
    run();
    assert.fail(`expected MatchingConfigError for '${key}'`);
  } catch (e) {
    caught = e;
  }
  assert.ok(caught instanceof MatchingConfigError, `expected MatchingConfigError, got ${String(caught)}`);
  assert.equal(caught.name, "MatchingConfigError");
  assert.equal(caught.key, key, `error must name the offending key (got '${caught.key}')`);
  assert.match(caught.rule, new RegExp(ruleFragment));
  if (value !== undefined) assert.deepEqual(caught.value, value);
  return caught;
}

test("matching-config: the frozen built-in defaults validate cleanly", () => {
  const config = loadConfig({});
  assert.deepEqual(
    [config.confidenceFloors.medium, config.confidenceFloors.plausible, config.minimumMatchMargin],
    [50, 18, 10],
    "frozen floors/margin defaults (plan.md baseline)",
  );
  assert.doesNotThrow(() => checkMatchingConfig(config));
});

for (const weightKey of ["durableUuid", "issueRefExact", "titleExact", "titleTokenOverlap"] as const) {
  test(`matching-config: negative scoringWeights.${weightKey} throws (weight >= 0)`, () => {
    expectConfigError(
      () => checkMatchingConfig(configWith({ scoringWeights: { [weightKey]: -1 } })),
      `scoringWeights.${weightKey}`,
      "integer",
      -1,
    );
  });

  test(`matching-config: fractional scoringWeights.${weightKey} throws (integer sum)`, () => {
    expectConfigError(
      () => checkMatchingConfig(configWith({ scoringWeights: { [weightKey]: 2.5 } })),
      `scoringWeights.${weightKey}`,
      "integer",
      2.5,
    );
  });

  test(`matching-config: zero scoringWeights.${weightKey} is legal (>= 0, no silent change)`, () => {
    assert.doesNotThrow(() =>
      checkMatchingConfig(configWith({ scoringWeights: { [weightKey]: 0 } })),
    );
  });
}

test("matching-config: unconsumed frozen weight keys are not constrained by 006 (e.g. kindMatch -5 passes)", () => {
  assert.doesNotThrow(() =>
    checkMatchingConfig(configWith({ scoringWeights: { kindMatch: -5 } })),
  );
});

test("matching-config: confidenceFloors entries must be integers >= 0", () => {
  expectConfigError(
    () => checkMatchingConfig(configWith({ confidenceFloors: { medium: -1 } })),
    "confidenceFloors.medium",
    "integer",
    -1,
  );
  expectConfigError(
    () => checkMatchingConfig(configWith({ confidenceFloors: { plausible: 0.5 } })),
    "confidenceFloors.plausible",
    "integer",
    0.5,
  );
});

test("matching-config: medium floor below plausible floor throws (medium >= plausible)", () => {
  expectConfigError(
    () => checkMatchingConfig(configWith({ confidenceFloors: { medium: 17, plausible: 18 } })),
    "confidenceFloors.medium",
    "greater than or equal",
    17,
  );
});

test("matching-config: medium equal to plausible is legal (>=, not >)", () => {
  assert.doesNotThrow(() =>
    checkMatchingConfig(configWith({ confidenceFloors: { medium: 20, plausible: 20 } })),
  );
});

test("matching-config: minimumMatchMargin below 1 throws (minimum allowed value 1)", () => {
  expectConfigError(
    () => checkMatchingConfig(configWith({ minimumMatchMargin: 0 })),
    "minimumMatchMargin",
    "integer",
    0,
  );
  expectConfigError(
    () => checkMatchingConfig(configWith({ minimumMatchMargin: -3 })),
    "minimumMatchMargin",
    "integer",
    -3,
  );
});

test("matching-config: minimumMatchMargin 1 is legal; fractional margin throws (integer)", () => {
  assert.doesNotThrow(() => checkMatchingConfig(configWith({ minimumMatchMargin: 1 })));
  expectConfigError(
    () => checkMatchingConfig(configWith({ minimumMatchMargin: 1.5 })),
    "minimumMatchMargin",
    "integer",
    1.5,
  );
});

test("matching-config: bad values are reported, never clamped/coerced — no partial repair", () => {
  const broken = configWith({ scoringWeights: { durableUuid: -7 }, minimumMatchMargin: 0 });
  assert.throws(() => checkMatchingConfig(broken), MatchingConfigError);
  // Values survive untouched in the config object (006 never mutates its input).
  assert.equal(broken.scoringWeights.durableUuid, -7);
  assert.equal(broken.minimumMatchMargin, 0);
});

test("matching-config: public entry points run the check first (no silent bad config)", async () => {
  const broken = configWith({ minimumMatchMargin: 0 });
  const matching = await import("task-linear-sync/matching");
  assert.throws(
    () => matching.projectCandidates({ issues: [], attachmentsByIssue: {}, config: broken }),
    MatchingConfigError,
  );
  // (The same entry guard on `matchAllTasks` is pinned by the US1 contract suite.)
});
