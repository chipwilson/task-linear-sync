# 007-Local Contracts — Issue-Tracker Integration Port

These documents define **only** the interfaces this feature adds around the FROZEN 002
tracker-port contract. Nothing here redefines or amends 002's surface
(`specs/002-core-domain-contracts/contracts/tracker-port.md`, `src/ports/linear-port.ts`) —
the adapter and fake **conform to** it, and the conformance suite (R9) is what makes that
conformance test-enforced. Amendment rule unchanged: 002 contracts change by amendment only
(ROADMAP rule 2); 007-local contracts change with this feature's own docs + tests.

| Contract | Document | Nature | Consumers |
|---|---|---|---|
| Tracker adapter (port conformance) | [tracker-adapter.md](./tracker-adapter.md) | Behavioral: each frozen `LinearPort` member → platform operation, resilience class, error mapping, factory signature | 006, 008, 009, 011, 013 (indirect, via injection) |
| Resilience & credential posture | [resilience-and-credentials.md](./resilience-and-credentials.md) | Behavioral: constitution Resilience/Credential rules made concrete (classification table, schedule, create guard, pre-flight, sanitizer) | This feature + every integrator relying on "one posture" (constitution V) |
| Tracker testing surface (fake + harness) | [tracker-testing.md](./tracker-testing.md) | Behavioral: the contract-tested fake `LinearPort` and recorded-fixture driver shipped at `task-linear-sync/tracker/testing` | 006, 008, 011 (and Wave-4 surfaces) hermetic tests |

Local types and the port↔platform field mapping: [../data-model.md](../data-model.md);
decisions: [../research.md](../research.md); validation runs: [../quickstart.md](../quickstart.md).

**Package surface added by this feature** (additive — no frozen subpath touched):

```text
task-linear-sync/tracker           → createLinearPort, TrackerClientOptions, TrackerError*,
                                     resolveIssueByTaskIdentity, enumerateAttachmentChain, …
task-linear-sync/tracker/testing   → createFakeLinearPort, createRecordedTransport,
                                     FakeLinearPort (world API), fixture harness helpers
```
