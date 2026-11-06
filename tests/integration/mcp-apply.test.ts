/**
 * T041 [US2] — integration: `task_sync_apply` over the T024 in-process stdio pipe +
 * FakeTracker (apply-gating.md §1–§4; SC-001 evidence). Tests written FIRST.
 */

import assert from "node:assert/strict";
import { join } from "node:path";
import { readdirSync, readFileSync, statSync } from "node:fs";
import test from "node:test";

import { hashTree } from "../helpers/cli-harness.js";
import { withMcpServer } from "../helpers/mcp-harness.js";
import type { JsonRpcMessage, McpFixture } from "../helpers/mcp-harness.js";

const MUTATING_METHODS = new Set([
  "createIssue",
  "updateIssue",
  "archiveIssue",
  "upsertAttachmentByUrl",
  "updateAttachment",
]);

async function toolsList(fx: McpFixture): Promise<string[]> {
  const response = await fx.request("tools/list");
  const result = response.result as { tools: Array<{ name: string }> };
  return result.tools.map((t) => t.name);
}

function toolResult(response: JsonRpcMessage): { isError?: boolean; text: string } {
  const result = response.result as { isError?: boolean; content: Array<{ text: string }> };
  assert.ok(result?.content?.[0], `no content block in ${JSON.stringify(response)}`);
  return { isError: result.isError, text: result.content[0]!.text };
}

function mutationCalls(fx: McpFixture): string[] {
  return fx.world.fake.callLog
    .map((c) => String((c as { method?: string }).method ?? ""))
    .filter((m) => MUTATING_METHODS.has(m));
}

/** Snapshot of the repo tree (paths + contents), outside the state dir. */
function snapshotRepo(root: string): { paths: string[]; contents: Map<string, string> } {
  const contents = new Map<string, string>();
  for (const entry of readdirSync(root, { recursive: true })) {
    const rel = String(entry);
    const full = join(root, rel);
    if (statSync(full).isFile() && !rel.includes("node_modules")) contents.set(rel, readFileSync(full, "utf8"));
  }
  return { paths: [...contents.keys()].sort(), contents };
}

test("mcp-apply: SC-003 — defaults hide task_sync_apply; enabled:true shows exactly four", async () => {
  await withMcpServer(async (fx) => {
    await fx.initialize();
    assert.deepEqual((await toolsList(fx)).sort(), ["task_sync_inventory", "task_sync_plan", "task_sync_status"]);
  });
  await withMcpServer(
    async (fx) => {
      await fx.initialize();
      assert.deepEqual((await toolsList(fx)).sort(), [
        "task_sync_apply",
        "task_sync_inventory",
        "task_sync_plan",
        "task_sync_status",
      ]);
    },
    { settings: { enabled: true } },
  );
});

test("mcp-apply: default-disabled apply is refused over the wire BEFORE anything is touched", async () => {
  await withMcpServer(async (fx) => {
    await fx.initialize();
    const repoHash = hashTree(fx.world.repositoryRoot);
    const before = fx.world.fake.callLog.length;
    const response = toolResult(
      await fx.request("tools/call", {
        name: "task_sync_apply",
        arguments: { planReference: "e".repeat(64), confirmationKey: fx.world.config.confirmationKey },
      }),
    );
    assert.equal(response.isError, true);
    assert.ok(response.text.includes("MUTATING_TOOLS_DISABLED"), response.text);
    assert.ok(response.text.includes("mcp.enabled"), "names the config key");
    assert.deepEqual(mutationCalls(fx), [], "zero port mutations");
    assert.equal(fx.world.fake.callLog.length, before, "not even a READ call left the surface");
    assert.equal(hashTree(fx.world.repositoryRoot), repoHash, "repo tree byte-equal");
  });
});

test("mcp-apply: full over-the-wire flow — plan then apply lands mutations and the §4 payload", async () => {
  await withMcpServer(
    async (fx) => {
      await fx.initialize();
      const before = snapshotRepo(fx.world.repositoryRoot);

      const plan = toolResult(await fx.request("tools/call", { name: "task_sync_plan", arguments: {} }));
      assert.notEqual(plan.isError, true, plan.text);
      const planPayload = JSON.parse(plan.text) as {
        planReference: string;
        report?: { groups?: Array<{ entries?: Array<{ filePath: string }> }> };
      };
      const plannedDirs = new Set(
        (planPayload.report?.groups ?? []).flatMap((g) => (g.entries ?? []).map((e) => e.filePath.split("/").slice(0, -1).join("/"))),
      );
      assert.ok(plannedDirs.size > 0, "the plan carries task entries");

      const applied = toolResult(
        await fx.request("tools/call", {
          name: "task_sync_apply",
          arguments: {
            planReference: planPayload.planReference,
            confirmationKey: fx.world.config.confirmationKey,
            acceptLowConfidence: true,
          },
        }),
      );
      assert.notEqual(applied.isError, true, `apply refused: ${applied.text}`);
      const payload = JSON.parse(applied.text) as Record<string, unknown>;
      assert.equal(payload.schemaVersion, 1);
      assert.equal(payload.status, "applied");
      assert.deepEqual(Object.keys(payload), ["schemaVersion", "runId", "status", "counts", "reportPaths"]);
      assert.ok(mutationCalls(fx).length > 0, "the fake port received mutations");

      // The repo tree gets NO new or removed paths; content may change ONLY inside the
      // directories of planned tasks (mutations + conflict markers) — apply NEVER
      // writes outside the planned working set or the state dir (apply-gating.md).
      const after = snapshotRepo(fx.world.repositoryRoot);
      assert.deepEqual(after.paths, before.paths, "no repo path appears or disappears");
      for (const [path, content] of after.contents) {
        if (before.contents.get(path) === content) continue;
        const owner = path.split("/").slice(0, -1).join("/");
        assert.ok(plannedDirs.has(owner), `changed file outside the planned set: ${path}`);
      }
    },
    { settings: { enabled: true } },
  );
});

test("mcp-apply: wrong confirmation over the wire ⇒ isError listing the gate failure, zero mutations, zero writes", async () => {
  await withMcpServer(
    async (fx) => {
      await fx.initialize();
      const repoHash = hashTree(fx.world.repositoryRoot);
      const stateHash = hashTree(fx.world.stateDir);

      const plan = toolResult(await fx.request("tools/call", { name: "task_sync_plan", arguments: {} }));
      const planReference = String((JSON.parse(plan.text) as Record<string, unknown>).planReference);

      const refused = toolResult(
        await fx.request("tools/call", {
          name: "task_sync_apply",
          arguments: { planReference, confirmationKey: "not-the-configured-key" },
        }),
      );
      assert.equal(refused.isError, true);
      assert.ok(refused.text.includes("CONFIRMATION_KEY_MISMATCH"), refused.text);
      assert.equal(refused.text.includes("not-the-configured-key"), false, "never echoes the presented key");
      assert.deepEqual(mutationCalls(fx), [], "SC-001: refusal ⇒ ZERO mutations");
      assert.equal(hashTree(fx.world.repositoryRoot), repoHash, "repo tree byte-equal");
      // The ONLY legitimate state-dir delta: the plan artifacts from task_sync_plan itself
      // (plans/ + reports/). Refusal run residue would show up under runs/, manifests/, or
      // last-run.json — none of those may appear.
      const { existsSync } = await import("node:fs");
      const { join } = await import("node:path");
      for (const residue of ["runs", "manifests", "last-run.json"]) {
        assert.equal(existsSync(join(fx.world.stateDir, residue)), false, `no ${residue} after a refusal`);
      }
      void stateHash;
    },
    { settings: { enabled: true } },
  );
});

test("mcp-apply: drifted plan (guard file edited after planning) ⇒ PLAN_REFERENCE_STALE, zero mutations", async () => {
  await withMcpServer(
    async (fx) => {
      await fx.initialize();
      const plan = toolResult(await fx.request("tools/call", { name: "task_sync_plan", arguments: {} }));
      const planReference = String((JSON.parse(plan.text) as Record<string, unknown>).planReference);

      // Drift: touch a guard file in the working set (the engine re-hashes live guards).
      const { readFileSync, readdirSync, writeFileSync } = await import("node:fs");
      const { join } = await import("node:path");
      const taskFiles = readdirSync(fx.world.repositoryRoot, { recursive: true })
        .map(String)
        .filter((f) => f.endsWith(".md") && !f.includes("node_modules"));
      assert.ok(taskFiles.length > 0, "the world has task files to drift");
      const victim = join(fx.world.repositoryRoot, taskFiles[0]!);
      writeFileSync(victim, `${readFileSync(victim, "utf8")}\n<!-- drift -->\n`, "utf8");

      const stale = toolResult(
        await fx.request("tools/call", {
          name: "task_sync_apply",
          arguments: { planReference, confirmationKey: fx.world.config.confirmationKey, acceptLowConfidence: true },
        }),
      );
      assert.equal(stale.isError, true);
      assert.ok(stale.text.includes("PLAN_REFERENCE_STALE"), stale.text);
      assert.deepEqual(mutationCalls(fx), [], "drift refusal ⇒ ZERO mutations (engine pre-lock design)");
    },
    { settings: { enabled: true } },
  );
});
