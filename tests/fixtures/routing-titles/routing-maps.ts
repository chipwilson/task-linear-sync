/**
 * T001 — routing fixture maps (specs/005-routing-title-derivation/contracts/routing-resolution.md
 * § Test obligations; quickstart "US1 — fixtures"). All identities are benign placeholders
 * (`acme-*` teams, `proj-*` projects) — zero real organization identifiers (release-gate scan).
 */
import type { ProjectByPathEntry } from "../../../src/domain/routing.js";
import type { RoutingConfigSlice } from "../../../src/routing/types.js";

/** Nested prefixes — deepest character-length match must win (001 R4.1). */
export const nestedPrefixMap: readonly ProjectByPathEntry[] = [
  { prefix: "specs/", teamKey: "acme-team", project: "proj-alpha" },
  { prefix: "specs/api/", teamKey: "acme-team-b", project: "proj-beta" },
  { prefix: "specs/api/auth/", teamKey: "acme-team", project: "proj-gamma" },
];

/**
 * Equal-length tie — two entries share the SAME (and therefore equal-length) prefix matching
 * the same path; the earlier map entry must win with a recorded tie-break (001 R4.2). The
 * short `specs/` entry is listed FIRST so tests also prove greatest length beats map order.
 */
export const tieMap: readonly ProjectByPathEntry[] = [
  { prefix: "specs/", teamKey: "acme-team-c", project: "proj-gamma" },
  { prefix: "specs/both/", teamKey: "acme-team", project: "proj-alpha" },
  { prefix: "specs/both/", teamKey: "acme-team-b", project: "proj-beta" },
];

/** Nested map, no defaults configured — unmatched paths resolve unassigned (001 R4.4). */
export const nestedSlice: RoutingConfigSlice = {
  projectByPath: nestedPrefixMap,
  defaultTeamKey: "",
  defaultProject: "",
};

/** Tie map with defaults present (defaults must NOT apply when a prefix matches). */
export const tieSlice: RoutingConfigSlice = {
  projectByPath: tieMap,
  defaultTeamKey: "acme-team-default",
  defaultProject: "proj-default",
};

/** Nested map + configured defaults — unmatched paths fall back to the default (001 R4.3). */
export const defaultSlice: RoutingConfigSlice = {
  projectByPath: nestedPrefixMap,
  defaultTeamKey: "acme-team",
  defaultProject: "proj-default",
};

/** Empty map + defaults — the default path applies to EVERY task (001 R4.5). */
export const emptyMapWithDefaults: RoutingConfigSlice = {
  projectByPath: [],
  defaultTeamKey: "acme-team-b",
  defaultProject: "proj-beta",
};

/** Empty map + no defaults — EVERY task is unassigned, processing continues (001 R4.4/R4.5). */
export const emptyMapNoDefaults: RoutingConfigSlice = {
  projectByPath: [],
  defaultTeamKey: "",
  defaultProject: "",
};
