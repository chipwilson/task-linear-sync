/**
 * T018 — FAILING unit tests for best-effort notifications (spec 010, FR-020/FR-021,
 * research R11). Modules under test: `src/queue/notify.ts` — createNotifier (production
 * Notifier over the harness notify({title, body}) seam), buildNotificationContent and
 * maybeNotify (suppression short-circuit). Delivery must never throw.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildNotificationContent, createNotifier, maybeNotify } from "../../src/queue/notify.js";

interface SpawnCall {
  program: string;
  args: readonly string[];
}

type SpawnFn = (program: string, args: readonly string[]) => Promise<{ code: number }>;

function notifier(deps: {
  env?: Record<string, string | undefined>;
  which?: (tool: string) => string | null;
  platform?: NodeJS.Platform;
  spawn?: SpawnFn;
}) {
  return createNotifier({ env: {}, which: () => null, platform: "linux", spawn: async () => ({ code: 0 }), ...deps });
}

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "tls-notify-"));
}

test("buildNotificationContent: title is '<toolId> sync <outcome>', body carries the detail", () => {
  const content = buildNotificationContent({ outcome: "completed", detail: "applied 2 changes" });
  assert.equal(content.title, "task-linear-sync sync completed");
  assert.equal(content.body, "applied 2 changes");

  const failed = buildNotificationContent({ toolId: "mytool", outcome: "failed", detail: "apply error" });
  assert.equal(failed.title, "mytool sync failed");
});

test("buildNotificationContent: bodies are length-capped so helper arguments stay sane", () => {
  const content = buildNotificationContent({ outcome: "completed", detail: "x".repeat(5000) });
  assert.ok(content.body.length <= 300, `body length ${content.body.length}`);
});

test("maybeNotify: disabled setting or a suppressed marker performs no attempt", async () => {
  let calls = 0;
  const fake = {
    async notify() {
      calls += 1;
      return "delivered" as const;
    },
  };
  const content = buildNotificationContent({ outcome: "completed", detail: "ok" });

  assert.equal(await maybeNotify(fake, { enabled: false, content }), "suppressed");
  assert.equal(await maybeNotify(fake, { suppressed: true, content }), "suppressed");
  assert.equal(calls, 0, "the notifier is never reached when suppression applies");

  assert.equal(await maybeNotify(fake, { enabled: true, content }), "delivered");
  assert.equal(calls, 1);
});

test("notify: the injected test-file sink captures title and body", async () => {
  const dir = await tempDir();
  try {
    const sink = join(dir, "sink.ndjson");
    const n = notifier({ env: { TASK_LINEAR_SYNC_TEST_NOTIFY: sink } });
    assert.equal(await n.notify({ title: "task-linear-sync sync completed", body: "applied 2 changes" }), "delivered");
    const text = await readFile(sink, "utf8");
    assert.match(text, /task-linear-sync sync completed/);
    assert.match(text, /applied 2 changes/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("notify: a failing sink is undeliverable, never a throw", async () => {
  const n = notifier({ env: { TASK_LINEAR_SYNC_TEST_NOTIFY: "/proc/definitely-not-writable/sink.ndjson" } });
  assert.equal(await n.notify({ title: "t", body: "b" }), "undeliverable");
});

test("notify: macOS selects osascript with title and body in the arguments", async () => {
  const calls: SpawnCall[] = [];
  const n = notifier({
    platform: "darwin",
    which: (p) => (p === "osascript" ? "/usr/bin/osascript" : null),
    spawn: async (p, a) => {
      calls.push({ program: p, args: a });
      return { code: 0 };
    },
  });
  assert.equal(await n.notify({ title: "task-linear-sync sync failed", body: "sync failed: apply error" }), "delivered");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.program, "osascript");
  assert.ok(calls[0]!.args.some((a) => a.includes("task-linear-sync sync failed")));
  assert.ok(calls[0]!.args.some((a) => a.includes("sync failed: apply error")));
});

test("notify: Linux selects notify-send, Windows selects powershell", async () => {
  const calls: SpawnCall[] = [];
  const spawn = async (p: string, a: readonly string[]) => {
    calls.push({ program: p, args: a });
    return { code: 0 };
  };
  await notifier({
    platform: "linux",
    which: (p) => (p === "notify-send" ? "/usr/bin/notify-send" : null),
    spawn,
  }).notify({ title: "t", body: "b" });
  assert.equal(calls[0]!.program, "notify-send");

  await notifier({
    platform: "win32",
    which: (p) => (p === "powershell" ? "powershell.exe" : null),
    spawn,
  }).notify({ title: "t", body: "b" });
  assert.equal(calls[1]!.program, "powershell");
});

test("notify: no helper on PATH is undeliverable and never throws", async () => {
  const n = notifier({ which: () => null, platform: "linux" });
  assert.equal(await n.notify({ title: "t", body: "b" }), "undeliverable");
});

test("notify: a non-zero helper exit or a spawn rejection is still only undeliverable", async () => {
  const nonZero = notifier({ which: () => "/usr/bin/notify-send", spawn: async () => ({ code: 1 }) });
  assert.equal(await nonZero.notify({ title: "t", body: "b" }), "undeliverable");

  const exploding = notifier({
    which: () => "/usr/bin/notify-send",
    spawn: async () => {
      throw new Error("spawn blew up");
    },
  });
  assert.equal(await exploding.notify({ title: "t", body: "b" }), "undeliverable");
});
