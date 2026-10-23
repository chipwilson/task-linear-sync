/**
 * Duplicate-identity warnings (FR-007; research R11; parsing-api rule 7).
 *
 * "System MUST warn, identifying the shared value and all 1-based line numbers, when
 * tasks within one file share a local task ID or share an issue reference." Warnings are
 * additive — extraction still succeeds. Construction is deterministic (Principle IV):
 * scan-order accumulation, kind in vocabulary order, then shared value ascending, line
 * numbers ascending. Exclusions cannot own identities, so only extracted tasks pool.
 */

export interface ParseWarning {
  readonly kind: "duplicate-local-id" | "duplicate-issue-ref";
  readonly value: string;
  readonly lineNumbers: readonly number[];
}

/** Minimal structural input (works on drafts and finalized tasks alike). */
interface IdentityCarrier {
  readonly lineNumber: number;
  readonly localTaskId?: string;
  readonly issueRef?: { key: string; number: number };
}

const KIND_ORDER: readonly ParseWarning["kind"][] = ["duplicate-local-id", "duplicate-issue-ref"];

function bucketFor(buckets: Map<ParseWarning["kind"], Map<string, number[]>>, kind: ParseWarning["kind"]): Map<string, number[]> {
  const existing = buckets.get(kind);
  if (existing) return existing;
  const created = new Map<string, number[]>();
  buckets.set(kind, created);
  return created;
}

export function collectDuplicateWarnings(tasks: readonly IdentityCarrier[]): ParseWarning[] {
  const buckets = new Map<ParseWarning["kind"], Map<string, number[]>>();

  for (const task of tasks) {
    if (task.localTaskId !== undefined) {
      const lines = bucketFor(buckets, "duplicate-local-id");
      const list = lines.get(task.localTaskId);
      if (list) list.push(task.lineNumber);
      else lines.set(task.localTaskId, [task.lineNumber]);
    }
    if (task.issueRef !== undefined) {
      const value = `${task.issueRef.key}-${task.issueRef.number}`; // "KEY-N rendering" (data-model § 3)
      const lines = bucketFor(buckets, "duplicate-issue-ref");
      const list = lines.get(value);
      if (list) list.push(task.lineNumber);
      else lines.set(value, [task.lineNumber]);
    }
  }

  const warnings: ParseWarning[] = [];
  for (const kind of KIND_ORDER) {
    const bucket = bucketFor(buckets, kind);
    for (const value of [...bucket.keys()].sort()) {
      const lineNumbers = bucket.get(value);
      if (lineNumbers && lineNumbers.length > 1) {
        warnings.push({ kind, value, lineNumbers: [...lineNumbers].sort((a, b) => a - b) });
      }
    }
  }
  return warnings;
}
