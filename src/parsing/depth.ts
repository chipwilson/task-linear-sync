/**
 * Task-depth fold (feature 020; contracts/depth-folding.md rules C2/C3/C6).
 *
 * Pure module — zero I/O, zero clock, zero randomness (parsing purity, constitution IV).
 * Depth is computed over the FULL draft tree before folding: heading tasks are depth 1;
 * a checklist task is 1 + the depth of its nearest task ancestor, walking EXACTLY the
 * frozen `extract.ts` indent-stack/orphan parent pointers (no new grammar, R2). A draft
 * is folded iff `depth > maxTaskIssueDepth`; because depth strictly increases down a
 * chain, folding a draft folds its whole task-subtree automatically (data-model § 3).
 *
 * Validation (C6) lives at the `parseTaskFile` entry so every lane (CLI, API, worker,
 * MCP, CI action) refuses identically (Principle V); `loadConfig` stays merge-only
 * (pattern precedent: `src/matching/config-check.ts`). Diagnostics name ONLY the key
 * and the offending value — no paths, identifiers, or secrets (data-model § 5).
 */
import type { TaskDraft } from "./extract.js";

/** Smallest legal cap — one issue level per file ("flat board"). */
export const MIN_TASK_DEPTH = 1;
/** Largest legal cap; `64` is the practically-unlimited escape hatch (020 amendment). */
export const MAX_TASK_DEPTH = 64;
/** Built-in default carried by `builtInDefaults` (Maintainer Ruling 2026-11-18). */
export const DEFAULT_TASK_DEPTH_CAP = 1;

/** Why a present value was refused (data-model § 9). */
export type TaskDepthFailureReason = "not-an-integer" | "below-minimum" | "above-maximum";

/** Value rendering for the diagnostic: benign, screenable, never a path or identifier. */
function describeValue(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (value === null || value === undefined || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return Object.prototype.toString.call(value);
  }
}

/**
 * Named lane-entry configuration failure for `maxTaskIssueDepth` (data-model § 5;
 * CLI maps the stable `name` to exit code 3). Mirrors the `ConfigFileError` posture:
 * stable name override, structured fields, sanitized message.
 */
export class TaskDepthConfigError extends Error {
  override readonly name = "TaskDepthConfigError";
  readonly key = "maxTaskIssueDepth" as const;
  readonly value: unknown;
  readonly reason: TaskDepthFailureReason;
  constructor(value: unknown, reason: TaskDepthFailureReason) {
    super(`configuration key 'maxTaskIssueDepth' failed: ${reason} (value: ${describeValue(value)})`);
    this.value = value;
    this.reason = reason;
  }
}

/**
 * Resolve the effective cap at the parsing entry (C6): ABSENT resolves to the built-in
 * default `1` (Principle III — the documented default applies when the consumer does not
 * override); integers 1..64 pass through; everything else refuses with `TaskDepthConfigError`.
 */
export function validateTaskDepthCap(raw: unknown): number {
  if (raw === undefined) return DEFAULT_TASK_DEPTH_CAP;
  if (typeof raw !== "number" || !Number.isInteger(raw)) {
    throw new TaskDepthConfigError(raw, "not-an-integer"); // includes NaN, Infinity, null, strings, objects
  }
  if (raw < MIN_TASK_DEPTH) throw new TaskDepthConfigError(raw, "below-minimum");
  if (raw > MAX_TASK_DEPTH) throw new TaskDepthConfigError(raw, "above-maximum");
  return raw;
}

/**
 * Depth per draft keyed by line number: heading = 1; checklist = 1 + depth(parent).
 * Iterative ancestor walk with memoization (no recursion limit on adversarial nesting).
 */
export function computeDepthByLine(drafts: readonly TaskDraft[]): Map<number, number> {
  const byDraft = new Map<TaskDraft, number>();
  for (const draft of drafts) {
    if (byDraft.has(draft)) continue;
    const chain: TaskDraft[] = [];
    let cursor: TaskDraft | null = draft;
    while (cursor !== null && !byDraft.has(cursor)) {
      chain.push(cursor);
      cursor = cursor.kind === "heading" ? null : cursor.parent;
    }
    // chain[last] sits under a visited ancestor (depth base + 1) or is a heading/root (depth 1).
    let depth = cursor === null ? 1 : (byDraft.get(cursor) as number) + 1;
    for (let i = chain.length - 1; i >= 0; i--) {
      byDraft.set(chain[i] as TaskDraft, depth);
      depth += 1;
    }
  }
  return new Map([...byDraft].map(([d, n]) => [d.lineNumber, n] as const));
}

/** Result of one fold pass over the draft tree. Both lists keep ascending line order. */
export interface DepthFoldResult {
  readonly surviving: TaskDraft[];
  readonly folded: TaskDraft[];
}

/** Partition drafts by `depth > cap` (C3). Folded drafts are always checklist drafts —
 * headings are depth 1 and the cap is at least 1 — and always descendants of a survivor. */
export function foldDraftsOverCap(drafts: readonly TaskDraft[], cap: number): DepthFoldResult {
  const depths = computeDepthByLine(drafts);
  const surviving: TaskDraft[] = [];
  const folded: TaskDraft[] = [];
  for (const draft of drafts) {
    if ((depths.get(draft.lineNumber) as number) > cap) folded.push(draft);
    else surviving.push(draft);
  }
  return { surviving, folded };
}
