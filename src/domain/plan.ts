/**
 * Plan artifact shapes + canonical serialization + planId derivation (frozen — 008 builds,
 * 002 owns the shape and the planId/guard algorithm, research R13).
 * Mirror: contracts/plan-artifact.md, data-model.md §9.
 */
import { createHash } from "node:crypto";

import type { FrameworkId } from "./task.js";
import type { Confidence, Match, MatchAlternative } from "./match.js";
import type { RoutingResolution } from "./routing.js";

/** Deterministic canonical JSON: sorted keys, stable scalar formatting, compact. */
export function canonicalJson(value: unknown): string {
  const sorted = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sorted);
    if (v !== null && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(v as Record<string, unknown>).sort()) {
        const value = (v as Record<string, unknown>)[key];
        if (value !== undefined) out[key] = sorted(value);
      }
      return out;
    }
    return v;
  };
  return JSON.stringify(sorted(value));
}

export interface PlanGuards {
  /** sha256 hex per scanned input file, repository-relative POSIX keys. */
  readonly fileHashes: Readonly<Record<string, string>>;
  /** VCS HEAD commit id at plan build; null when HEAD unavailable (001 R1.10 tolerance). */
  readonly headCommit: string | null;
}

export type PlanDecision =
  | "create"
  | "update"
  | "no-change"
  | "conflict"
  | "skip-unresolved"
  | "archive";

/**
 * Field set fixed by 009 FR-006 — frozen.
 * NO raw task body or issue description field exists in the shape (structural exclusion;
 * contracts/plan-report.schema.json). Content appears only as hashes and screened summaries.
 */
export interface PlanTaskEntry {
  readonly taskUuid: string;
  readonly decision: PlanDecision;
  readonly frameworkId: FrameworkId;
  readonly featureName?: string;
  readonly filePath: string;
  readonly confidence: Confidence;
  readonly score: number;
  readonly margin: number;
  readonly reasons: readonly string[];
  /** <= 3, descending score, deterministic tie-break. */
  readonly alternatives: readonly MatchAlternative[];
  /** e.g. ["title","description","state"]. */
  readonly changedFields: readonly string[];
  /** Replaces raw body/description. */
  readonly descriptionContentHash: string;
  /** Sanitized line-level summaries. */
  readonly expectedMarkdownChanges: readonly string[];
  readonly lowConfidenceGateStatus: "passed" | "failed";
  /** Surfaced as awaiting human markers. */
  readonly unresolvedConflict?: boolean;
  readonly routing?: RoutingResolution;
  readonly match?: Match;
}

export interface UnmappedIssue {
  readonly issueId: string;
  readonly teamKey: string;
  readonly project: string;
  /** Tracker title is screened. */
  readonly title: string;
  /** Descendant-mapping rule (009 FR-007). */
  readonly parentMapped: boolean;
}

/** Plan build performs zero mutations and zero repo writes (constitution I; 008 SC). */
export interface Plan {
  /** sha256 over canonicalized plan JSON (R13); doubles as the Plan_Reference value. */
  readonly planId: string;
  /** ISO-8601, injected clock. */
  readonly generatedAt: string;
  /** Canonical absolute path. */
  readonly repositoryRoot: string;
  readonly guards: PlanGuards;
  /** Drives the accept-low-confidence gate. */
  readonly lowConfidencePresent: boolean;
  /** Deterministic order. */
  readonly entries: readonly PlanTaskEntry[];
  /** Separate section in reports. */
  readonly unmappedIssues: readonly UnmappedIssue[];
}

/** Persisted form: plans/<planId>.json in the state directory. */
export interface StoredPlan {
  readonly plan: Plan;
  /** ISO-8601, injected clock. */
  readonly storedAt: string;
}

/** Canonical serialization used for planId: sorted keys, stable formatting (R13). */
export function canonicalizePlanJson(planWithoutId: Omit<Plan, "planId">): string {
  return canonicalJson(planWithoutId);
}

/** planId = sha256(canonicalizePlanJson(planWithoutId)) — re-derivable and drift-detecting. */
export function derivePlanId(planWithoutId: Omit<Plan, "planId">): string {
  return createHash("sha256").update(canonicalizePlanJson(planWithoutId), "utf8").digest("hex");
}
