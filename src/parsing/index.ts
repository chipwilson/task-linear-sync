/**
 * Task parsing & in-place line rendering — public surface for `task-linear-sync/parsing`.
 *
 * Wave-2 feature 004: pure functions over file content + the consumer-owned adapter
 * interface (002 data-model § 3 subset). ZERO I/O by construction (constitution I):
 * parsing takes content strings in; rendering returns rewritten content strings out.
 * The gated engine (008) is the only writer.
 *
 * The export surface is snapshot-gated by tests/contract/parsing-surface.test.ts;
 * the import boundary by tests/contract/parsing-purity.test.ts.
 */

// ── Adapter-consumption boundary (research R1; contracts/adapter-consumption.md) ──
export type { TaskFileAdapter } from "./adapter.js";

// ── Content model (research R4): shared by parsing AND rendering ──────────────────
export type { ContentLine } from "./content.js";
export { splitLines, lineIsFenced } from "./content.js";

// ── Stable_UUID computation (002 R11: "004 computes, 002 freezes") ─────────────────
export { deriveStableUuid } from "./identity.js";

// ── Conflict-marker detection + renderer freeze set (research R7) ──────────────────
export type { ConflictBlock } from "./conflict.js";
export { scanConflictBlocks, blocksIntersecting, frozenLineSet } from "./conflict.js";
