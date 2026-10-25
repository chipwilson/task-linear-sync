/**
 * T002 — hand-built `Task` fixtures (005 does NOT depend on 004 at test time) + routing
 * slice factory + the SC-001 path corpus with designed `RoutingResolution` outcomes.
 * Placeholder identities only (`acme-*`, `proj-*`, feature names `user-authentication` /
 * `payments-refund`); zero real organization identifiers.
 */
import type { Task } from "../../../src/domain/task.js";
import type { RoutingResolution } from "../../../src/domain/routing.js";
import type { RoutingConfigSlice } from "../../../src/routing/types.js";
import {
  defaultSlice,
  emptyMapNoDefaults,
  emptyMapWithDefaults,
  nestedSlice,
  tieSlice,
} from "./routing-maps.js";

/** Minimal valid frozen `Task`; every field overridable. `stableUuid` is a benign fixture tag. */
export function makeTask(overrides: Partial<Task> = {}): Task {
  const base: Task = {
    stableUuid: "uuid-fixture-1",
    kind: "heading",
    filePath: "specs/example/spec.md",
    lineNumber: 1,
    frameworkId: "spec-kit",
    title: "Example task",
    childUuids: [],
    taskBody: { startLine: 1, endLine: 2 },
    unresolvedConflict: false,
  };
  return { ...base, ...overrides };
}

/** `RoutingConfigSlice` builder — defaults mirror "no routing configured" (all empty). */
export function makeRoutingSlice(overrides: Partial<RoutingConfigSlice> = {}): RoutingConfigSlice {
  return { projectByPath: [], defaultTeamKey: "", defaultProject: "", ...overrides };
}

/** One SC-001 corpus row: a path, the slice it routes under, and the designed outcome. */
export interface CorpusRow {
  readonly filePath: string;
  readonly slice: RoutingConfigSlice;
  readonly expected: RoutingResolution;
}

/**
 * SC-001 corpus: every path resolves to the designed team/project or a correct
 * unassigned-with-indication; results are identical on every re-run.
 */
export const pathCorpus: readonly CorpusRow[] = [
  // Nested prefixes — deepest wins.
  {
    filePath: "specs/api/auth/login.md",
    slice: nestedSlice,
    expected: {
      teamKey: "acme-team",
      project: "proj-gamma",
      matchedPrefix: "specs/api/auth/",
      defaulted: false,
    },
  },
  {
    filePath: "specs/api/gateway.md",
    slice: nestedSlice,
    expected: {
      teamKey: "acme-team-b",
      project: "proj-beta",
      matchedPrefix: "specs/api/",
      defaulted: false,
    },
  },
  {
    filePath: "specs/overview.md",
    slice: nestedSlice,
    expected: {
      teamKey: "acme-team",
      project: "proj-alpha",
      matchedPrefix: "specs/",
      defaulted: false,
    },
  },
  // Equal-length tie — first-by-map-order among the longest (the short first entry loses on length).
  {
    filePath: "specs/both/tasks.md",
    slice: tieSlice,
    expected: {
      teamKey: "acme-team",
      project: "proj-alpha",
      matchedPrefix: "specs/both/",
      defaulted: false,
      tieBreak: "first-by-map-order",
    },
  },
  // Default fallback for an unmatched path.
  {
    filePath: "docs/other.md",
    slice: defaultSlice,
    expected: { teamKey: "acme-team", project: "proj-default", defaulted: true },
  },
  // Empty map — default applies to every task.
  {
    filePath: "anything/at/all.md",
    slice: emptyMapWithDefaults,
    expected: { teamKey: "acme-team-b", project: "proj-beta", defaulted: true },
  },
  {
    filePath: "src/index.ts",
    slice: emptyMapWithDefaults,
    expected: { teamKey: "acme-team-b", project: "proj-beta", defaulted: true },
  },
  // No match, no defaults — unassigned with indication; remaining tasks keep processing.
  {
    filePath: "nowhere/file.md",
    slice: nestedSlice,
    expected: { teamKey: "", project: "", defaulted: false, unassigned: true },
  },
  {
    filePath: "docs/second.md",
    slice: emptyMapNoDefaults,
    expected: { teamKey: "", project: "", defaulted: false, unassigned: true },
  },
  {
    filePath: "third/unrouted.md",
    slice: emptyMapNoDefaults,
    expected: { teamKey: "", project: "", defaulted: false, unassigned: true },
  },
];
