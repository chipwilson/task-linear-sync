/**
 * US1 test support — shared Task/MatchCandidate/PairScore factories and JSON-fixture
 * loading for the 006 suites. Fixtures are read from the SOURCE tree (the compiled
 * build/tests/**.js sits three levels below the repo root, mirroring the 002
 * fixture-loading convention).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { loadConfig } from "task-linear-sync/config";
import type { ResolvedConfig } from "task-linear-sync/config";
import type { IssueRef, RoutingResolution, Task } from "task-linear-sync/domain";
import type { MatchCandidate, PairScore, SignalContribution } from "task-linear-sync/matching";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

/** Read a JSON fixture from `tests/fixtures/...` (source tree). */
export function readJsonFixture<T>(fixtureRelPath: string): T {
  const raw = readFileSync(`${repoRoot}tests/fixtures/${fixtureRelPath}`, "utf8");
  return JSON.parse(raw) as T;
}

/** The frozen built-in defaults (matching slice: medium 50, plausible 18, margin 10). */
export function defaultConfig(): ResolvedConfig {
  return loadConfig({});
}

/** Minimal valid checklist task; identity fields overridable per test. */
export function makeTask(over: Partial<Task> = {}): Task {
  return {
    stableUuid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    kind: "checklist",
    filePath: "specs/demo-feature/tasks.md",
    lineNumber: 10,
    frameworkId: "spec-kit",
    title: "Example task",
    checked: false,
    childUuids: [],
    taskBody: { startLine: 10, endLine: 12 },
    unresolvedConflict: false,
    ...over,
  };
}

export function makeCandidate(over: Partial<MatchCandidate> = {}): MatchCandidate {
  return {
    issueId: "i-0001",
    issueKey: "ENG-1001",
    teamKey: "acme-team",
    projectRef: "proj-alpha",
    title: "Example issue",
    ...over,
  };
}

export function makeRouting(teamKey: string, project: string): RoutingResolution {
  return { teamKey, project, defaulted: false };
}

export function makeRef(number: number): IssueRef {
  return { key: "SYNC", number };
}

/** Pre-gate PairScore factory (bands/assignment unit tests feed these directly). */
export function makePair(
  taskUuid: string,
  issueId: string,
  total: number,
  over: Partial<PairScore> = {},
): PairScore {
  const contributions: readonly SignalContribution[] =
    over.contributions ?? [{ signal: "title-exact", points: total, weight: total }];
  return {
    taskUuid,
    issueId,
    total,
    contributions,
    durableIdentity: false,
    usable: true,
    ...over,
  };
}
