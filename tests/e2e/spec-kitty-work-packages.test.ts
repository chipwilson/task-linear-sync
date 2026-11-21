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
import { tmpdir } from "node:os";
import { join } from "node:path";

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
