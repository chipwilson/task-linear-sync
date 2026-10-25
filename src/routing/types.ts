/**
 * 005-local routing input view (data-model.md §1). A structural, read-only slice of the
 * frozen `ResolvedConfig` that `resolveRouting` reads — NOT a new configuration concept, and
 * `ProjectByPathEntry` is **imported from the frozen 002 module**, never re-declared
 * (ROADMAP rule 2 / 002 FR-008).
 */
import type { ProjectByPathEntry } from "../domain/routing.js"; // FROZEN 002 — imported, not redefined

/**
 * The subset of `ResolvedConfig` the resolver reads (contracts/routing-resolution.md).
 * `defaultTeamKey`/`defaultProject` of `""` count as absent (001 R17.5) and contribute to
 * the unassigned outcome; 005 adds no validation (workspace identity is 002's `validateWorkspaceIdentity`).
 */
export interface RoutingConfigSlice {
  /** Frozen 002 entry shape; empty/absent ⇒ every task takes the default path (001 R4.5). */
  readonly projectByPath: readonly ProjectByPathEntry[];
  /** `""` = absent (001 R17.5). */
  readonly defaultTeamKey: string;
  /** `""` = absent. */
  readonly defaultProject: string;
}
