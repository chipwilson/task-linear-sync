/**
 * T014 [P] — unit tests for the tool registry (T022) (FR-002; contracts/
 * tool-definitions.md §1–§2). Visibility is the PURE predicate
 * `visible = !def.mutating || settings.enabled` driving BOTH tools/list rendering
 * AND tools/call dispatch.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  resolveToolCall,
  TASK_SYNC_APPLY_TOOL,
  TASK_SYNC_INVENTORY_TOOL,
  TASK_SYNC_PLAN_TOOL,
  TASK_SYNC_STATUS_TOOL,
  TOOL_DEFINITIONS,
  TOOL_NAMES,
  validateToolArguments,
  visibleTools,
} from "../../src/mcp/tools.js";

const DISABLED = { enabled: false };
const ENABLED = { enabled: true };

test("TOOL_NAMES is the closed four-name set", () => {
  assert.deepEqual([...TOOL_NAMES].sort(), [
    "task_sync_apply",
    "task_sync_inventory",
    "task_sync_plan",
    "task_sync_status",
  ]);
});

test("four static definitions with the mutating flag on apply only", () => {
  assert.equal(TOOL_DEFINITIONS.length, 4);
  for (const def of TOOL_DEFINITIONS) {
    assert.equal(typeof def.name, "string");
    assert.equal(typeof def.description, "string");
    assert.equal(typeof def.inputSchema, "object");
    assert.equal(def.inputSchema.additionalProperties, false, `${def.name} strict schema`);
    assert.equal(def.inputSchema.type, "object");
  }
  assert.equal(TASK_SYNC_APPLY_TOOL.mutating, true);
  assert.equal(TASK_SYNC_PLAN_TOOL.mutating, false);
  assert.equal(TASK_SYNC_STATUS_TOOL.mutating, false);
  assert.equal(TASK_SYNC_INVENTORY_TOOL.mutating, false);
});

test("at defaults the listing is EXACTLY the three read-only tools (apply NOT advertised)", () => {
  const listed = visibleTools(DISABLED);
  assert.deepEqual(
    listed.map((t) => t.name).sort(),
    ["task_sync_inventory", "task_sync_plan", "task_sync_status"],
  );
});

test("enabled:true adds EXACTLY apply — nothing else changes", () => {
  const off = visibleTools(DISABLED).map((t) => t.name).sort();
  const on = visibleTools(ENABLED).map((t) => t.name).sort();
  assert.deepEqual(on, [...off, "task_sync_apply"].sort());
});

test("the listing is PURE per settings — identical deep content across repeated calls", () => {
  assert.deepEqual(visibleTools(DISABLED), visibleTools(DISABLED));
  assert.deepEqual(visibleTools(ENABLED), visibleTools(ENABLED));
});

test("dispatch uses the SAME predicate: disabled apply resolves invisible, never callable", () => {
  assert.deepEqual(resolveToolCall("task_sync_apply", DISABLED), { kind: "invisible" });
  assert.equal(resolveToolCall("task_sync_apply", ENABLED).kind, "ok");
  assert.equal(resolveToolCall("task_sync_plan", DISABLED).kind, "ok");
});

test("unknown tool names resolve to the 'unknown' posture (never a -32601 method fault)", () => {
  assert.deepEqual(resolveToolCall("task_sync_deploy", ENABLED), { kind: "unknown" });
  assert.deepEqual(resolveToolCall("", ENABLED), { kind: "unknown" });
  assert.deepEqual(resolveToolCall("task_sync_apply ", ENABLED), { kind: "unknown" });
});

// ─────────────────────────────── complete-listing validator

test("apply validator reports EVERY problem in ONE pass", () => {
  const issues = validateToolArguments("task_sync_apply", {
    planReference: "XYZ",
    acceptLowConfidence: "yes",
    surprise: 1,
  });
  const paths = issues.map((i) => i.path);
  assert.ok(paths.includes("planReference"), `non-64-hex flagged: ${JSON.stringify(issues)}`);
  assert.ok(paths.includes("confirmationKey"), "missing required key flagged");
  assert.ok(paths.includes("acceptLowConfidence"), "wrong type flagged");
  assert.ok(paths.includes("surprise"), "unknown key flagged (additionalProperties:false)");
  assert.equal(issues.length, 4);
});

test("apply accepts the exact frozen shape", () => {
  assert.deepEqual(
    validateToolArguments("task_sync_apply", {
      planReference: "a".repeat(64),
      confirmationKey: "key",
      acceptLowConfidence: true,
    }),
    [],
  );
  // acceptLowConfidence optional (default false applied downstream, never implied).
  assert.deepEqual(validateToolArguments("task_sync_apply", { planReference: "a".repeat(64), confirmationKey: "k" }), []);
});

test("apply rejects wrong shapes: non-string keys, empty confirmationKey, non-object roots", () => {
  assert.ok(validateToolArguments("task_sync_apply", { planReference: 7, confirmationKey: "" }).length >= 2);
  assert.ok(validateToolArguments("task_sync_apply", "text").length >= 1);
  assert.ok(validateToolArguments("task_sync_apply", [1]).length >= 1);
  assert.ok(validateToolArguments("task_sync_apply", null).length >= 1);
});

test("read-only tools accept {} and reject unknown keys — nothing else", () => {
  for (const name of ["task_sync_plan", "task_sync_status", "task_sync_inventory"]) {
    assert.deepEqual(validateToolArguments(name, {}), []);
    const issues = validateToolArguments(name, { cwd: "/tmp", extra: 2 });
    assert.equal(issues.length, 2, `every unknown key listed for ${name}`);
  }
  assert.ok(validateToolArguments("task_sync_plan", "not-an-object").length === 1);
});

test("validator on an unknown tool name resolves to [] (the unknown posture owns that case)", () => {
  assert.deepEqual(validateToolArguments("task_sync_deploy", { x: 1 }), []);
});

test("definitions carry placeholder identifiers only (no org literals, UUIDs, tokens)", () => {
  const serialized = JSON.stringify(TOOL_DEFINITIONS);
  assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(serialized), "no UUIDs");
  assert.ok(!serialized.includes("LINEAR_API_KEY"), "no real credential env names");
  assert.ok(!serialized.includes("linear.app"), "no real org host literals");
});
