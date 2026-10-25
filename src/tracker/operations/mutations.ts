/**
 * T023 placeholder shell — US2 replaces these internals (T037) with the real mutation
 * operations. Until then every member throws the T010/T011 skip signal (`notImplemented`).
 * Contract rows: tracker-adapter.md 3–6 (create is the ONLY never-retried path).
 */
import type { CreateIssueInput, IssueUpdatePatch, IssueView } from "../../ports/linear-port.js";
import { notImplemented } from "../errors.js";
import type { TrackerContext } from "../internal/request.js";

/** Frozen `LinearPort.getIssue` (replaced by T037). */
export function getIssueImpl(_ctx: TrackerContext, _id: string): Promise<IssueView | null> {
  throw notImplemented("getIssue");
}

/** Frozen `LinearPort.createIssue` (replaced by T037). */
export function createIssueImpl(_ctx: TrackerContext, _input: CreateIssueInput): Promise<IssueView> {
  throw notImplemented("createIssue");
}

/** Frozen `LinearPort.updateIssue` (replaced by T037). */
export function updateIssueImpl(_ctx: TrackerContext, _id: string, _patch: IssueUpdatePatch): Promise<IssueView> {
  throw notImplemented("updateIssue");
}

/** Frozen `LinearPort.archiveIssue` (replaced by T037). */
export function archiveIssueImpl(_ctx: TrackerContext, _id: string): Promise<void> {
  throw notImplemented("archiveIssue");
}
