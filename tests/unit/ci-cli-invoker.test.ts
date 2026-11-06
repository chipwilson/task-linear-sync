// <NAMEFILE> tests/unit/ci-cli-invoker.test.ts
//
// T030 [US2] — unit tests for the CLI-invoker seam (research R3;
// wrapper-api.md §2). Fake spawn injected at the seam: argv shape, closed
// command set, NO shell, entry resolution order, 0/8-acceptance, failure
// mapping with screened stderr tails, and env pass-through are all proven
// without touching a real process.

import { strict as assert } from "node:assert";
import { test } from "node:test";

import { CiCliFailureError, createSpawnCliInvoker, type CliInvoker } from "task-linear-sync/ci";

import { makeScreener } from "../helpers/test-utils.js";

interface SpawnCall {
  readonly command: string;
  readonly args: readonly string[];
  readonly options: Record<string, unknown>;
}

interface FakeSpawnOptions {
  readonly exitCode?: number;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly spawnError?: Error;
}

/** Fake `node:child_process.spawn`: records every call, replays scripted IO. */
function fakeSpawn(script: FakeSpawnOptions = {}): { spawn: never; calls: SpawnCall[] } {
  const calls: SpawnCall[] = [];
  const spawn = (command: string, args: readonly string[], options: Record<string, unknown>): unknown => {
    calls.push({ command, args, options });
    const exitCode = script.exitCode ?? 0;
    const stdout = script.stdout ?? "";
    const stderr = script.stderr ?? "";
    return {
      stdout: { on: (_ev: string, cb: (chunk: Buffer) => void) => queueMicrotask(() => cb(Buffer.from(stdout, "utf8"))) },
      stderr: { on: (_ev: string, cb: (chunk: Buffer) => void) => queueMicrotask(() => cb(Buffer.from(stderr, "utf8"))) },
      on: (event: string, cb: (value: never) => void): void => {
        if (event === "error") {
          if (script.spawnError !== undefined) {
            queueMicrotask(() => cb(script.spawnError as never));
          }
        } else if (event === "close") {
          queueMicrotask(() => cb(exitCode as never));
        }
      },
      kill: (): void => undefined,
    };
  };
  return { spawn: spawn as never, calls };
}

const SCR = makeScreener();

function invokerFor(
  script: FakeSpawnOptions,
  extra: Record<string, unknown> = {},
): { invoker: CliInvoker; calls: SpawnCall[] } {
  const { spawn, calls } = fakeSpawn(script);
  const invoker = createSpawnCliInvoker({
    spawn,
    screener: SCR,
    actionRoot: "/action-root",
    exists: (p: string) => p === "/explicit/cli-entry.mjs" || (extra["exists"] as (p: string) => boolean)(p),
  } as never);
  return { invoker, calls };
}

const WS = "/work/ws";

test("ci-invoker: argv is [entry, command, workspace] with no shell and no mutate tokens", async () => {
  const { invoker, calls } = invokerFor({ exitCode: 0 }, { exists: () => false });
  const result = await invoker({ command: "check", workspace: WS, cliEntry: "/explicit/cli-entry.mjs" });
  assert.equal(calls.length, 1);
  const call = calls[0];
  assert.deepEqual(call.args, ["/explicit/cli-entry.mjs", "check", WS]);
  assert.equal(call.options["shell"], undefined, "shell option must not be set");
  assert.equal(Boolean(call.options["shell"]), false, "shell option must not be enabled");
  assert.equal(result.exitCode, 0);
  const joined = call.args.join(" ");
  for (const banned of ["--apply", "--confirm", "bootstrap", "sync", "apply"]) {
    assert.equal(joined.includes(banned), false, `closed command set violated by ${banned}`);
  }
});

test("ci-invoker: configFile appends exactly one --config pair", async () => {
  const { invoker, calls } = invokerFor({ exitCode: 8 }, { exists: () => false });
  const result = await invoker({
    command: "plan",
    workspace: WS,
    cliEntry: "/explicit/cli-entry.mjs",
    configFile: "/work/ws/custom.json",
  });
  assert.deepEqual(calls[0].args, ["/explicit/cli-entry.mjs", "plan", WS, "--config", "/work/ws/custom.json"]);
  assert.equal(result.exitCode, 8, "exit 8 is a findings signal, not a failure");
});

test("ci-invoker: entry resolution follows explicit → action-root → workspace dist → node_modules", async () => {
  const seen: string[] = [];
  const { spawn, calls } = fakeSpawn({ exitCode: 0 });
  const invoker = createSpawnCliInvoker({
    spawn,
    screener: SCR,
    actionRoot: "/action-root",
    exists: (p: string) => {
      seen.push(p);
      return p === "/work/ws/node_modules/task-linear-sync/dist/cli/main.js";
    },
  } as never);
  await invoker({ command: "check", workspace: WS, cliEntry: null });
  assert.deepEqual(seen, [
    "/action-root/dist/cli/main.js",
    "/work/ws/dist/cli/main.js",
    "/work/ws/node_modules/task-linear-sync/dist/cli/main.js",
  ]);
  assert.equal(calls[0].args[0], "/work/ws/node_modules/task-linear-sync/dist/cli/main.js");
});

test("ci-invoker: a resolution miss names EVERY candidate in the failure", async () => {
  const { invoker, calls } = invokerFor({ exitCode: 0 }, { exists: () => false });
  await assert.rejects(
    () => invoker({ command: "check", workspace: WS, cliEntry: null }),
    (error: unknown) => {
      assert.ok(error instanceof CiCliFailureError);
      assert.equal(error.message.includes("/action-root/dist/cli/main.js"), true);
      assert.equal(error.message.includes("/work/ws/dist/cli/main.js"), true);
      assert.equal(
        error.message.includes("/work/ws/node_modules/task-linear-sync/dist/cli/main.js"),
        true,
      );
      return true;
    },
  );
  assert.equal(calls.length, 0, "nothing spawns when no entry resolves");
});

test("ci-invoker: exits 0 and 8 both resolve with captured streams", async () => {
  const zero = invokerFor({ exitCode: 0, stdout: "OUT", stderr: "ERR" }, { exists: () => false });
  const zeroResult = await zero.invoker({ command: "check", workspace: WS, cliEntry: "/explicit/cli-entry.mjs" });
  assert.deepEqual(zeroResult, { exitCode: 0, stdout: "OUT", stderr: "ERR" });

  const eight = invokerFor({ exitCode: 8, stdout: "{}" }, { exists: () => false });
  const eightResult = await eight.invoker({ command: "check", workspace: WS, cliEntry: "/explicit/cli-entry.mjs" });
  assert.equal(eightResult.exitCode, 8);
});

test("ci-invoker: any other exit maps to CiCliFailureError with command, code, screened stderr tail", async () => {
  const { invoker } = invokerFor(
    { exitCode: 5, stderr: `boom ${"x".repeat(300)} SECRET42 tail` },
    { exists: () => false },
  );
  await assert.rejects(
    () => invoker({ command: "plan", workspace: WS, cliEntry: "/explicit/cli-entry.mjs" }),
    (error: unknown) => {
      assert.ok(error instanceof CiCliFailureError);
      assert.equal(error.message.includes("plan"), true);
      assert.equal(error.message.includes("5"), true);
      assert.equal(error.message.includes("SECRET42"), false, "stderr tail must be screened");
      assert.equal(error.message.includes("[REDACTED]"), true);
      return true;
    },
  );
});

test("ci-invoker: a spawn error maps to the same failure class", async () => {
  const { invoker } = invokerFor({ spawnError: new Error("ENOENT entry") }, { exists: () => false });
  await assert.rejects(
    () => invoker({ command: "check", workspace: WS, cliEntry: "/explicit/cli-entry.mjs" }),
    (error: unknown) => {
      assert.ok(error instanceof CiCliFailureError);
      assert.equal(error.message.includes("check"), true);
      return true;
    },
  );
});

test("ci-invoker: request env passes through to the spawn untouched (never logged)", async () => {
  const { invoker, calls } = invokerFor({ exitCode: 0 }, { exists: () => false });
  await invoker({
    command: "check",
    workspace: WS,
    cliEntry: "/explicit/cli-entry.mjs",
    env: { LINEAR_API_KEY: "lin_api_SUPERSECRETvalue", OTHER: "kept" },
  });
  const env = calls[0].options["env"] as Record<string, string | undefined>;
  assert.equal(env["LINEAR_API_KEY"], "lin_api_SUPERSECRETvalue", "credential passes through untouched");
  assert.equal(env["OTHER"], "kept");
  assert.equal(calls[0].args.join(" ").includes("lin_api_SUPERSECRETvalue"), false);
});
