# History-server fixtures (feature 011)

Synthetic worlds for `tests/{unit,integration,e2e}/history-*.test.ts`.

Conventions (distributed-defaults posture, contracts/component-api.md §3.7):

- Placeholder identifiers only — `Placeholder-Team-Alpha`, `PHA-1`,
  `Placeholder story — history fixture`, `sync.example.invalid` (the built-in
  default placeholder host). Zero real organization identifiers, team keys,
  tokens, or credential-shaped literals anywhere below this directory.
- Synthetic UUIDs only, produced by `syntheticUuid(index)` from
  `task-linear-sync/tracker/testing` (`ac000000-0000-4000-8000-<index>`).
- The metadata namespace key is derived from `builtInDefaults` at runtime by
  `tests/helpers/history-harness.ts` — never hardcoded here.
- Worlds whose payload is too large to hand-edit (the 10 × 1000-event chain)
  are generated in-process by the harness builder; the world directory holds
  this README plus the exact seed parameters.

| World dir (under `worlds/`) | Scenario |
| --------------------------- | -------- |
| `ten-page-chain/`        | 10 × 1000-event chain across 10 attachments, interleaved timestamps (SC-001) |
| `gap-stops-walk/`        | referenced page 2 absent (page 3 present) → walk stops at last good page |
| `integrity-mismatch/`    | continuation record contradicts its addressed URL → 502 integrity posture |
| `no-canonical/`          | no canonical state attachment → 404, zero history bytes |
| `secret-shape/`          | events carrying secret-shaped values → `[blocked:…]` sentinels only |
| `rate-limit-exhaustion/` | scripted `429`-with-`Retry-After` exhaustion → 429, zero history bytes |
