/**
 * T021/T024 — `task-linear-sync/tracker/testing` public surface (contracts/tracker-testing.md
 * §4): the fake `Linear_Port` every hermetic tier injects, the recorded-fixture transport that
 * drives the REAL adapter over frozen truth, and the shared scoping guard re-export (identity
 * equal to `task-linear-sync/tracker`'s — belt-and-braces code path shared, never forked).
 * Zero runtime dependencies (constitution budget stays unspent).
 */
export { createFakeLinearPort, syntheticUuid } from "./fake-port.js";
export type {
  FakeAttachmentRecord,
  FakeAttachmentSeed,
  FakeIssueSeed,
  FakeLinearPort,
  FakeRequestLog,
  FakeTeamRecord,
  FakeTeamSeed,
  FakeWorld,
  FakeWorldSeed,
  FailureScript,
} from "./fake-port.js";

export { createRecordedTransport, FixtureMiss } from "./harness.js";
export type { RecordedPair, RecordedRequest, RecordedRequestLog, RecordedResponse, RecordedTransport } from "./harness.js";

// Shared pure guard (re-export, not a copy): `import { issueInScope } from "…/tracker"` and
// this binding MUST be the same function reference.
export { issueInScope, PLATFORM_CONNECTION_MAX, clampPageSize } from "../scoping.js";
