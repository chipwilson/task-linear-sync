/**
 * T023 placeholder shell — US1 replaces these internals (T030) with the real inventory
 * operations over `pagination.ts`. Until then every member throws the T010/T011 skip signal
 * (`notImplemented`), so the parity suite's REAL binding reports these scenarios
 * placeholder-backed while the fake binding already runs them (contract: tracker-adapter.md
 * rows 1–2; the frozen members live in `client.ts`'s assembly).
 */
import type { IssueScope, IssueView, TeamMetadataCollections } from "../../ports/linear-port.js";
import { notImplemented } from "../errors.js";
import type { TrackerContext } from "../internal/request.js";

/** Frozen `LinearPort.listIssues` (replaced by T030). */
export function listIssuesImpl(_ctx: TrackerContext, _scope: IssueScope): AsyncIterableIterator<IssueView> {
  throw notImplemented("listIssues");
}

/** Frozen `LinearPort.discoverMetadata` (replaced by T030). */
export function discoverMetadataImpl(_ctx: TrackerContext, _teamKeys: readonly string[]): Promise<ReadonlyArray<TeamMetadataCollections>> {
  throw notImplemented("discoverMetadata");
}
