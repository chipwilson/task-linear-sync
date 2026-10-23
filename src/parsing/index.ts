/**
 * Task parsing & in-place line rendering — public surface for `task-linear-sync/parsing`.
 *
 * Wave-2 feature 004: pure functions over file content + the consumer-owned adapter
 * interface (002 data-model § 3 subset). ZERO I/O by construction (constitution I):
 * parsing takes content strings in; rendering returns rewritten content strings out.
 * The gated engine (008) is the only writer.
 *
 * The barrel grows per phase (tasks.md T015 → T023 → T029); the export surface is
 * snapshot-gated by tests/contract/parsing-surface.test.ts.
 */
export {};
