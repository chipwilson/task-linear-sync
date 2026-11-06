/**
 * T004 [P] — FAILING unit tests for the additive `queue` config group (research R2,
 * R3; contracts/queue-surface-implementation.md §2; data-model §4).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { resolveQueueConfig, validateQueueWiring } from "../../src/queue/config.js";
import { makeQueueHarness, type QueueHarness } from "../helpers/queue-harness.js";

async function withHarness(config: Record<string, unknown>, fn: (h: QueueHarness) => Promise<void>): Promise<void> {
  const h = await makeQueueHarness({ config });
  try {
    await fn(h);
  } finally {
    h.dispose();
  }
}

function settingsOf(h: QueueHarness): Record<string, unknown> {
  const r = resolveQueueConfig(h.config);
  if (!r.ok) throw new Error(`unexpected queue-config errors: ${r.errors.join("; ")}`);
  return r.settings as unknown as Record<string, unknown>;
}

test("absent queue group ⇒ full defaults (75/30/5, notifications on, autoAccept off, prefix = binName)", async () => {
  await withHarness({}, async (h) => {
    const s = settingsOf(h);
    assert.equal(s["workerDelaySeconds"], 75);
    assert.equal(s["lockTimeoutSeconds"], 30);
    assert.equal(s["maxRetries"], 5);
    assert.equal(s["notificationsEnabled"], true);
    assert.equal(s["autoAcceptLowConfidence"], false);
    assert.equal(s["hookScriptPrefix"], h.config.binName); // default bin name
    assert.equal(s["hooksDirectory"], undefined);
    assert.equal(s["agentHooksDirectory"], undefined);
  });
});

test("configured queue group values win over defaults", async () => {
  await withHarness(
    {
      queue: {
        workerDelaySeconds: 10,
        lockTimeoutSeconds: 2,
        maxRetries: 3,
        notificationsEnabled: false,
        autoAcceptLowConfidence: true,
        hookScriptPrefix: "tls-wrap",
        hooksDirectory: "/tmp/tls-hooks-override",
      },
    },
    async (h) => {
      const s = settingsOf(h);
      assert.equal(s["workerDelaySeconds"], 10);
      assert.equal(s["lockTimeoutSeconds"], 2);
      assert.equal(s["maxRetries"], 3);
      assert.equal(s["notificationsEnabled"], false);
      assert.equal(s["autoAcceptLowConfidence"], true);
      assert.equal(s["hookScriptPrefix"], "tls-wrap");
      assert.equal(s["hooksDirectory"], "/tmp/tls-hooks-override");
    },
  );
});

test("inclusive bounds accepted: 1..3600 / 1..300 / 1..100 at both ends", async () => {
  await withHarness(
    { queue: { workerDelaySeconds: 1, lockTimeoutSeconds: 300, maxRetries: 100 } },
    async (h) => {
      const s = settingsOf(h);
      assert.equal(s["workerDelaySeconds"], 1);
      assert.equal(s["lockTimeoutSeconds"], 300);
      assert.equal(s["maxRetries"], 100);
    },
  );
  await withHarness(
    { queue: { workerDelaySeconds: 3600, lockTimeoutSeconds: 1, maxRetries: 1 } },
    async (h) => {
      const s = settingsOf(h);
      assert.equal(s["workerDelaySeconds"], 3600);
    },
  );
});

test("out-of-range integers rejected with the dotted key named", async () => {
  for (const [key, bad] of [
    ["workerDelaySeconds", 0],
    ["workerDelaySeconds", 3601],
    ["lockTimeoutSeconds", 0],
    ["lockTimeoutSeconds", 301],
    ["maxRetries", 0],
    ["maxRetries", 101],
    ["workerDelaySeconds", 2.5],
  ] as const) {
    await withHarness({ queue: { [key]: bad } }, async (h) => {
      const r = resolveQueueConfig(h.config);
      assert.equal(r.ok, false, `${key}=${String(bad)} unexpectedly accepted`);
      if (!r.ok) assert.ok(r.errors.some((e) => e.includes(`queue.${key}`)), r.errors.join("; "));
    });
  }
});

test("several invalid keys surface as ONE combined dotted-key message (complete listing)", async () => {
  await withHarness(
    { queue: { workerDelaySeconds: 0, lockTimeoutSeconds: 999, maxRetries: -4, notificationsEnabled: "yes" } },
    async (h) => {
      const r = resolveQueueConfig(h.config);
      assert.equal(r.ok, false);
      if (r.ok) return;
      assert.equal(r.errors.length, 1); // ONE line
      const line = r.errors[0]!;
      assert.match(line, /queue\.workerDelaySeconds/);
      assert.match(line, /queue\.lockTimeoutSeconds/);
      assert.match(line, /queue\.maxRetries/);
      assert.match(line, /queue\.notificationsEnabled/);
      assert.ok(!line.includes("\n"), "combined message must be one line");
    },
  );
});

test("unknown queue.* keys are validation errors (no silent acceptance)", async () => {
  await withHarness({ queue: { bogusKey: true, workerDelaySeconds: 9 } }, async (h) => {
    const r = resolveQueueConfig(h.config);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.errors.join(" "), /queue\.bogusKey/);
  });
});

test("non-integer or wrong-typed booleans refused; hookScriptPrefix must be non-empty", async () => {
  await withHarness({ queue: { hookScriptPrefix: "" } }, async (h) => {
    const r = resolveQueueConfig(h.config);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.errors.join(" "), /queue\.hookScriptPrefix/);
  });
  await withHarness({ queue: { autoAcceptLowConfidence: "false" } }, async (h) => {
    const r = resolveQueueConfig(h.config);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.errors.join(" "), /queue\.autoAcceptLowConfidence/);
  });
});

test("relative hooksDirectory is a validation error (absolute paths only)", async () => {
  await withHarness({ queue: { hooksDirectory: "relative/hooks" } }, async (h) => {
    const r = resolveQueueConfig(h.config);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.errors.join(" "), /queue\.hooksDirectory/);
  });
});

test("resolution never mutates frozen config keys", async () => {
  await withHarness({ queue: { maxRetries: 9 } }, async (h) => {
    const before = JSON.stringify(h.config);
    resolveQueueConfig(h.config);
    assert.equal(JSON.stringify(h.config), before);
    // and the frozen keys are still the frozen defaults
    assert.equal(h.config.worker.claimTimeoutSeconds, 300);
    assert.deepEqual(h.config.managedGitHooks, ["pre-push", "post-merge"]);
  });
});

test("validateQueueWiring: malformed members surface as a QueueRefusal without throwing", () => {
  const bad = validateQueueWiring({ sleep: 42 } as never, "runWorker");
  assert.ok(bad);
  assert.equal(bad.status, "refused");
  assert.match(bad.detail ?? "", /sleep/);

  const badSpawn = validateQueueWiring({ spawnWorker: "nope" } as never, "enqueue");
  assert.ok(badSpawn);
  assert.equal(badSpawn.status, "refused");
  assert.match(badSpawn.detail ?? "", /spawnWorker/);
});

test("validateQueueWiring: absent or well-formed wiring passes every method", () => {
  assert.equal(validateQueueWiring(undefined, "enqueue"), undefined);
  assert.equal(validateQueueWiring({}, "installHooks"), undefined);
  const ok = validateQueueWiring({ clock: { now: () => new Date(), elapsed: () => 0 }, sleep: async () => {} }, "runWorker");
  assert.equal(ok, undefined);
});
