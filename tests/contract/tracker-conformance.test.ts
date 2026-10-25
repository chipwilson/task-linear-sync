/**
 * T011 [P] — parity binding runner (contracts/tracker-testing.md §3): runs T010's conformance
 * suite against BOTH bindings — `createFakeLinearPort()` and the real adapter over
 * `createRecordedTransport(...)` with injected fake clock/rng/sleeper — asserting identical
 * results per scenario ("one suite, two bindings"). The real binding auto-skips
 * placeholder-backed scenarios (skip legitimacy is verified against the port's members), so
 * incremental story work requires NO edits to this file: scenarios flip from skip to run
 * automatically as the operation modules land.
 */
import { builtInDefaults } from "task-linear-sync/config";
import { createLinearPort } from "task-linear-sync/tracker";
import { createFakeLinearPort, createRecordedTransport } from "task-linear-sync/tracker/testing";

import {
  linearPortConformance,
  registerParityAssertion,
  type ConformanceBinding,
  type ConformanceHandle,
} from "./tracker-conformance.suite.js";
import { FakeClock, FakeSleeper, fixtureEnv, loadWorld, scenarioDir, splitmixRng } from "../helpers/tracker-harness.js";

/**
 * config.pageSize 2 aligns `listAttachments` page size with the seeded worlds' pageSize so
 * cursor paging exercises multiple pages on BOTH bindings (frozen listIssues scopes pin
 * their own pageSize per scenario).
 */
const config = { ...builtInDefaults, pageSize: 2 };

function pinMatches(vars: Record<string, unknown>, pin?: Record<string, unknown>): boolean {
  if (!pin) return true;
  return Object.entries(pin).every(([k, v]) => JSON.stringify(vars[k] ?? null) === JSON.stringify(v ?? null));
}

const fakeBinding: ConformanceBinding = {
  name: "fake",
  makePort(dir: string): ConformanceHandle {
    const port = createFakeLinearPort(loadWorld(dir));
    return {
      port,
      successful: (op, pin) => port.requests().filter((r) => r.op === op && r.ok && pinMatches(r.vars, pin)).length,
      total: (op, pin) => port.requests().filter((r) => r.op === op && pinMatches(r.vars, pin)).length,
    };
  },
};

const realBinding: ConformanceBinding = {
  name: "real-over-recorded",
  makePort(dir: string): ConformanceHandle {
    const transport = createRecordedTransport(scenarioDir(dir));
    const sleeper = new FakeSleeper();
    const port = createLinearPort({
      config,
      options: {
        transport,
        env: fixtureEnv(),
        clock: new FakeClock("2026-10-23T12:00:00.000Z"),
        rng: splitmixRng(9),
        sleep: sleeper.sleep,
      },
    });
    return {
      port,
      successful: (op, pin) =>
        transport.requests().filter((r) => r.operationName === op && r.status > 0 && r.status < 400 && pinMatches(r.variables, pin)).length,
      total: (op, pin) => transport.requests().filter((r) => r.operationName === op && pinMatches(r.variables, pin)).length,
    };
  },
};

linearPortConformance(fakeBinding.name, fakeBinding);
linearPortConformance(realBinding.name, realBinding);
registerParityAssertion();
