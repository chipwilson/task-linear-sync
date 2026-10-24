/**
 * Git-style conflict-marker detection and the renderer freeze set (research R7;
 * FR-009 / FR-012). Markers: opening `^<{7,}`, separator `^={7,}(=.*)?$` "inside an open
 * block", closing `^>{7,}`; a complete open→close span is a `ConflictBlock`;
 * "an unterminated opening marker extends the block to EOF (defensive freeze)".
 *
 * The scan is fence-aware: markers inside fenced regions are never blocks (they are
 * documentation examples). Lines strictly inside a block are never parsed into tasks
 * (spec edge case "Conflict block interior edits") and the renderer treats every line of
 * a block span as frozen (byte-for-byte untouched, FR-012). Writing conflict-marker
 * blocks is a 008 behavior — this module ONLY detects.
 */
import type { ContentLine } from "./content.js";

/** A frozen region: [startLine, endLine] inclusive, 1-based (data-model § 4). */
export interface ConflictBlock {
  readonly startLine: number;
  readonly endLine: number;
}

const OPEN_RE = /^<{7,}/u;
const CLOSE_RE = /^>{7,}/u;

/** Ascending, non-overlapping freeze regions for one file's line model. */
export function scanConflictBlocks(lines: readonly ContentLine[]): ConflictBlock[] {
  const blocks: ConflictBlock[] = [];
  let openLine: number | undefined;
  for (const line of lines) {
    if (line.inFence) continue; // fence-aware: fenced markers are documentation, not blocks
    if (openLine === undefined) {
      if (OPEN_RE.test(line.text)) openLine = line.number;
      continue;
    }
    // Inside an open block, git's `^={7,}` separator line is content like any other:
    // only the closing marker terminates the freeze. A block without a separator still
    // freezes (defensive direction — freezing too much can never corrupt bytes).
    // A repeated opening marker keeps the ORIGINAL start, so blocks never overlap.
    if (CLOSE_RE.test(line.text)) {
      blocks.push({ startLine: openLine, endLine: line.number });
      openLine = undefined;
    }
  }
  if (openLine !== undefined) {
    blocks.push({ startLine: openLine, endLine: lines.length }); // defensive freeze to EOF
  }
  return blocks;
}

/** True when the inclusive extent [startLine, endLine] intersects any block (FR-009 flag). */
export function blocksIntersecting(
  startLine: number,
  endLine: number,
  blocks: readonly ConflictBlock[],
): boolean {
  return blocks.some((b) => startLine <= b.endLine && endLine >= b.startLine);
}

/** Every line number inside any block span — the renderer's freeze set (FR-012/FR-013). */
export function frozenLineSet(blocks: readonly ConflictBlock[]): ReadonlySet<number> {
  const frozen = new Set<number>();
  for (const b of blocks) {
    for (let n = b.startLine; n <= b.endLine; n++) frozen.add(n);
  }
  return frozen;
}
