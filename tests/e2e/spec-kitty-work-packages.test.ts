/**
 * T025 [022 US1] — the US1 scenario walkthrough (quickstart steps 3–4) on the read-only
 * CLI / fake-`Linear_Port` lane over a scratch copy of the upstream-reproduction fixture
 * (T003). `inventory` lists every collection file and roll-up under framework
 * `spec-kitty` — roll-ups at `tasks=0`, recognized documents at `tasks=1`; `plan` yields
 * exactly one entry per WP document with the cascaded title, the verbatim-minus-front-
 * matter content, `expectedMarkdownChanges` empty everywhere, zero roll-up-line entries,
 * and no dependency edges (017 C3.7 stance retained; C2.3, C3, C6.1). The plan/inventory
 * pair stays read-only (SC-003): zero mutating port calls.
 *
 * US2/US3 walkthroughs extend this file in T039 — sequential hot spot.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { ExitCode, runCli } from "../../src/cli/index.js";
import { buildCliWorld } from "../helpers/cli-harness.js";
import { fixtureRepoPath } from "../helpers/discovery-fixtures.js";
import { attachEngine } from "../helpers/engine-harness.js";
import { createSyncEngine } from "../../src/engine/create.js";

const UPSTREAM = join(fixtureRepoPath("spec-kitty"), "../../plan/spec-kitty-upstream");

/** Placeholder bootstrap identities (Principle III) — same minimal world as the unit lane. */
const WORLD = {
  clock: "2026-01-01T00:00:00.000Z",
  teams: [
    {
      key: "TEAM-A",
      id: "ac000000-0000-4000-8000-000000000101",
      projects: [{ id: "proj-alpha", name: "Project Alpha" }],
      workflowStates: [
        { id: "ac000000-0000-4000-8000-000000000201", name: "Backlog", type: "backlog" },
        { id: "ac000000-0000-4000-8000-000000000202", name: "Todo", type: "todo" },
        { id: "ac000000-0000-4000-8000-000000000203", name: "Done", type: "completed" },
        { id: "ac000000-0000-4000-8000-000000000204", name: "In Progress", type: "started" },
        { id: "ac000000-0000-4000-8000-000000000205", name: "Canceled", type: "canceled" },
      ],
    },
  ],
  config: {
    teams: {
      "TEAM-A": {
        projects: ["proj-alpha"],
        workflowStates: {
          backlog: "Backlog",
          todo: "Todo",
          done: "Done",
          completedTypes: ["completed"],
          ignoredTypes: ["canceled", "duplicate"],
        },
      },
    },
    defaultTeamKey: "TEAM-A",
    defaultProject: "proj-alpha",
    confirmationKey: "SYNC",
    descriptionNormalizationProfile: "default",
  },
} as const;

test("e2e spec-kitty (022 US1): inventory + plan over the upstream reproduction — one entry per work package, roll-ups inert, read-only", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "tls-022-e2e-"));
  try {
    await writeFile(join(scratch, "world.json"), JSON.stringify(WORLD), "utf8");
    await cp(UPSTREAM, join(scratch, "repo"), { recursive: true });
    const w = await buildCliWorld(scratch);
    try {
      const { cliContext, stdout, stderr } = w.createContext();

      // Step 3 — inventory (read-only).
      const inventory = await runCli(["inventory", w.repositoryRoot], cliContext);
      assert.equal(inventory.exitCode, ExitCode.SUCCESS, stderr.join("\n"));
      const lines = new Map(
        stdout
          .filter((l) => l.includes("framework="))
          .map((l) => {
            const [path, framework, tasks] = l.split(/\s{2,}/u);
            return [path as string, { framework: framework?.replace("framework=", "") ?? "", tasks: Number(tasks?.replace("tasks=", "")) }] as const;
          }),
      );
      assert.equal(lines.size, 7, `two roll-ups + five documents listed: ${[...lines.keys()].join(", ")}`);
      for (const [path, row] of lines) {
        assert.equal(row.framework, "spec-kitty", `${path} framework`);
        assert.equal(row.tasks, path.includes("/tasks/") ? 1 : 0, `${path} — roll-ups list tasks=0, documents tasks=1`);
      }
      assert.ok(lines.has("kitty-specs/001-triage/tasks.md"), "roll-ups are listed (claimed, inert)");
      assert.ok(lines.has("kitty-specs/002-lightweight-pypi-release/tasks/WP01-release-validation-tooling.md"), "collection documents are listed");

      // Step 4 — plan (read-only lane).
      const plan = await runCli(["plan", w.repositoryRoot], cliContext);
      assert.equal(plan.exitCode, ExitCode.SUCCESS, stderr.join("\n"));
      const MUTATING = new Set(["createIssue", "updateIssue", "archiveIssue", "upsertAttachmentByUrl", "updateAttachment"]);
      assert.equal(
        w.world.calls.filter((c) => MUTATING.has(c.method) && c.ok !== false).length,
        0,
        "inventory + plan stay read-only (SC-003)",
      );

      // Plan content through the same world: one entry per WP document (C2.3, C3).
      const engine = attachEngine(w.world, createSyncEngine, { keyProvider: w.world.keyProvider });
      const built = await engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot });
      assert.equal(built.entries.length, 5, "five WP documents, five entries — zero roll-up-line entries (FR-009)");
      assert.ok(!built.entries.some((e) => e.filePath.endsWith("/tasks.md") || e.filePath.endsWith("tasks.md")), "no entry names a roll-up");
      assert.deepEqual(
        [...new Set(built.entries.map((e) => e.featureName))].sort(),
        ["001-triage", "002-lightweight-pypi-release"],
        "entries carry the mission feature names",
      );
      assert.ok(built.entries.every((e) => e.expectedMarkdownChanges.length === 0), "expectedMarkdownChanges empty everywhere (C6.1)");
      assert.ok(built.entries.every((e) => e.decision === "create"), "bootstrap: every document creates");

      // Content = document minus front matter: verified end-to-end through a real apply.
      const applied = await engine.applySyncPlan(built, {
        applyFlag: true,
        confirmationKey: w.world.config.confirmationKey,
        acceptLowConfidence: built.lowConfidencePresent,
        planReference: built.planId,
      });
      assert.equal(applied.status, "applied");
      const creates = w.world.calls
        .filter((c) => c.method === "createIssue")
        .map((c) => (c.args[0] as { title: string; description?: string; parentId?: string }));
      assert.deepEqual(
        creates.map((c) => c.title).sort(),
        [
          "Intake Template",
          "Weekly Export",
          "Release Validation Tooling",
          "Publication Runbook",
          "Post-Release Verification",
        ].sort(),
        "cascaded titles (front matter wins) land as issue titles (C3.1, SC-002)",
      );
      assert.ok(creates.every((c) => c.parentId === undefined), "no dependency edges — no created issue has a parent (017 C3.7 stance retained)");
      const target = creates.find((c) => c.title === "Release Validation Tooling");
      assert.ok(target, "the release-validation document created");
      const description = target!.description ?? "";
      assert.ok(description.includes("## Objectives & Success Criteria"), "Objectives mirrored verbatim");
      assert.ok(/T00\d/u.test(description), "Tnnn step guidance mirrored verbatim");
      assert.match(description, /- \[[ x]\]/u, "Definition-of-Done checkboxes mirror verbatim (content, never tasks)");
      assert.ok(!description.includes("work_package_id"), "zero raw front matter anywhere in mirrored content (C3.2)");
    } finally {
      await w.dispose();
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

// ─────────────────────────────────────────────────── T039 — US2/US3 walkthroughs

const engineWorldDir = (name: string): string =>
  fileURLToPath(new URL(`../../../tests/fixtures/engine/worlds/${name}/`, import.meta.url));

test("e2e spec-kitty (022 US3 / quickstart step 5): lifecycle walkthrough — idempotence, edits, rename, zero write-back", async () => {
  const w = await buildCliWorld(engineWorldDir("spec-kitty-lifecycle"));
  try {
    const { cliContext } = w.createContext();
    const planCli = await runCli(["plan", w.repositoryRoot], cliContext);
    assert.equal(planCli.exitCode, ExitCode.SUCCESS);

    const engine = attachEngine(w.world, createSyncEngine, { keyProvider: w.world.keyProvider });
    const gatesFor = (p: { planId: string; lowConfidencePresent: boolean }) => ({
      applyFlag: true,
      confirmationKey: w.world.config.confirmationKey,
      acceptLowConfidence: p.lowConfidencePresent,
      planReference: p.planId,
    });
    const counts = (p: { entries: readonly { decision: string }[] }) => {
      const out: Record<string, number> = {};
      for (const e of p.entries) out[e.decision] = (out[e.decision] ?? 0) + 1;
      return out;
    };

    const plan1 = await engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot });
    assert.deepEqual(counts(plan1), { create: 2 });
    await engine.applySyncPlan(plan1, gatesFor(plan1));
    assert.deepEqual(counts(await engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot })), { "no-change": 2 });

    // The lifecycle edits: lane flip, appends, in-collection rename.
    const alphaPath = join(w.repositoryRoot, "kitty-specs/002-alpha/tasks/WP01-one.md");
    const edited = readFileSync(alphaPath, "utf8")
      .replace("lane: planned", "lane: claimed")
      .concat("\n## Review Report\n\nReviewed — proceed.\n");
    writeFileSync(alphaPath, edited, "utf8");
    const renamed = join(w.repositoryRoot, "kitty-specs/002-alpha/tasks/WP01-one-tooling.md");
    renameSync(alphaPath, renamed);

    const plan3 = await engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot });
    assert.equal(counts(plan3).create ?? 0, 0, "zero new tasks after the lifecycle edits");
    const before = w.world.calls.length;
    await engine.applySyncPlan(plan3, gatesFor(plan3));
    assert.equal(w.world.calls.filter((c, i) => i >= before && c.method === "createIssue").length, 0);
    assert.equal(w.world.calls.filter((c, i) => i >= before && c.method === "updateIssue").length, 1, "the SAME issue updates once");

    // Zero write-back: the landed file equals the user's edited bytes.
    assert.equal(readFileSync(renamed, "utf8"), edited);
    assert.deepEqual(counts(await engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot })), { "no-change": 2 }, "settling re-plan is a full no-op (FR-010)");
  } finally {
    await w.dispose();
  }
});

test("e2e spec-kitty (022 US2 / quickstart step 6): leftovers walkthrough — documents only, every legacy issue unmapped, none paired", async () => {
  const w = await buildCliWorld(engineWorldDir("spec-kitty-rollup-leftovers"));
  try {
    const { cliContext } = w.createContext();
    const planCli = await runCli(["plan", w.repositoryRoot], cliContext);
    assert.equal(planCli.exitCode, ExitCode.SUCCESS);

    const engine = attachEngine(w.world, createSyncEngine, { keyProvider: w.world.keyProvider });
    const plan = await engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot });
    assert.ok(plan.entries.length === 5 && plan.entries.every((e) => e.filePath.includes("/tasks/")));
    assert.ok(plan.entries.every((e) => e.decision === "create" && e.match === undefined), "zero pairings onto legacy issues (C5.1)");
    assert.equal(plan.unmappedIssues.length, 19, "every roll-up-era issue is surfaced stale/unmapped");
    assert.ok(plan.unmappedIssues.some((u) => u.title.includes("Release Validation Tooling")), "the title-contained bait is unmapped, not paired (FR-011)");
    assert.equal(w.world.calls.filter((c) => c.method === "archiveIssue").length, 0, "nothing is archived (C5.2)");
  } finally {
    await w.dispose();
  }
});

test("e2e spec-kitty (022 C2.4 / quickstart step 7): collision probe — plan refuses naming mission, WP01, both paths; removal restores", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "tls-022-collide-"));
  try {
    await cp(join(engineWorldDir("spec-kitty-lifecycle"), "world.json"), join(scratch, "world.json"));
    const cw = JSON.parse(readFileSync(join(scratch, "world.json"), "utf8")) as Record<string, unknown>;
    delete cw.name; // world name must equal the (random) scratch directory name
    await writeFile(join(scratch, "world.json"), JSON.stringify(cw), "utf8");
    await cp(join(engineWorldDir("spec-kitty-lifecycle"), "repo"), join(scratch, "repo"), { recursive: true });
    await writeFile(
      join(scratch, "repo/kitty-specs/002-alpha/tasks/WP01-duplicate.md"),
      "---\nlane: planned\n---\n\n# One duplicate\n\nSecond WP01 in the same mission.\n",
      "utf8",
    );
    const w = await buildCliWorld(scratch);
    try {
      const { cliContext, stdout, stderr } = w.createContext();
      const refusal = await runCli(["plan", w.repositoryRoot], cliContext);
      assert.notEqual(refusal.exitCode, ExitCode.SUCCESS, "the colliding plan refuses");
      const noise = [...stderr, ...stdout].join("\n");
      assert.match(noise, /WP01/u, "the finding names WP01");
      assert.match(noise, /WP01-duplicate\.md/u, "the finding names the duplicate path");
      assert.match(noise, /WP01-one\.md/u, "the finding names the existing path");
      assert.ok(
        noise.indexOf("kitty-specs/002-alpha/tasks/WP01-duplicate.md") < noise.indexOf("kitty-specs/002-alpha/tasks/WP01-one.md"),
        "paths appear in the deterministic sorted order (C2.4)",
      );
      assert.equal(w.world.calls.filter((c) => ["createIssue", "updateIssue", "archiveIssue"].includes(c.method) && c.ok !== false).length, 0, "refusal performs no mutations");

      await rm(join(w.repositoryRoot, "kitty-specs/002-alpha/tasks/WP01-duplicate.md"));
      const clean = await runCli(["plan", w.repositoryRoot], w.createContext().cliContext);
      assert.equal(clean.exitCode, ExitCode.SUCCESS, "removing one file restores a clean plan");
    } finally {
      await w.dispose();
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test("e2e spec-kitty (022 FR-013 / quickstart step 8): opt-out — with spec-kitty disabled the files fall through to generic", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "tls-022-optout-"));
  try {
    const world = JSON.parse(readFileSync(join(engineWorldDir("spec-kitty-lifecycle"), "world.json"), "utf8")) as {
      config: Record<string, unknown>;
      name?: string;
    };
    delete world.name; // world name must equal the (random) scratch directory name
    world.config.frameworkAdapters = ["kiro", "spec-kit", "open-spec", "bmad", "spec-superpower", "generic"];
    await writeFile(join(scratch, "world.json"), JSON.stringify(world), "utf8");
    await cp(join(engineWorldDir("spec-kitty-lifecycle"), "repo"), join(scratch, "repo"), { recursive: true });
    const w = await buildCliWorld(scratch);
    try {
      const { cliContext, stdout, stderr } = w.createContext();
      const inventory = await runCli(["inventory", w.repositoryRoot], cliContext);
      assert.equal(inventory.exitCode, ExitCode.SUCCESS, stderr.join("\n"));
      const rows = stdout
        .filter((l) => l.includes("kitty-specs/") && l.includes("framework="))
        .map((l) => {
          const [path, framework] = l.split(/\s{2,}/u);
          return { path: path as string, framework: framework?.replace("framework=", "") ?? "" };
        });
      assert.ok(rows.length > 0, `roll-ups still surface via generic's basename patterns: ${stdout.join("\n")}`);
      assert.ok(rows.every((r) => r.framework === "generic"), "every claimed file is generic — no spec-kitty identity");
      assert.ok(rows.every((r) => r.path.endsWith("tasks.md") || r.path.endsWith("TASKS.md")), "documents under tasks/ are NOT claimed (pre-017 fall-through)");
    } finally {
      await w.dispose();
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});
