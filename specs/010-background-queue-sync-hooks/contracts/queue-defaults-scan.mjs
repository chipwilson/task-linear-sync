#!/usr/bin/env node
/**
 * T039 — Queue defaults + precedence scan (spec 010; quickstart §5 refusal rows, SC-003
 * message stability). Run: `node specs/010-background-queue-sync-hooks/contracts/queue-defaults-scan.mjs`
 * — exit 0 means every check passed. Imports ONLY the compiled package (task-linear-sync/*).
 *
 * Checks (tasks T039):
 *  1. Pristine repo: effective defaults 75 / 30 / 5 (queue group) + 300
 *     (`worker.claimTimeoutSeconds` — the FR-003 threshold is the FROZEN key, not a new one).
 *  2. The frozen precedence chain for the queue knobs: defaults < config file < programmatic
 *     overrides, layer-agnostic deep-merge preserving sibling keys. The frozen loader takes
 *     no env layer at all (002 design: env supplies NAME-based credential lookups at use
 *     time), so env-shaped values enter ONLY through the overrides layer — asserted below:
 *     a TASK_LINEAR_SYNC_QUEUE_* env name changes nothing by itself.
 *  3. Two invalid queue values land in the SAME single combined message, byte-stably.
 */
import { loadConfig } from "task-linear-sync/config";
import { resolveQueueConfig } from "task-linear-sync/queue";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const pkgRoot = fileURLToPath(new URL("../../../", import.meta.url));
const failures = [];
const check = async (name, fn) => {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (error) {
    failures.push(name);
    console.log(`FAIL ${name}: ${error.message}`);
  }
};
const assert = (cond, message) => {
  if (!cond) throw new Error(message);
};

/** A pristine harness repo: git metadata + an EMPTY tool config file (nothing layered). */
function makePristineRepo(queueDoc) {
  const root = mkdtempSync(join(tmpdir(), "tls-010-scan-"));
  const repo = join(root, "repo");
  mkdirSync(join(repo, ".git", "hooks"), { recursive: true });
  const configFile = join(repo, "task-linear-sync.json");
  writeFileSync(configFile, JSON.stringify(queueDoc === undefined ? {} : { queue: queueDoc }), "utf8");
  return {
    configFile,
    dispose: () => rmSync(root, { recursive: true, force: true, maxRetries: 3 }),
  };
}

await check("pristine defaults are 75 / 30 / 5 with the frozen worker.claimTimeoutSeconds 300", async () => {
  const h = makePristineRepo();
  try {
    const config = loadConfig({ configFile: h.configFile, overrides: {}, env: {} });
    const result = resolveQueueConfig(config);
    assert(result.ok === true, "pristine config must validate");
    assert(result.settings.workerDelaySeconds === 75, `workerDelaySeconds ${result.settings.workerDelaySeconds} !== 75`);
    assert(result.settings.lockTimeoutSeconds === 30, `lockTimeoutSeconds ${result.settings.lockTimeoutSeconds} !== 30`);
    assert(result.settings.maxRetries === 5, `maxRetries ${result.settings.maxRetries} !== 5`);
    assert(config.worker.claimTimeoutSeconds === 300, `worker.claimTimeoutSeconds ${config.worker.claimTimeoutSeconds} !== 300`);
  } finally {
    h.dispose();
  }
});

await check("frozen precedence: defaults < config file < programmatic overrides (env reaches config only via overrides)", async () => {
  const h = makePristineRepo({ workerDelaySeconds: 100, lockTimeoutSeconds: 45, maxRetries: 7 });
  try {
    const fileLayer = loadConfig({ configFile: h.configFile, overrides: {}, env: {} });
    const fromFile = resolveQueueConfig(fileLayer).settings;
    assert(fromFile.workerDelaySeconds === 100 && fromFile.lockTimeoutSeconds === 45 && fromFile.maxRetries === 7, "file layer must beat the built-in defaults");

    const overridesLayer = loadConfig({ configFile: h.configFile, overrides: { queue: { maxRetries: 2 } }, env: {} });
    const fromOverrides = resolveQueueConfig(overridesLayer).settings;
    assert(fromOverrides.maxRetries === 2, "the overrides layer must beat the file layer");
    assert(fromOverrides.workerDelaySeconds === 100 && fromOverrides.lockTimeoutSeconds === 45, "sibling file keys survive the deep merge");

    const envOnly = loadConfig({
      configFile: h.configFile,
      overrides: {},
      env: { TASK_LINEAR_SYNC_QUEUE_MAX_RETRIES: "9", TASK_LINEAR_SYNC_QUEUE_WORKERDELAYSECONDS: "9" },
    });
    const fromEnvName = resolveQueueConfig(envOnly).settings;
    assert(fromEnvName.maxRetries === 7, "a bare env NAME must not alter resolution (frozen 002 posture: no env layer)");
  } finally {
    h.dispose();
  }
});

await check("two invalid queue values combine into the SAME single message, byte-stably across runs", async () => {
  const h = makePristineRepo({ workerDelaySeconds: 0, maxRetries: 101 });
  try {
    const config = loadConfig({ configFile: h.configFile, overrides: {}, env: {} });
    const first = resolveQueueConfig(config);
    assert(first.ok === false, "invalid values must not validate");
    assert(first.errors.length === 1, `expected ONE combined message, got ${first.errors.length}`);
    assert(first.errors[0].includes("queue.workerDelaySeconds"), first.errors[0]);
    assert(first.errors[0].includes("queue.maxRetries"), first.errors[0]);
    const second = resolveQueueConfig(loadConfig({ configFile: h.configFile, overrides: {}, env: {} }));
    assert(second.errors[0] === first.errors[0], "the combined message must be stable (SC-003)");
    assert(readFileSync(h.configFile, "utf8").includes("workerDelaySeconds"), "fixture sanity");
  } finally {
    h.dispose();
  }
});

if (failures.length > 0) {
  console.log(`queue-defaults-scan: ${failures.length} failing check(s)`);
  process.exit(1);
}
console.log("queue-defaults-scan: all checks passed");
