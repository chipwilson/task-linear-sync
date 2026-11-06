# 010 queue fixtures

Fixture ownership per [contracts README](../../../specs/010-background-queue-sync-hooks/contracts/README.md)
— placeholder identifiers only (constitution III), consumed through
`tests/helpers/queue-harness.ts`.

| Directory | Owned by | Contents |
| --- | --- | --- |
| `gitlab-stub/` | US1 spawned-CLI lane (`tests/integration/queue-enqueue-drain.test.ts`) | degraded/offline drive inputs for the REAL built CLI: pre-seeded state trees and expected outcome shapes; never contacts a real tracker (zero-network posture) |
| `fs-storm/` | US2 storm/claim tests (`tests/integration/queue-storm.test.ts`) | expectations for the 100-enqueue coalescing storm and the child-process queue-lock race (SC-001/SC-002): at most one `pending-job.json`, exactly one live claim |
| `hooks/` | US3 hook install/fire tests (`tests/unit/git-hooks.test.ts`, `tests/e2e/queue-hooks-fire.test.ts`) | golden hook files — foreign content, CRLF, shebang-less, occupied-target — pinned byte-for-byte for the splice + fired-hook assertions |

Files land here as stories need them; the directories are reserved up front so
the phases never fight over fixture layout (T002).
