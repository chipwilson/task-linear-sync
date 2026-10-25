/**
 * T021 — recorded-fixture transport driver (research R9; contracts/tracker-testing.md §2):
 * replays a scenario directory's ordered `NN-*.json` request/response pairs into the REAL
 * adapter, so the real resilience/credential/error stack runs against frozen truth (fake
 * clock/rng/sleeper make it deterministic). Matching is "earliest unconsumed pair whose
 * `operationName` matches and whose recorded `variables` (the MATCH PINS — a subset of keys)
 * equal the request's"; a miss is a loud `FixtureMiss`, never a silent pass. `status: 0` is
 * the corpus convention for a synthetic network error; `Retry-After`/headers replay verbatim.
 *
 * A scenario directory with ZERO pairs (fixture not authored yet) answers every request with
 * the T023 placeholder signal (`notImplemented`) so the parity binding auto-skips exactly as
 * while the operation modules were shells — once pairs exist, matching is strict again.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import type { HttpRequest, HttpResponse, HttpTransport } from "../http.js";
import { notImplemented } from "../errors.js";

export interface RecordedRequest {
  readonly operationName: string;
  readonly variables: Record<string, unknown>;
}

export interface RecordedResponse {
  readonly status: number;
  readonly headers?: Record<string, string>;
  readonly body: unknown;
}

export interface RecordedPair {
  readonly request: RecordedRequest;
  readonly response: RecordedResponse;
}

/** One replayed attempt (every retry consumes its own pair, so counts mirror the real wire). */
export interface RecordedRequestLog {
  readonly operationName: string;
  readonly variables: Record<string, unknown>;
  /** Replayed HTTP status; `0` = synthetic network error; `-1` = notImplemented skip signal. */
  readonly status: number;
}

export interface RecordedTransport extends HttpTransport {
  requests(): readonly RecordedRequestLog[];
}

/** Loud miss: a fixture that no longer reflects the client's requests must fail, not pass. */
export class FixtureMiss extends Error {
  override readonly name = "FixtureMiss";
  constructor(message: string) {
    super(message);
  }
}

function loadPairs(scenarioDir: string): RecordedPair[] {
  const files = readdirSync(scenarioDir)
    .filter((f) => /^\d{2}-.+\.json$/.test(f))
    .sort();
  return files.map((f) => {
    const pair = JSON.parse(readFileSync(join(scenarioDir, f), "utf8")) as RecordedPair;
    if (!pair.request?.operationName || !pair.response || typeof pair.response.status !== "number") {
      throw new FixtureMiss(`'${join(scenarioDir, f)}' is not a { request, response } pair (data-model §8)`);
    }
    return pair;
  });
}

function pinMatch(pin: unknown, value: unknown): boolean {
  return JSON.stringify(pin ?? null) === JSON.stringify(value ?? null);
}

export function createRecordedTransport(scenarioDir: string): RecordedTransport {
  const name = basename(scenarioDir);
  const log: RecordedRequestLog[] = [];
  let pairs: RecordedPair[] | undefined;
  const consumed: boolean[] = [];

  function pairsNow(): RecordedPair[] {
    if (pairs === undefined) {
      if (!existsSync(scenarioDir)) {
        throw new FixtureMiss(`recorded scenario directory '${scenarioDir}' does not exist`);
      }
      pairs = loadPairs(scenarioDir);
    }
    return pairs;
  }

  return {
    async postJson(req: HttpRequest): Promise<HttpResponse> {
      const doc = req.json as { operationName?: unknown; variables?: Record<string, unknown> };
      const operationName = typeof doc.operationName === "string" ? doc.operationName : "";
      const variables = doc.variables ?? {};
      const recorded = pairsNow();
      if (recorded.length === 0) {
        log.push({ operationName, variables, status: -1 });
        throw notImplemented(`recorded-scenario '${name}' (no NN-*.json pairs authored yet)`);
      }
      const index = recorded.findIndex(
        (pair, i) =>
          !consumed[i] &&
          pair.request.operationName === operationName &&
          Object.entries(pair.request.variables).every(([key, pin]) => pinMatch(pin, variables[key])),
      );
      if (index === -1) {
        throw new FixtureMiss(
          `scenario '${name}': no unconsumed recorded request matches '${operationName}' ${JSON.stringify(variables)} ` +
            `(${consumed.filter(Boolean).length}/${recorded.length} pairs consumed)`,
        );
      }
      consumed[index] = true;
      const pair = recorded[index];
      log.push({ operationName, variables, status: pair.response.status });
      if (pair.response.status === 0) {
        // Corpus convention: synthetic network error (classified `network` by the real stack).
        throw new Error(`recorded transport: synthetic network failure for '${operationName}' (${name} pair ${index + 1})`);
      }
      const headers: Record<string, string> = {};
      for (const [key, value] of Object.entries(pair.response.headers ?? {})) {
        headers[key.toLowerCase()] = value;
      }
      return { status: pair.response.status, headers, body: pair.response.body };
    },
    requests: () => [...log],
  };
}
