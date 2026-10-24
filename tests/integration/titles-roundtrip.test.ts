/**
 * T018 [US2] — SC-002 CENTERPIECE: property-based 10-cycle
 * `deriveTitle → (mirror) → stripTitleForRender → (re-parse) → deriveTitle` round trip.
 *
 * SC-002: "Over a 10-cycle derive→mirror→render round trip, 0 titles gain a duplicated or
 * compounding prefix (idempotent decoration/strip in 100% of fixtures)." The constitution
 * requires this round-trip stability as a property-based test (Principle IV/VI).
 *
 * Hermetic + deterministic: attributes are drawn from fixture pools by a fixed-seed PRNG
 * (mulberry32); rule presets are paired with the consumer strip presets that invert them
 * (001 R6 informative note). Re-parse is modeled as `task' = { ...task, title: strip(f) }`:
 * `stripTitleForRender` removes exactly the prefixes 004 re-emits from task fields
 * (feature name / issue ref / local ID), so the parsed title equals the stripped title.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { deriveTitle } from "../../src/titles/derive.js";
import { stripTitleForRender } from "../../src/titles/strip.js";
import type { Task } from "../../src/domain/task.js";
import type { TitleConfigSlice } from "../../src/titles/types.js";
import { makeTask } from "../fixtures/routing-titles/factories.js";
import {
  allPrefixedTitle,
  areaRuleSet,
  areaStripPrefixes,
  bareCatchAllRules,
  cleanTitlePool,
  decoratedTitle,
  featurePool,
  issuePrefixedTitle,
  localIdPrefixedTitle,
  makeTitleSlice,
  pathPool,
  phasePool,
  unmatchedRules,
} from "../fixtures/routing-titles/title-fixtures.js";

/** Deterministic PRNG (fixed seed) — property inputs vary, results never do. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** (rule preset, matching strip preset) pairs — each strip set inverts its rule set (001 R6 note). */
const CONFIG_PAIRS: ReadonlyArray<readonly [string, TitleConfigSlice]> = [
  ["area-ruleset", makeTitleSlice({ titleRules: areaRuleSet, titleStripPrefixes: areaStripPrefixes })],
  ["pass-through-empty", makeTitleSlice()],
  ["bare-catchall", makeTitleSlice({ titleRules: bareCatchAllRules })],
  ["no-rule-matches", makeTitleSlice({ titleRules: unmatchedRules })],
];

function generateTasks(count: number): Task[] {
  const rng = mulberry32(20261023);
  const pick = <T>(pool: readonly T[]): T => pool[Math.floor(rng() * pool.length)] as T;
  const localPool: Array<string | undefined> = [undefined, "Task 1.2", "T007", "Task 3"];
  const tasks: Task[] = [];
  for (let i = 0; i < count; i++) {
    const kind = pick(["heading", "checklist"] as const);
    const parent = pick([undefined, "uuid-parent-1"]);
    const issue = pick([undefined, { key: "SYNC", number: 7 }]);
    tasks.push(
      makeTask({
        stableUuid: `uuid-prop-${i}`,
        kind,
        ...(kind === "checklist" ? { checked: rng() < 0.5 } : {}),
        filePath: pick(pathPool),
        title: pick(cleanTitlePool),
        featureName: pick(featurePool),
        localTaskId: pick(localPool),
        phase: pick(phasePool),
        ...(parent === undefined ? {} : { parentUuid: parent }),
        ...(issue === undefined ? {} : { issueRef: issue }),
      }),
    );
  }
  return tasks;
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/** One derive→mirror→render-back cycle; returns next-parse task and the mirrored title. */
function cycle(task: Task, cfg: TitleConfigSlice): { readonly mirrored: string; readonly next: Task } {
  const { finalTitle } = deriveTitle(task, cfg);
  const cleaned = stripTitleForRender(finalTitle, task, cfg);
  return { mirrored: finalTitle, next: { ...task, title: cleaned } };
}

test("titles roundtrip — SC-002 property: 10 cycles keep finalTitle byte-identical from cycle 1", () => {
  const tasks = generateTasks(96);
  assert.equal(tasks.length, 96);
  for (const task of tasks) {
    for (const [name, cfg] of CONFIG_PAIRS) {
      let current = task;
      const first = deriveTitle(current, cfg).finalTitle;
      for (let cycleNumber = 1; cycleNumber <= 10; cycleNumber++) {
        const step = cycle(current, cfg);
        assert.equal(
          step.mirrored,
          first,
          `[${name}] ${task.filePath} "${task.title}" drifted at cycle ${cycleNumber}: ${JSON.stringify(step.mirrored)}`,
        );
        current = step.next;
      }
    }
  }
});

test("titles roundtrip — SC-002: 0 generated titles gain a duplicated or compounding prefix", () => {
  for (const task of generateTasks(96)) {
    for (const [, cfg] of CONFIG_PAIRS) {
      let current = task;
      for (let cycleNumber = 1; cycleNumber <= 10; cycleNumber++) {
        const { mirrored, next } = cycle(current, cfg);
        if (task.featureName !== undefined && task.featureName !== "") {
          assert.equal(
            countOccurrences(mirrored, `${task.featureName}: `),
            1,
            `feature prefix compounded at cycle ${cycleNumber}: ${JSON.stringify(mirrored)}`,
          );
        } else {
          assert.ok(!mirrored.startsWith(": "), `phantom prefix at cycle ${cycleNumber}`);
        }
        const brackets = mirrored.match(/^\[SYNC-\d+\]/g) ?? [];
        assert.ok(brackets.length <= 1, `stacked issue prefixes: ${mirrored}`);
        if (task.localTaskId !== undefined) {
          assert.ok(
            countOccurrences(mirrored, `${task.localTaskId}: `) <= 1 || !mirrored.startsWith(`${task.localTaskId}: `),
            `local-ID prefix stacking at cycle ${cycleNumber}: ${mirrored}`,
          );
        }
        current = next;
      }
    }
  }
});

test("titles no-feature — generated tasks without a Feature_Name are never prefixed (FR-005)", () => {
  for (const task of generateTasks(96).filter((t) => t.featureName === undefined)) {
    for (const [, cfg] of CONFIG_PAIRS) {
      let current = task;
      for (let cycleNumber = 1; cycleNumber <= 10; cycleNumber++) {
        const { mirrored, next } = cycle(current, cfg);
        for (const feature of featurePool) {
          if (feature === undefined) continue;
          assert.ok(!mirrored.startsWith(`${feature}: `), `unexpected feature prefix: ${mirrored}`);
        }
        current = next;
      }
    }
  }
});

test("titles roundtrip — preset prefixed titles normalize once, then stay byte-stable and never compound", () => {
  const presets: Array<{ readonly label: string; readonly title: string; readonly task: Task }> = [
    {
      label: "decorated",
      title: decoratedTitle,
      task: makeTask({ featureName: "user-authentication", title: decoratedTitle }),
    },
    {
      label: "issue-prefixed",
      title: issuePrefixedTitle,
      task: makeTask({ issueRef: { key: "SYNC", number: 7 }, title: issuePrefixedTitle }),
    },
    {
      label: "local-id-prefixed",
      title: localIdPrefixedTitle,
      task: makeTask({ localTaskId: "Task 1.2", title: localIdPrefixedTitle }),
    },
    {
      label: "all-prefixed",
      title: allPrefixedTitle,
      task: makeTask({
        featureName: "user-authentication",
        localTaskId: "Task 1.2",
        issueRef: { key: "SYNC", number: 7 },
        title: allPrefixedTitle,
      }),
    },
  ];
  for (const { label, title, task } of presets) {
    for (const [cfgName, cfg] of CONFIG_PAIRS) {
      let current = { ...task, title };
      const history: string[] = [];
      for (let cycleNumber = 1; cycleNumber <= 10; cycleNumber++) {
        const step = cycle(current, cfg);
        history.push(step.mirrored);
        current = step.next;
      }
      // Converges by cycle 2 and never regrows (strip removes prefixes; nothing stacks).
      const settled = history.slice(1);
      settled.forEach((mirrored, i) =>
        assert.equal(mirrored, settled[0], `[${label}/${cfgName}] unstable after first normalize (cycle ${i + 2}): ${JSON.stringify(history)}`),
      );
      assert.ok(
        history.every((mirrored, i) => i === 0 || mirrored.length <= (history[i - 1]?.length ?? 0)),
        `[${label}/${cfgName}] title grew across cycles (compounding): ${JSON.stringify(history)}`,
      );
    }
  }
});

test("titles roundtrip — the mirrored tracker title re-derives to itself without any strip (001 R6.10)", () => {
  // 008 stores finalTitle in the tracker; a later derivation that reads it back as the raw
  // title must NOT prepend a second feature prefix.
  for (const task of generateTasks(48)) {
    const cfg = makeTitleSlice();
    const once = deriveTitle(task, cfg).finalTitle;
    const mirroredTask: Task = { ...task, title: once };
    assert.equal(deriveTitle(mirroredTask, cfg).finalTitle, once, `mirror re-derive compounded: ${once}`);
  }
});
