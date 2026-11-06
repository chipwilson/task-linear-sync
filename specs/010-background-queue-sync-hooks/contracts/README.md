# 010 Contracts

Binding implementation contracts for the background queue feature. Everything
here is additive: no frozen 002 contract, no 009 seam contract, and no 003
scaffold contract changes — 010 implements *into* them.

| Contract | Binds | Covers |
| --- | --- | --- |
| [queue-protocol.md](./queue-protocol.md) | `src/queue/{pending-job,queue-lock,enqueue,spawn,drain,worker,worker-entry,reports,notify}.ts` | state-dir file formats, enqueue fast path, queue lock, claim/reclaim, drain classification + retry, detached worker spawn, marker/notification posture |
| [hook-installation.md](./hook-installation.md) | `src/queue/{git-hooks,agent-hooks}.ts` | managed git-hook block format + splice rules, fired-hook behavior, agent scaffold enrichment + collision policy |
| [queue-surface-implementation.md](./queue-surface-implementation.md) | `src/queue/{index,surface,config,worker-entry}.ts` | how `src/queue` satisfies 009's frozen `QueueSurface` seam (binding, wiring bag, outcome posture, hygiene) |

Inputs consumed unchanged:
[009 queue-surface contract](../../009-operator-cli-plan-report/contracts/queue-surface.md)
·
[002 run-state](../../002-core-domain-contracts/contracts/run-state.md),
[configuration](../../002-core-domain-contracts/contracts/configuration.md),
[engine-gates](../../002-core-domain-contracts/contracts/engine-gates.md)
· 003 `agentHookScaffold` (pure module, `src/discovery/agent-hooks.ts`).
