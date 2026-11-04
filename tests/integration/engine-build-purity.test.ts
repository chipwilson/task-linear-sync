/**
 * T027 [P] [US1] — build-purity integration test (constitution I;
 * contracts/engine-pipeline.md "buildSyncPlan (read-only pipeline — zero mutations, zero
 * repo writes)"; SC-001; quickstart.md 1.x).
 *
 * Table-driven over ALL SEVEN US1 fixture worlds (T017): materialize the world through the
 * T003 harness (seeding `expected/checkpoint-seed.json` via `seedCheckpoints` wherever the
 * world ships one — pinned cross-lane decision 3), snapshot the ENTIRE temp fixture repo
 * tree (recursive, sorted, per-file sha256 content hashes) and the state directory, mark
 * the decorated port-call log, then run `engine.buildSyncPlan({ repositoryRoot })` and
 * prove:
 *
 * (a) ZERO mutating port calls — the call log since the pre-build `callsMark` diffed
 *     against `MUTATING_PORT_METHODS` (`createIssue`, `updateIssue`, `archiveIssue`,
 *     `upsertAttachmentByUrl`, `updateAttachment`) is empty. Reads ARE allowed and expected
 *     (`listIssues`, `discoverMetadata`, `getIssue`, `getAttachmentByUrl`, `listAttachments`,
 *     `findIssuesByAttachmentUrl`), and every attempted call must belong to the
 *     `buildSyncPlan` phase (no leakage outside the engine seam).
 * (b) The fixture repo tree is BYTE-IDENTICAL after planning — the hash maps match key-set
 *     AND content entry-for-entry, so planning rewrites nothing, creates nothing, deletes
 *     nothing (not even a directory or symlink; repo writes ride apply's planned
 *     `render-file` ops only — engine-pipeline.md Non-goals).
 * (c) The ONLY state-directory changes are under `plans/` and `reports/` (stage-7 plan +
 *     report artifacts). `sync-state.json` is byte-UNCHANGED (planning never checkpoints —
 *     checkpoint writes belong to apply), and no apply-only `manifests/`, `runs/`, or
 *     `intents/` entries appear anywhere in the state tree (not even pre-created empty
 *     directories).
 *
 * A minimal positive floor — `buildSyncPlan` resolved with a non-empty `planId` — keeps the
 * absence assertions from passing vacuously against a silent no-op.
 *
 * ⚠ RED BY DESIGN (test-first wave, tasks.md "must fail"): `createSyncEngine` is the T012
 * skeleton whose `buildSyncPlan` throws `EngineError` until T026 wires `build.ts` — every
 * world therefore fails AT the build call with the skeleton error, which is the red proof.
 * All purity assertions run the moment the wiring lands. The checkpoint-seed presence table
 * doubles as a fixture-drift guard (an unexpected `checkpoint-seed.json` would silently
 * flip `first-run-bootstrap` out of bootstrap mode).
 *
 * Hermetic (constitution VI): harness temp worlds only — zero network, zero credentials,
 * zero wall-clock; placeholder identities only (Principle III). Titles prefixed
 * `engine-build-purity —` for the tier name pattern.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile, readlink } from "node:fs/promises";
import { join, relative, sep } from "node:path";

import type { Checkpoint } from "task-linear-sync/domain";

import {
  attachEngine,
  buildWorld,
  callsMark,
  callsSince,
  expectedFile,
  MUTATING_PORT_METHODS,
  readExpectedJson,
  seedCheckpoints,
  type EngineWorld,
  type PortCallRecord,
} from "../helpers/engine-harness.js";

import { createSyncEngine } from "../../src/engine/create.js";

// ─────────────────────────────────────────────────────────── world table (all seven US1)

const CHECKPOINT_SEED_REL = "checkpoint-seed.json";

/** One US1 world row: name + whether its fixture ships a checkpoint baseline. */
interface WorldCase {
  readonly name: string;
  /** `true` ⇒ `expected/checkpoint-seed.json` MUST exist (sync-mode worlds);
   *  `false` ⇒ it MUST be absent (`first-run-bootstrap` — bootstrap reality). */
  readonly seedsCheckpoints: boolean;
}

const US1_WORLDS: readonly WorldCase[] = [
  { name: "first-run-bootstrap", seedsCheckpoints: false },
  { name: "formatting-noise", seedsCheckpoints: true },
  { name: "linear-changed", seedsCheckpoints: true },
  { name: "spec-changed", seedsCheckpoints: true },
  { name: "both-changed", seedsCheckpoints: true },
  { name: "unresolved-block", seedsCheckpoints: true },
  { name: "completion-toggle", seedsCheckpoints: true },
];

// ────────────────────────────────────────────────────────── recursive tree snapshots

/** Stable snapshot entry map: sorted relative path ("dir/" for directories) → content tag. */
type TreeSnapshot = ReadonlyMap<string, string>;

function sha256Bytes(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Recursively hash a whole tree: regular files → `sha256:<hex>` over the raw bytes,
 * directories → `dir` (self-entry under `<name>/`), symlinks → their target — keyed by
 * slash-normalized relative path, sorted for readable failures. Byte-level identity (any
 * content edit, added/removed path, or type change shifts a key or a value).
 */
async function snapshotTree(root: string): Promise<TreeSnapshot> {
  const entries = new Map<string, string>();
  async function walk(dir: string): Promise<void> {
    const dirents = await readdir(dir, { withFileTypes: true });
    for (const d of dirents) {
      const abs = join(dir, d.name);
      const rel = relative(root, abs).split(sep).join("/");
      if (d.isDirectory()) {
        entries.set(`${rel}/`, "dir");
        await walk(abs);
      } else if (d.isSymbolicLink()) {
        entries.set(rel, `symlink→${await readlink(abs)}`);
      } else {
        entries.set(rel, `sha256:${sha256Bytes(await readFile(abs))}`);
      }
    }
  }
  await walk(root);
  return new Map([...entries.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** One path-level before/after difference between two tree snapshots. */
interface TreeDelta {
  readonly path: string;
  readonly change: "added" | "removed" | "modified";
  readonly before: string | undefined;
  readonly after: string | undefined;
}

function diffTrees(before: TreeSnapshot, after: TreeSnapshot): TreeDelta[] {
  const paths = [...new Set([...before.keys(), ...after.keys()])].sort();
  const deltas: TreeDelta[] = [];
  for (const path of paths) {
    const b = before.get(path);
    const a = after.get(path);
    if (b === undefined) {
      deltas.push({ path, change: "added", before: undefined, after: a });
    } else if (a === undefined) {
      deltas.push({ path, change: "removed", before: b, after: undefined });
    } else if (a !== b) {
      deltas.push({ path, change: "modified", before: b, after: a });
    }
  }
  return deltas;
}

function formatDelta(d: TreeDelta): string {
  const detail = d.change === "modified" ? `${d.before} → ${d.after}` : (d.after ?? d.before);
  return `${d.change} ${d.path} [${detail}]`;
}

function formatCall(c: PortCallRecord): string {
  return `#${c.seq} ${c.method} (phase ${c.phase}${c.ok ? "" : `, threw: ${c.error ?? "?"}"`})`;
}

// ─────────────────────────────────────────────────────────────────── state-dir posture

/** The ONLY state areas a plan build may touch (contracts/engine-pipeline.md stage 7). */
const ALLOWED_STATE_AREAS: readonly string[] = ["plans", "reports"];

/** Apply-only state areas that must not exist at all after planning (journal-rollback §1, data-model §8). */
const APPLY_ONLY_STATE_RE = /^(?:manifests|runs|intents)(?:\/|$)/;

function inAllowedStateArea(path: string): boolean {
  return ALLOWED_STATE_AREAS.some((area) => path === `${area}/` || path.startsWith(`${area}/`));
}

// ─────────────────────────────────────────────────────────────────────────── per-world

/** Seed the world's checkpoint baseline, asserting the fixture table matches reality. */
async function seedWorldCheckpoints(world: EngineWorld, worldCase: WorldCase): Promise<void> {
  const seedPath = expectedFile(world, CHECKPOINT_SEED_REL);
  const present = existsSync(seedPath);
  assert.equal(
    present,
    worldCase.seedsCheckpoints,
    `fixture drift: world '${world.name}' ${worldCase.seedsCheckpoints ? "must ship" : "must NOT ship"} expected/${CHECKPOINT_SEED_REL} (bootstrap/sync reality depends on it)`,
  );
  if (present) {
    await seedCheckpoints(world, readExpectedJson<Record<string, Checkpoint>>(world, CHECKPOINT_SEED_REL));
  }
}

async function buildPurityCell(worldCase: WorldCase): Promise<void> {
  const w = await buildWorld(worldCase.name);
  try {
    await seedWorldCheckpoints(w, worldCase);

    // Pre-build baselines: full repo tree, full state tree, port-call watermark.
    const repoBefore = await snapshotTree(w.repositoryRoot);
    const stateBefore = await snapshotTree(w.stateDir);
    const mark = callsMark(w);
    assert.ok(repoBefore.size > 0, `world '${w.name}' materialized an empty repo tree — the purity cell would be vacuous`);

    const engine = attachEngine(w, createSyncEngine, { keyProvider: w.keyProvider });
    const plan = await engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot });

    // Positive floor: planning actually produced a Plan (else absence checks pass vacuously).
    assert.equal(typeof plan.planId, "string", "buildSyncPlan resolved without a Plan.planId");
    assert.ok(plan.planId.length > 0, "buildSyncPlan resolved with an empty planId");

    // (a) zero mutating port calls since the watermark (reads are allowed; mutationCalls
    //     is exactly this filter over MUTATING_PORT_METHODS — asserted via the same lens).
    const attempted = callsSince(w, mark);
    assert.deepEqual(
      attempted.filter((c) => MUTATING_PORT_METHODS.has(c.method)).map(formatCall),
      [],
      `buildSyncPlan must attempt ZERO mutating port calls (constitution I) — reads such as listIssues/getIssue/getAttachmentByUrl/listAttachments/discoverMetadata are allowed`,
    );
    assert.deepEqual(
      attempted.filter((c) => c.phase !== "buildSyncPlan").map(formatCall),
      [],
      "every port call attempted in this cell belongs to the buildSyncPlan phase (no port activity outside the engine seam)",
    );

    // (b) repo tree byte-identical (no rewrite, no new/removed file, no type drift).
    const repoAfter = await snapshotTree(w.repositoryRoot);
    assert.deepEqual(
      diffTrees(repoBefore, repoAfter).map(formatDelta),
      [],
      `fixture repo tree must be byte-identical after planning — buildSyncPlan performs zero repository writes (engine-pipeline.md Non-goals: repo writes ride planned render-file ops only)`,
    );

    // (c) state-directory changes confined to plans/ + reports/ (stage-7 artifacts).
    const stateAfter = await snapshotTree(w.stateDir);
    assert.deepEqual(
      diffTrees(stateBefore, stateAfter).filter((d) => !inAllowedStateArea(d.path)).map(formatDelta),
      [],
      "the only state-directory writes planning may produce live under plans/ and reports/ (stage 7: plan + report artifacts; state directory only)",
    );
    assert.equal(
      stateAfter.get("sync-state.json") ?? null,
      stateBefore.get("sync-state.json") ?? null,
      "planning never checkpoints — sync-state.json must be byte-unchanged (checkpoint writes belong to apply)",
    );
    assert.deepEqual(
      [...stateAfter.keys()].filter((p) => APPLY_ONLY_STATE_RE.test(p)).sort(),
      [],
      "planning creates no run manifests, step journals, or create intents — manifests/, runs/, intents/ must not appear (even empty directories)",
    );
  } finally {
    await w.dispose();
  }
}

for (const worldCase of US1_WORLDS) {
  test(
    `engine-build-purity — ${worldCase.name}: buildSyncPlan leaves zero mutating port calls, a byte-identical repo tree, and plans/-reports/-only state writes`,
    () => buildPurityCell(worldCase),
  );
}
