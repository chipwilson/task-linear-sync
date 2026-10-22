# task-linear-sync

Core domain contracts, configuration model, and run-state lifecycle — the Wave-1
foundation consumed by every later feature (adapters, discovery, matching, sync engine,
CLI, web, MCP surfaces). **Zero runtime dependencies; pure ESM; Node.js ≥ 20.**

This package contains **no tracker transport and no sync engine** — those are later
features that consume the frozen contracts defined here (see
`specs/002-core-domain-contracts/`).

## Install

```sh
npm install task-linear-sync
```

## Usage

```ts
import { loadConfig, validateWorkspaceIdentity } from "task-linear-sync";
import { createStateStore, acquireRunLock, releaseRunLock, systemClock } from "task-linear-sync/state";
import { canonicalAttachmentUrl } from "task-linear-sync/urls";

// Layered config: built-in defaults -> JSON file -> programmatic overrides.
const config = loadConfig({ configFile: "task-linear-sync.json", overrides: { pageSize: 64 } });
validateWorkspaceIdentity(config); // throws MissingIdentityError naming EVERY missing value

// Run state lives OUTSIDE the repository (owner-only, atomic) — see docs/configuration.md.
const store = createStateStore({ repositoryRoot: "/path/to/repo", config, clock: systemClock });
await store.ensure();

const lock = await acquireRunLock(store, "run-1");
if (!lock.acquired) {
  console.error(`another run holds the lock: ${lock.heldBy.runId} (${lock.reason})`);
  process.exit(1);
}
try {
  const url = canonicalAttachmentUrl(config, "5b8f1e2a-3c4d-5e6f-7a8b-9c0d1e2f3a4b");
  // … engine work happens in later features against the frozen contracts …
} finally {
  if (lock.acquired) await releaseRunLock(store, lock.record);
}
```

Subpath exports: `task-linear-sync` (root barrel), `/domain`, `/config`, `/state`,
`/urls`, `/gates`, `/ports`.

## What lives where

| Module group | Contents |
| --- | --- |
| `src/domain` | Frozen contract shapes: Task, TaskFile, Match, routing, SyncStatePayload, Checkpoint, Plan/StoredPlan (+ `derivePlanId`), run records |
| `src/config` | `ResolvedConfig`/`ConfigOverrides`, layered `loadConfig` (three failure categories), `deepMerge`, `canonicalizeConfig`, `validateWorkspaceIdentity` |
| `src/state` | Clock injection, owner-only atomic fs primitives, out-of-repo placement, advisory run lock, AES-256-GCM manifest envelope, create-intent store, reports + last-run marker |
| `src/urls` | Canonical/continuation attachment-URL builders + parser |
| `src/gates` | Gate vocabulary (`GateRequest`, `GateFailureCode`) and `validatePlanReference` |
| `src/ports` | `LinearPort` + `SyncEngine` signatures — types only, implemented by later features |

## Development

```sh
npm ci
npm run build        # dist/ with per-module .d.ts (tests resolve via the exports map)
npm run typecheck    # includes tests/types/*.test-d.ts negative assertions
npm run lint
npm test             # pretest (build + compile tests) -> unit/contract/integration/e2e + coverage gate
```

Tests are hermetic: injected clocks, temp directories, zero network, zero credentials.

## Governance

- The `src/{domain,config,state,urls,gates,ports}` surface is **frozen** (spec FR-008):
  changes require a simultaneous contract-doc + module + snapshot amendment — see
  [`docs/contract-amendments.md`](docs/contract-amendments.md).
- Defaults carry **zero real organization identifiers**; workspace identities are
  consumer-required — see [`docs/configuration.md`](docs/configuration.md).
- Feature docs: `specs/002-core-domain-contracts/` (spec, plan, research, data-model,
  contracts/, quickstart).
