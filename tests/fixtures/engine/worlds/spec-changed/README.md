# spec-changed

Sync-mode world (seed `expected/checkpoint-seed.json`): task 1.1's section body gained a
new paragraph since the last sync while ACME-1's description still equals the checkpoint
baseline ⇒ classification `spec-changed` (FR-002) with built-in sync action
`overwrite-linear` — the screened, rendered section is pushed and a
`description-updated` history event rides along (conflict-resolution-matrix.md §2).
Because only the spec side moved, a `prefer-newer` override is self-attesting (spec
newer, matrix §3 row 1). Task 1.2 is the untouched control (`null`, no-change). Titles
and checkbox states are stable so title/checkbox drift never routes through the
description machinery (FR-006). Placeholders only; fixed clock.
