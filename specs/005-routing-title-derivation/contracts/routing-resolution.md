# Contract: Routing Resolution

Module: `src/routing/resolve.ts` (+ `src/routing/types.ts`). 005 owns the **algorithm**; the
output type `RoutingResolution` and input entry `ProjectByPathEntry` are **frozen in 002**
(`specs/002-core-domain-contracts/contracts/task-model.md`, `src/domain/routing.ts`) and are
imported here, never redefined. Behavior source: 005 FR-001/FR-002 (001 FR-020/FR-021 →
001 Requirement 4 criteria 1–4); entity rules in [../data-model.md](../data-model.md) §1–2.

```ts
import type { RoutingResolution } from "../domain/routing.js"; // FROZEN 002 — imported, not redefined

/** The subset of ResolvedConfig the resolver reads (005-local view; data-model §1). */
export interface RoutingConfigSlice {
  readonly projectByPath: readonly ProjectByPathEntry[]; // FROZEN 002 entry shape
  readonly defaultTeamKey: string;                        // "" = absent (001 R17.5)
  readonly defaultProject: string;                        // "" = absent
}

/**
 * Resolve a task's file path to a {team, project} destination (005 FR-001/FR-002).
 * Pure: reads only the path + configured map; never consults the tracker.
 */
export function resolveRouting(
  filePath: string,
  config: RoutingConfigSlice,
): RoutingResolution;   // FROZEN 002 return type
```

## Normative behavior (verbatim constraints the implementation MUST honor)

1. **Longest prefix wins** (FR-001 / 001 R4.1): "select the entry whose matching prefix has the
   greatest character length, routing the task to both the selected entry's `Team_Key` and its
   project." Matching is literal `filePath.startsWith(prefix)` over **non-empty** prefixes; no
   path-segment normalization.
2. **Deterministic equal-length tie** (FR-001 / 001 R4.2): "IF two or more configured path prefixes
   match the task's file path with an identical character length, THEN THE System SHALL select the
   **first such entry by the map's defined ordering** and record a deterministic **tie-break
   indication**." → set `tieBreak: "first-by-map-order"` on the result; ties resolved by array index
   in `config.projectByPath`.
3. **Default fallback** (FR-002 / 001 R4.3): "IF no configured path prefix matches … THEN THE
   System SHALL assign the consumer-configured default team and default project." → `defaulted: true`,
   `matchedPrefix`/`tieBreak` absent.
4. **Unassigned, non-fatal** (FR-002 / 001 R4.4): "IF no configured path prefix matches … AND no
   default team and default project are configured, THEN THE System SHALL leave the task's team and
   project unassigned and produce an indication that no team and project could be resolved,
   **without terminating processing of remaining tasks**." → `{ teamKey: "", project: "", defaulted:
   false, unassigned: true }` (research R7); callers continue over the rest of the corpus.
5. **Empty/absent map** (FR-002, edge case): "an absent or empty routing map applies the default
   path to every task" (else every task is unassigned).
6. **No hardcoded routing values** (001 R4.6): the resolver derives `teamKey`/`project`/`prefix`
   **only** from the supplied config; it contains no literal team key, project name, or path prefix.

## Frozen-shape guarantee (contract test)

`resolveRouting` returns a value whose key set is **exactly** `RoutingResolution`'s frozen keys
(`teamKey`, `project`, `matchedPrefix?`, `defaulted`, `tieBreak?`, `unassigned?`) — no extra field,
no widened optionality. 006 imports `RoutingResolution` from `002` and consumes the result without
importing `src/routing` internals (Wave-2 parallel-safety).

## Test obligations (mapped in quickstart)

- Nested prefixes (`specs/`, `specs/api/`, `specs/api/auth/`) → the deepest wins.
- Two equal-length matching prefixes → first-by-`projectByPath`-index + `tieBreak` indication;
  re-run yields the identical selection (SC-001).
- Unmatched path with defaults → defaulted result; **empty** `projectByPath` → default for every path.
- Unmatched path with no defaults → `unassigned: true` and processing continues over the rest of the
  corpus (a fixture with several unrouted tasks all resolve, none abort).
