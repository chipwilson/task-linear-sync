/**
 * T004 — 007 test-helper layer (data-model.md §8, contracts/resilience-and-credentials.md §3,
 * contracts/tracker-testing.md §2). Self-contained so it compiles before `src/tracker` exists:
 * scenario-dir loaders typed to §8, a seeded splitmix rng (deterministic jitter — Principle IV),
 * a FakeSleeper that records waits without wall-clock cost, and a sentinel-env builder for the
 * credential security tier.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export { FakeClock } from "./test-utils.js";

/** Recorded request half of a scenario pair (data-model §8). `variables` are the MATCH PINS. */
export interface RecordedRequest {
  readonly operationName: string;
  readonly variables: Record<string, unknown>;
}

/** Recorded response half. `status: 0` is the corpus convention for a synthetic network error. */
export interface RecordedResponse {
  readonly status: number;
  readonly headers?: Record<string, string>;
  readonly body: unknown;
}

export interface RecordedPair {
  readonly request: RecordedRequest;
  readonly response: RecordedResponse;
}

export interface ScenarioMeta {
  readonly name: string;
  readonly notes?: string;
  readonly placeholderIdentities: readonly string[];
}

/** Fake-world seed shape (data-model §8 world.json program; structurally the FakeWorldSeed twin). */
export interface WorldSeedTeam {
  readonly key: string;
  readonly id: string;
  readonly projects: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  readonly workflowStates: ReadonlyArray<{ readonly id: string; readonly name: string; readonly type: string }>;
}

export interface WorldSeedIssue {
  readonly id: string;
  readonly key: string;
  readonly teamKey: string;
  readonly projectId: string;
  readonly title: string;
  readonly description: string;
  readonly stateType: string;
  readonly updatedAt: string;
  readonly archived?: boolean;
}

export interface WorldSeedAttachment {
  readonly issueId: string;
  readonly id: string;
  readonly url: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly metadata: Record<string, string | number>;
}

export interface WorldSeed {
  readonly teams: readonly WorldSeedTeam[];
  readonly issues: readonly WorldSeedIssue[];
  readonly attachments?: readonly WorldSeedAttachment[];
  readonly scriptedFailures?: Readonly<Record<string, FailureSeed | readonly FailureSeed[]>>;
  readonly pageSize?: number;
  readonly maxRetries?: number;
}

export interface FailureSeed {
  readonly atCall: number;
  readonly kind: "http-429-retryAfter" | "http-5xx" | "network" | "graphql-userError";
  readonly then?: "succeed";
}

function readJson(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, "utf8")) as unknown;
}

/** scenario.json for a scenario directory. */
export function loadScenarioMeta(scenarioDir: string): ScenarioMeta {
  const meta = readJson(join(scenarioDir, "scenario.json")) as ScenarioMeta;
  if (typeof meta.name !== "string" || !Array.isArray(meta.placeholderIdentities)) {
    throw new Error(`fixture miss: '${scenarioDir}/scenario.json' lacks name/placeholderIdentities`);
  }
  return meta;
}

/** Ordered recorded pairs of a scenario directory: every `NN-*.json` file, NN ascending. */
export function loadScenarioPairs(scenarioDir: string): RecordedPair[] {
  const files = readdirSync(scenarioDir)
    .filter((f) => /^\d{2}-.+\.json$/.test(f))
    .sort();
  if (files.length === 0) throw new Error(`fixture miss: no ordered NN-*.json pairs under '${scenarioDir}'`);
  return files.map((f) => {
    const pair = readJson(join(scenarioDir, f)) as RecordedPair;
    if (!pair.request?.operationName || !pair.response || typeof pair.response.status !== "number") {
      throw new Error(`fixture miss: '${join(scenarioDir, f)}' is not a { request, response } pair`);
    }
    return pair;
  });
}

/** Optional world.json fake seed for a scenario directory (undefined when absent). */
export function loadWorld(scenarioDir: string): WorldSeed | undefined {
  const p = join(scenarioDir, "world.json");
  return existsSync(p) ? (readJson(p) as WorldSeed) : undefined;
}

/** Absolute path of a scenario under tests/fixtures/tracker/scenarios/. */
export function scenarioDir(name: string): string {
  return new URL(`file://${pkgRoot()}tests/fixtures/tracker/scenarios/${name}`).pathname;
}

function pkgRoot(): string {
  // build/tests/helpers/tracker-harness.js → repository root (three levels up).
  return new URL("../../../", import.meta.url).pathname;
}

/**
 * Seeded splitmix64 PRNG — deterministic jitter source (Principle IV/VI): identical seed ⇒
 * identical sequence, byte-for-byte, in every environment (no Math.random anywhere).
 */
export function splitmixRng(seed: number): () => number {
  let state = BigInt.asUintN(64, BigInt(Math.trunc(seed)));
  return (): number => {
    state = BigInt.asUintN(64, state + 0x9e3779b97f4a7c15n);
    let z = state;
    z = BigInt.asUintN(64, (z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n);
    z = BigInt.asUintN(64, (z ^ (z >> 27n)) * 0x94d049bb133111ebn);
    z = z ^ (z >> 31n);
    return Number(z >> 11n) / 0x20000000000000; // top 53 bits → [0, 1)
  };
}

/** Records requested waits without wall-clock cost (resilience contract §3 "injected sleep"). */
export class FakeSleeper {
  readonly waits: number[] = [];

  sleep = async (ms: number): Promise<void> => {
    this.waits.push(ms);
  };

  get totalMs(): number {
    return this.waits.reduce((a, b) => a + b, 0);
  }
}

/**
 * Sentinel-env builder for the credential security tier: plants `sentinel` as the value of
 * the configured credential env-var NAMES (frozen config defaults: LINEAR_ACCESS_TOKEN /
 * LINEAR_API_KEY) so a leak is detectable by string search. The sentinel deliberately lacks
 * the personal-key prefix so the (harmless, name-only) prefix diagnostic also fires.
 */
export function sentinelEnv(sentinel: string): Record<string, string | undefined> {
  return { LINEAR_ACCESS_TOKEN: sentinel, LINEAR_API_KEY: sentinel };
}

/** A token value acceptable to the prefix check for non-security scenarios (placeholder). */
export const FIXTURE_TOKEN = "fixture-token-not-a-credential";

/** Env map carrying the benign fixture token (prefix-mismatch diagnostic is non-fatal). */
export function fixtureEnv(): Record<string, string | undefined> {
  return { LINEAR_ACCESS_TOKEN: FIXTURE_TOKEN, LINEAR_API_KEY: FIXTURE_TOKEN };
}
