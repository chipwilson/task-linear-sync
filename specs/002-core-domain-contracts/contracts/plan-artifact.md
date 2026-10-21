# Contract: Plan Artifact & Review-Report Schema

Modules: `src/domain/plan.ts` + `contracts/plan-report.schema.json`. 002 freezes the shapes
and the `planId`/guard algorithm; 008 builds plans, 009 renders the paired artifacts, 013
consumes the JSON without re-deriving decisions, 012 references plans by `planId`.

## Plan object

```ts
export interface PlanGuards {
  /** sha256 hex per scanned input file, repository-relative POSIX keys. */
  readonly fileHashes: Readonly<Record<string, string>>;
  /** VCS HEAD commit id at plan build; null when HEAD unavailable (001 R1.10 tolerance). */
  readonly headCommit: string | null;
}

export type PlanDecision =
  | "create" | "update" | "no-change" | "conflict" | "skip-unresolved" | "archive";

export interface PlanTaskEntry {           // field set fixed by 009 FR-006 — frozen
  readonly taskUuid: string;
  readonly decision: PlanDecision;
  readonly frameworkId: FrameworkId;
  readonly featureName?: string;
  readonly filePath: string;
  readonly confidence: Confidence;
  readonly score: number;
  readonly margin: number;
  readonly reasons: readonly string[];
  readonly alternatives: readonly MatchAlternative[];   // <= 3
  readonly changedFields: readonly string[];            // e.g. ["title","description","state"]
  readonly descriptionContentHash: string;              // replaces raw body/description
  readonly expectedMarkdownChanges: readonly string[];  // sanitized line-level summaries
  readonly lowConfidenceGateStatus: "passed" | "failed";
  readonly unresolvedConflict?: boolean;                // surfaced as awaiting human markers
  readonly routing?: RoutingResolution;
  readonly match?: Match;
}

export interface UnmappedIssue {
  readonly issueId: string; readonly teamKey: string; readonly project: string;
  readonly title: string;                                 // tracker title is screened
  readonly parentMapped: boolean;                         // descendant-mapping rule (009 FR-007)
}

export interface Plan {
  readonly planId: string;                // sha256 over canonicalized plan JSON (R13)
  readonly generatedAt: string;
  readonly repositoryRoot: string;        // canonical absolute path
  readonly guards: PlanGuards;
  readonly lowConfidencePresent: boolean;
  readonly entries: readonly PlanTaskEntry[];   // deterministic order
  readonly unmappedIssues: readonly UnmappedIssue[];
}

/** Persisted form: plans/<planId>.json in the state directory. */
export interface StoredPlan { readonly plan: Plan; readonly storedAt: string }
```

`planId` = `sha256(canonicalizePlanJson(planWithoutId))` — sorted keys, stable formatting;
re-derivable and drift-detecting (research R13). Plan build performs zero mutations and
zero repo writes (constitution I; 008 SC, asserted at engine level).

## Review-report artifacts (paired, sanitized)

- **JSON**: conforms to [plan-report.schema.json](./plan-report.schema.json) (draft 2020-12;
  `additionalProperties: false` throughout — **structural exclusion**: no field exists whose
  value could carry a raw task body or issue description; only content hashes and screened
  summaries). Carries durable identifiers (taskUuid, issueId, planId).
- **Markdown**: same information grouped project → milestone, separate *Unmapped* section,
  unresolved-conflict tasks surfaced as awaiting human marker resolution, and the
  **security-assertions block**: each read-only and content-exclusion guarantee as a
  discrete pass/fail assertion (009 FR-008). Entities named human-readably.
- Zero-task plan still renders both artifacts with empty sections and passing assertions
  (009 edge case).
- Written only under the state directory (`reports/<runId>/`), never the repo tree
  (run-state.md contract; 009 edge case).

## Test obligations

- Contract test validates 009's generated report fixtures against the JSON Schema (the
  schema is the interchange contract 013 will parse in Wave 4).
- Schema scan test asserts no property named like `body|description|content` (other than
  `*ContentHash` / `expected*` / `description*` under a `Hash`-suffixed name) admits free
  raw-text from task/issue sources; the assertions block shape is fixed.
