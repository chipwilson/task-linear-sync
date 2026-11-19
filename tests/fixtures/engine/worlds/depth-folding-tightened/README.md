# World: depth-folding-tightened

Feature 020 US3 (rules C7/C8; SC-003). A repository synced earlier at a two-level cap:
local id `1.1` (parent, task line carries the visible `[ACME-7]` reference token) synced
to issue `ACME-7`, and its depth-2 child `1.1.1` synced to issue `ACME-3` (page-0
canonical attachment anchor; matching checkpoint in `expected/checkpoint-seed.json`,
seeded programmatically via `seedCheckpoints`). The config now pins
`maxTaskIssueDepth: 1` — the cap was tightened AFTER the child was synced. A replan at
cap 1 must fold the child line into the parent body, surface `ACME-3` exactly once in the
unmapped-issue section, execute zero archive/delete mutations, and keep the parent's
token-seeded match at high confidence. Scenario: `tests/integration/depth-folding-tightened.test.ts`.
