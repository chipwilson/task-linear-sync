/**
 * T022 — FAILING unit tests for the agent-hook scaffold installation (spec 010, FR-009,
 * contracts/hook-installation.md §2). Module under test: `src/queue/agent-hooks.ts` —
 * installAgentHooks over the frozen-pure 003 `agentHookScaffold`, enriched additively
 * with `event` + `pathPatterns`.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { installAgentHooks, type AgentHookSettings } from "../../src/queue/agent-hooks.js";
import { makeQueueHarness } from "../helpers/queue-harness.js";

function settings(overrides: Partial<AgentHookSettings> = {}): AgentHookSettings {
  return {
    frameworkId: "kiro",
    binName: "task-linear-sync",
    agentHooksDirectory: null,
    taskFilePatterns: ["tasks/**/*.md", "docs/tasks/*.md"],
    ...overrides,
  };
}

const KIRO_FILE = join(".kiro", "hooks", "task-linear-sync-sync.json");

test("default framework (kiro) writes the enriched scaffold under the 003 default directory", async () => {
  const h = await makeQueueHarness();
  try {
    const res = await installAgentHooks(h.repositoryRoot, settings({ frameworkId: undefined }));
    assert.equal(res.status, "installed");
    assert.ok(res.path, "the written path is reported (009 QueueOutcome shape)");

    const written = join(h.repositoryRoot, KIRO_FILE);
    assert.ok(existsSync(written), `${KIRO_FILE} written`);
    const doc = JSON.parse(readFileSync(written, "utf8")) as Record<string, unknown>;

    // 003 record shape stays valid — enrichment is additive only.
    assert.equal(doc.name, "task-linear-sync-sync");
    assert.equal(doc.action, "command");
    assert.equal(doc.command, "task-linear-sync enqueue");
    assert.equal(doc.event, "post-file-save");
    assert.deepEqual(doc.pathPatterns, ["tasks/**/*.md", "docs/tasks/*.md"]);
  } finally {
    h.dispose();
  }
});

test("generic framework falls back to .task-linear-sync/hooks/", async () => {
  const h = await makeQueueHarness();
  try {
    const res = await installAgentHooks(h.repositoryRoot, settings({ frameworkId: "generic" }));
    assert.equal(res.status, "installed");
    assert.ok(existsSync(join(h.repositoryRoot, ".task-linear-sync", "hooks", "task-linear-sync-sync.json")));
  } finally {
    h.dispose();
  }
});

test("config.agentHooksDirectory override wins over the framework default", async () => {
  const h = await makeQueueHarness();
  try {
    const res = await installAgentHooks(h.repositoryRoot, settings({ agentHooksDirectory: "team/agent-hooks" }));
    assert.equal(res.status, "installed");
    assert.ok(existsSync(join(h.repositoryRoot, "team", "agent-hooks", "task-linear-sync-sync.json")));
    assert.equal(existsSync(join(h.repositoryRoot, ".kiro")), false, "no partial writes in the default dir");
  } finally {
    h.dispose();
  }
});

test("collision never overwrites: first free suffix -2, then -3", async () => {
  const h = await makeQueueHarness();
  try {
    const first = await installAgentHooks(h.repositoryRoot, settings());
    const second = await installAgentHooks(h.repositoryRoot, settings());
    const third = await installAgentHooks(h.repositoryRoot, settings());
    assert.ok(first.path?.endsWith("task-linear-sync-sync.json"));
    assert.ok(second.path?.endsWith("task-linear-sync-sync-2.json"), `got ${second.path}`);
    assert.ok(third.path?.endsWith("task-linear-sync-sync-3.json"), `got ${third.path}`);
    assert.equal(second.status, "installed");
    const dir = join(h.repositoryRoot, ".kiro", "hooks");
    assert.deepEqual(readdirSync(dir).sort(), [
      "task-linear-sync-sync-2.json",
      "task-linear-sync-sync-3.json",
      "task-linear-sync-sync.json",
    ]);
  } finally {
    h.dispose();
  }
});

test("unknown framework id is refused with no writes", async () => {
  const h = await makeQueueHarness();
  try {
    const res = await installAgentHooks(h.repositoryRoot, settings({ frameworkId: "definitely-not-a-framework" }));
    assert.equal(res.status, "refused");
    assert.match(res.detail ?? "", /definitely-not-a-framework/);
    assert.equal(existsSync(join(h.repositoryRoot, ".kiro")), false);
  } finally {
    h.dispose();
  }
});

test("framework without a scaffold template is refused", async () => {
  const h = await makeQueueHarness();
  try {
    // "spec-kit" is a built-in framework id but carries no agent-hook template (003).
    const res = await installAgentHooks(h.repositoryRoot, settings({ frameworkId: "spec-kit" }));
    assert.equal(res.status, "refused");
    assert.equal(readdirSync(h.repositoryRoot).includes(".kiro"), false);
  } finally {
    h.dispose();
  }
});

test("spec-kitty is refused too: a template-less built-in writes nothing (017 FR-012, C1.3)", async () => {
  const h = await makeQueueHarness();
  try {
    // "spec-kitty" is a built-in framework id but carries no agent-hook scaffold (017).
    const res = await installAgentHooks(h.repositoryRoot, settings({ frameworkId: "spec-kitty" }));
    assert.equal(res.status, "refused");
    assert.match(res.detail ?? "", /spec-kitty.*no agent-hook scaffold template/u, "template-less diagnostic");
    // Zero writes: neither the framework's hook directory nor any other new entry appears.
    assert.equal(readdirSync(h.repositoryRoot).includes(".specify"), false);
    assert.equal(readdirSync(h.repositoryRoot).includes("kitty-specs"), false);
  } finally {
    h.dispose();
  }
});

test("binName drives both the file name and the enqueue command (single lock-free lane)", async () => {
  const h = await makeQueueHarness();
  try {
    const res = await installAgentHooks(h.repositoryRoot, settings({ binName: "mytool-sync" }));
    assert.equal(res.status, "installed");
    const doc = JSON.parse(readFileSync(join(h.repositoryRoot, ".kiro", "hooks", "mytool-sync-sync.json"), "utf8")) as {
      command: string;
    };
    assert.equal(doc.command, "mytool-sync enqueue");
  } finally {
    h.dispose();
  }
});

test("hygiene: the written scaffold embeds no absolute paths", async () => {
  const h = await makeQueueHarness();
  try {
    await installAgentHooks(h.repositoryRoot, settings());
    const body = readFileSync(join(h.repositoryRoot, KIRO_FILE), "utf8");
    assert.ok(!body.includes(h.root), "no machine paths in the scaffold");
  } finally {
    h.dispose();
  }
});
