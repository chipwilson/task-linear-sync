/**
 * T015 [US1] — signal-scoring unit tests (FR-001 verbatim): "score each task against
 * each candidate issue as an unbounded weighted integer sum over configurable signals:
 * durable identity match, existing issue reference, local task ID match, exact
 * normalized title, contained normalized title, fuzzy title similarity (scaled token
 * overlap), same-project alignment, and same-framework alignment".
 * Golden sums: tests/fixtures/matching/scoring-goldens.json against the
 * contracts/confidence-scoring.md §1 table.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { loadConfig } from "task-linear-sync/config";
import type { ConfigOverrides } from "task-linear-sync/config";
import type { RoutingResolution } from "task-linear-sync/domain";
import {
  MatchingConfigError,
  resolveWeights,
  scorePair,
} from "task-linear-sync/matching";
import type { MatchingWeightOverrides, TaskMatchInput } from "task-linear-sync/matching";
import { defaultConfig, makeCandidate, makeTask, readJsonFixture } from "../helpers/matching-factory.js";

interface Golden {
  readonly name: string;
  readonly task: {
    readonly stableUuid: string;
    readonly title: string;
    readonly frameworkId: "spec-kit" | "kiro" | "open-spec" | "bmad" | "generic";
    readonly featureName?: string;
    readonly localTaskId?: string;
    readonly issueRef?: { key: string; number: number };
    readonly routing?: RoutingResolution | null;
  };
  readonly candidate: Record<string, unknown>;
  readonly expected: { total: number; contributions: ReadonlyArray<{ signal: string; points: number }> };
}

const fixture = readJsonFixture<{ goldens: Golden[] }>("matching/scoring-goldens.json");
const config = defaultConfig();

function inputOf(golden: Golden): TaskMatchInput {
  const task = makeTask({
    stableUuid: golden.task.stableUuid,
    title: golden.task.title,
    frameworkId: golden.task.frameworkId,
    ...(golden.task.featureName !== undefined ? { featureName: golden.task.featureName } : {}),
    ...(golden.task.localTaskId !== undefined ? { localTaskId: golden.task.localTaskId } : {}),
    ...(golden.task.issueRef !== undefined
      ? { issueRef: { key: golden.task.issueRef.key, number: golden.task.issueRef.number } }
      : {}),
  });
  return golden.task.routing ? { task, routing: golden.task.routing } : { task };
}

test("matching scoring: golden signal sums over the eight-signal registry (FR-001, unbounded, integer)", () => {
  const weights = resolveWeights(config);
  assert.ok(fixture.goldens.length >= 8, "golden set covers all eight signals");
  for (const golden of fixture.goldens) {
    const pair = scorePair(inputOf(golden), makeCandidate(golden.candidate as never), weights);
    assert.equal(pair.total, golden.expected.total, `${golden.name} — total`);
    assert.ok(Number.isInteger(pair.total) && pair.total >= 0, `${golden.name} — unbounded integer ≥ 0`);
    assert.deepEqual(
      pair.contributions.map((c) => ({ signal: c.signal, points: c.points })),
      [...golden.expected.contributions],
      `${golden.name} — contributions in signal-table order`,
    );
  }
});

test("matching scoring: golden1 proves an UNBOUNDED sum (1830 > every single signal weight)", () => {
  const full = fixture.goldens[0]!;
  const pair = scorePair(inputOf(full), makeCandidate(full.candidate as never), resolveWeights(config));
  assert.ok(pair.total > 1000, `total ${pair.total} exceeds the largest single weight (1000)`);
});

test("matching scoring: derived weights from the frozen config (R1 ratios, 001 R5 defaults)", () => {
  const weights = resolveWeights(config);
  assert.deepEqual(
    {
      durableUuid: weights.durableUuid,
      issueRefExact: weights.issueRefExact,
      titleExact: weights.titleExact,
      titleTokenOverlap: weights.titleTokenOverlap,
      localTaskId: weights.localTaskId,
      titleContained: weights.titleContained,
      sameProject: weights.sameProject,
      sameFramework: weights.sameFramework,
    },
    {
      durableUuid: 1000,
      issueRefExact: 500,
      titleExact: 60,
      titleTokenOverlap: 30,
      localTaskId: 250, // max(1, round(0.5 × issueRefExact)) — 001 R5 ratio 110:220
      titleContained: 39, // round(0.65 × titleExact) — 001 R5 ratio 65:100
      sameProject: 10, // 001 R5 same-project default
      sameFramework: 10, // 001 R5 same-framework default
    },
  );
});

test("matching scoring: derived weights track the frozen config they derive from", () => {
  const halved = resolveWeights(loadConfig({ overrides: { scoringWeights: { issueRefExact: 100 } } }));
  assert.equal(halved.localTaskId, 50);
  const zeroRef = resolveWeights(loadConfig({ overrides: { scoringWeights: { issueRefExact: 0 } } }));
  assert.equal(zeroRef.localTaskId, 1, "max(1, round(0.5 × 0)) — local-ID signal stays awardable");
  const zeroTitle = resolveWeights(loadConfig({ overrides: { scoringWeights: { titleExact: 0 } } }));
  assert.equal(zeroTitle.titleContained, 0, "contained derives from titleExact");
});

test("matching scoring: MatchingWeightOverrides changes derived/constant weights at the call boundary", () => {
  const overrides: MatchingWeightOverrides = {
    localTaskId: 70,
    titleContainedRatio: 0.5,
    sameProject: 25,
    sameFramework: 0,
  };
  const weights = resolveWeights(config, overrides);
  assert.equal(weights.localTaskId, 70);
  assert.equal(weights.titleContained, 30, "round(0.5 × 60)");
  assert.equal(weights.sameProject, 25);
  assert.equal(weights.sameFramework, 0);

  const idOnly = fixture.goldens.find((g) => g.name.startsWith("local task ID only"))!;
  const pair = scorePair(inputOf(idOnly), makeCandidate(idOnly.candidate as never), weights);
  assert.equal(pair.total, 70, "override retargets the local-task-id signal");
});

test("matching scoring: frozen scoringWeights are honored via the config layer", () => {
  const weights = resolveWeights(
    loadConfig({ overrides: { scoringWeights: { issueRefExact: 90, titleTokenOverlap: 100 } } }),
  );
  const refGolden = fixture.goldens[1]!; // issue-ref + exact title golden
  const pair = scorePair(inputOf(refGolden), makeCandidate(refGolden.candidate as never), weights);
  assert.equal(pair.total, 90 + 60, "issue-ref-exact follows the overridden frozen weight");
});

test("matching scoring: fuzzy is scaled by a 0.0–1.0 token-overlap ratio, round half-up", () => {
  const weights = resolveWeights(config);
  const fuzzy = fixture.goldens.find((g) => g.name.startsWith("fuzzy scaled by Dice ratio 0.5"))!;
  const pair = scorePair(inputOf(fuzzy), makeCandidate(fuzzy.candidate as never), weights);
  const fuzzyContribution = pair.contributions.find((c) => c.signal === "title-fuzzy")!;
  assert.equal(fuzzyContribution.points, 15); // round(30 × 0.5)
  assert.equal(fuzzyContribution.weight, 30, "weight reports titleTokenOverlap (pre-scaling)");
});

test("matching scoring: title credit takes the strictest satisfied form only", () => {
  const weights = resolveWeights(config);
  const exact = fixture.goldens.find((g) => g.name.startsWith("exact title takes the strictest form"))!;
  const exactPair = scorePair(inputOf(exact), makeCandidate(exact.candidate as never), weights);
  assert.deepEqual(exactPair.contributions.map((c) => c.signal), ["title-exact"]);

  const contained = fixture.goldens.find((g) => g.name.startsWith("contained normalized title"))!;
  const containedPair = scorePair(inputOf(contained), makeCandidate(contained.candidate as never), weights);
  assert.deepEqual(containedPair.contributions.map((c) => c.signal), ["title-contained"]);
});

test("matching scoring: durable identity requires an exact uuid match — foreign anchor is silent", () => {
  const weights = resolveWeights(config);
  const foreign = fixture.goldens.find((g) => g.name.startsWith("durable uuid on the candidate"))!;
  const pair = scorePair(inputOf(foreign), makeCandidate(foreign.candidate as never), weights);
  assert.equal(pair.durableIdentity, false);
  assert.equal(pair.total, 60);
});

test("matching scoring: unknown candidate framework / absent routing earn no alignment credit", () => {
  const weights = resolveWeights(config);
  const task = makeTask({ stableUuid: "f0000000-0000-4000-8000-000000000001", frameworkId: "kiro", title: "solo title" });
  const pair = scorePair({ task }, makeCandidate({ title: "solo title", frameworkId: undefined }), weights);
  assert.deepEqual(pair.contributions.map((c) => c.signal), ["title-exact"]);
});

test("matching scoring: invalid MatchingWeightOverrides throw typed MatchingConfigError (no coercion)", () => {
  const bad: Array<[MatchingWeightOverrides, string]> = [
    [{ localTaskId: -1 }, "weightOverrides.localTaskId"],
    [{ localTaskId: 1.5 }, "weightOverrides.localTaskId"],
    [{ sameProject: -2 }, "weightOverrides.sameProject"],
    [{ sameFramework: 0.5 }, "weightOverrides.sameFramework"],
    [{ titleContainedRatio: 1.5 }, "weightOverrides.titleContainedRatio"],
    [{ titleContainedRatio: -0.1 }, "weightOverrides.titleContainedRatio"],
  ];
  for (const [overrides, key] of bad) {
    assert.throws(
      () => resolveWeights(config, overrides),
      (e: unknown) =>
        e instanceof MatchingConfigError && e.key === key,
      `expected MatchingConfigError for ${key}`,
    );
  }
});

test("matching scoring: boundary override values are legal (ratio ∈ [0,1]; weights ≥ 0)", () => {
  assert.equal(resolveWeights(config, { titleContainedRatio: 0 }).titleContained, 0);
  assert.equal(resolveWeights(config, { titleContainedRatio: 1 }).titleContained, 60);
  assert.equal(resolveWeights(config, { localTaskId: 0 }).localTaskId, 0);
});

test("matching scoring: config entry guard runs even before scoring (R9) via resolveWeights", () => {
  const broken = loadConfig({ overrides: { minimumMatchMargin: 0 } as ConfigOverrides });
  assert.throws(() => resolveWeights(broken), MatchingConfigError);
});
