/**
 * T026 [023 US4] — artifact-folder hygiene at the DISCOVERY seam over the T005 world
 * `spec-kitty-artifact-folders` (contract C1.2'; FR-009/FR-015; SC-007).
 *
 * Pins (verbatim C1.2' posture, already landed with the narrowed `collectionPattern`):
 *  - per-WP artifact sub-folder files (`tasks/WPnn-x/…md`, incl. DUPLICATED
 *    `work_package_id` front matter) stay `spec-kitty`-claimed — no `generic`
 *    fall-through — yet yield ZERO tasks at depth 1 AND depth 2;
 *  - `tasks/README.md` is claimed and yields zero tasks;
 *  - canonical documents + their own artifacts produce NO identity-collision refusal
 *    (the artifact never becomes a second `WP01` in the mission);
 *  - missions named `042-*`, `*-01KQ2VNJ` and bare slug all attribute their task to the
 *    mission DIRECTORY NAME as `featureName`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { builtInDefaults } from "task-linear-sync/config";
import { builtInAdapters, discoverTaskFiles } from "task-linear-sync/discovery";
import type { DiscoveryResult } from "task-linear-sync/discovery";
import { parseTaskFile } from "task-linear-sync/parsing";
import type { TaskFileAdapter } from "task-linear-sync/parsing";

import { attachEngine, buildWorld, type EngineWorld } from "../helpers/engine-harness.js";
import { createSyncEngine } from "../../src/engine/create.js";

/** The shipped row, viewed through the parsing consumer interface. */
const kitty = builtInAdapters["spec-kitty"] as unknown as TaskFileAdapter;

const MISSIONS = ["042-auth-system", "auth-system-01KQ2VNJ", "bare-slug-mission"] as const;

/** The full claimed set the world must present, byte-for-byte (15 spec-kitty files). */
function expectedClaims(): string[] {
  const out: string[] = [];
  for (const mission of MISSIONS) {
    const wp = mission === "bare-slug-mission" ? "WP01-verify" : mission === "042-auth-system" ? "WP01-core" : "WP01-gateway";
    out.push(
      `kitty-specs/${mission}/tasks.md`,
      `kitty-specs/${mission}/tasks/README.md`,
      `kitty-specs/${mission}/tasks/${wp}.md`,
      `kitty-specs/${mission}/tasks/${wp}/review-cycle-1.md`,
      `kitty-specs/${mission}/tasks/${wp}/reviewer-feedback-cycle-1.md`,
    );
  }
  return out.sort();
}

async function worldWith(depth: number | undefined): Promise<EngineWorld> {
  return buildWorld(
    "spec-kitty-artifact-folders",
    depth === undefined ? {} : { config: { maxTaskIssueDepth: depth } },
  );
}

async function discover(w: EngineWorld): Promise<DiscoveryResult> {
  return discoverTaskFiles({ repositoryRoot: w.repositoryRoot, config: builtInDefaults, gitContext: false });
}

test("T026 artifacts stay claimed: every artifact file is spec-kitty-claimed, never generic; non-md files are never candidates", async () => {
  const w = await worldWith(undefined);
  try {
    const result = await discover(w);
    const byPath = new Map(result.files.map((f) => [f.filePath, f.adapterId]));
    assert.deepEqual([...byPath.keys()].sort(), expectedClaims(), "the claim set is the md files — jsonl/yaml/json never ride it");
    for (const [path, adapterId] of byPath) {
      assert.equal(adapterId, "spec-kitty", `${path} stays spec-kitty-claimed (no generic fall-through)`);
    }
  } finally {
    await w.dispose();
  }
});

test("T026 zero tasks from artifacts at depths 1 AND 2 — only the canonical documents yield tasks", async () => {
  for (const depth of [undefined, 1, 2]) {
    const w = await worldWith(depth);
    try {
      const result = await discover(w);
      const depthLabel = `depth ${depth ?? "default"}`;
      const producers = new Map<string, number>();
      for (const f of result.files) {
        const parsed = parseTaskFile(f.filePath, readFileSync(join(w.repositoryRoot, f.filePath), "utf8"), kitty, builtInDefaults);
        producers.set(f.filePath, parsed.file.tasks.length);
      }
      for (const [path, count] of producers) {
        const canonical = /\/tasks\/WP[^/]+\.md$/.test(path);
        assert.equal(count, canonical ? 1 : 0, `${path} yields ${canonical ? "exactly one task" : "zero tasks"} (${depthLabel})`);
      }
    } finally {
      await w.dispose();
    }
  }
});

test("T026 mission attribution: 042-*, ULID-suffix and bare-slug directories all become the featureName", async () => {
  const w = await worldWith(undefined);
  try {
    const result = await discover(w);
    const found = new Map<string, string>();
    for (const f of result.files) {
      const parsed = parseTaskFile(f.filePath, readFileSync(join(w.repositoryRoot, f.filePath), "utf8"), kitty, builtInDefaults);
      for (const task of parsed.file.tasks) {
        const mission = f.filePath.split("/")[1]!;
        found.set(mission, task.featureName ?? "<undefined>");
        assert.equal(task.localTaskId, "WP01", `${f.filePath} carries the bare work-package id`);
        assert.equal(task.parentUuid, undefined, "canonical documents are level-1");
      }
    }
    for (const mission of MISSIONS) {
      assert.equal(found.get(mission), mission, `task in '${mission}' attributes to the directory name`);
    }
  } finally {
    await w.dispose();
  }
});

test("T026 no collision refusal: duplicated work_package_id artifacts never trigger the C2.4 identity refusal", async () => {
  const w = await worldWith(undefined);
  try {
    const engine = attachEngine(w, createSyncEngine, { keyProvider: w.keyProvider });
    const plan = await engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot }); // must NOT throw DocumentIdentityCollisionError
    assert.equal(plan.entries.length, 3, "exactly the three canonical documents plan");
    for (const entry of plan.entries) {
      assert.equal(entry.decision, "create");
      assert.ok(entry.frameworkId === "spec-kitty");
    }
  } finally {
    await w.dispose();
  }
});
