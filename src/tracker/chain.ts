/**
 * Chain enumeration over ANY `LinearPort` (research R8; data-model.md §6) — the minimum
 * machinery that detects the page-3-missing/page-4-present gap case (FR-006, spec Edge Case).
 * Pure port mechanics: sequential probes of DETERMINISTIC paged URLs built by 002's frozen
 * builders (continuation pages are "addressed purely by URL (scheme contract)" — frozen
 * port wording), so it runs identically against the real adapter, a hand stub, or the fake
 * (type-level negative test T049 proves no fake-only capability is reachable). Identity keys
 * solely off the page-0 canonical URL; the walk stops at the FIRST absent index and orphaned
 * higher pages inside the bounded `orphanProbeLimit` window are REPORTED, never skipped.
 * (T039 adds the identity helpers consumed by 006/008.)
 */
import type { AttachmentView, IssueView, LinearPort } from "../ports/linear-port.js";
import { canonicalAttachmentUrl, continuationAttachmentUrl } from "../urls/attachment-url.js";
import type { AttachmentUrlConfig } from "../urls/attachment-url.js";
import { DEFAULT_ORPHAN_PROBE_LIMIT } from "./options.js";
import { TrackerConfigError } from "./errors.js";

export interface AttachmentChainResult {
  readonly taskUuid: string;
  /** Page 0 — the sole identity anchor (Principle II); null ⇒ pages/orphans are empty. */
  readonly canonical: AttachmentView | null;
  /** Contiguous pages 1..N (empty when N = 0); stops at the first absent index. */
  readonly pages: readonly AttachmentView[];
  /** Page indices > N+1 found present within the bounded probe window — reported, never skipped. */
  readonly orphans: readonly number[];
}

export interface ChainOptions {
  /** Lookahead past the first absent index (default: options-level constant 8). */
  readonly orphanProbeLimit?: number;
}

/** Hard stop against a pathological world where continuation URLs never run out. */
const MAX_CHAIN_PAGES = 1000;

export async function enumerateAttachmentChain(
  port: LinearPort,
  urlConfig: AttachmentUrlConfig,
  taskUuid: string,
  options: ChainOptions = {},
): Promise<AttachmentChainResult> {
  const canonical = await port.getAttachmentByUrl(canonicalAttachmentUrl(urlConfig, taskUuid));
  if (canonical === null) {
    // No anchor ⇒ no chain (validation rule §6): continuation pages are meaningless without page 0.
    return { taskUuid, canonical: null, pages: [], orphans: [] };
  }
  const pages: AttachmentView[] = [];
  for (let page = 1; ; page++) {
    const found = await port.getAttachmentByUrl(continuationAttachmentUrl(urlConfig, taskUuid, page));
    if (found === null) break;
    pages.push(found);
    if (pages.length >= MAX_CHAIN_PAGES) {
      throw new TrackerConfigError(`attachment chain for '${taskUuid}' exceeded ${MAX_CHAIN_PAGES} contiguous pages — inconsistent tracker state`);
    }
  }
  const firstAbsent = pages.length + 1;
  const limit = options.orphanProbeLimit ?? DEFAULT_ORPHAN_PROBE_LIMIT;
  const orphans: number[] = [];
  for (let probe = firstAbsent + 1; probe <= firstAbsent + limit; probe++) {
    if ((await port.getAttachmentByUrl(continuationAttachmentUrl(urlConfig, taskUuid, probe))) !== null) {
      orphans.push(probe);
    }
  }
  return { taskUuid, canonical, pages, orphans };
}

// ── Identity helpers (T039; design §2.5/§2.6) — consumed by 006/008 ───────────────

/**
 * Resolve the issue(s) addressed by a task's page-0 canonical URL (Principle II: the URL IS
 * the identity). `0 carriers ⇒ null`; `≥1 ⇒ ALL carriers` returned — the port never hides a
 * multi-carrier integrity violation (constitution II), deciding on it is the caller's job.
 * Addressed purely by URL: no search, no description content, ever (FR-004).
 */
export async function resolveIssueByTaskIdentity(
  port: Pick<LinearPort, "findIssuesByAttachmentUrl">,
  urlConfig: AttachmentUrlConfig,
  taskUuid: string,
): Promise<readonly IssueView[] | null> {
  const carriers = await port.findIssuesByAttachmentUrl(canonicalAttachmentUrl(urlConfig, taskUuid));
  return carriers.length === 0 ? null : carriers;
}

/** Hard bound on a cursor scan so a pathological connection can never spin the walk. */
const MAX_SCAN_PAGES = 1000;

/**
 * Scan route (FR-004): does this issue's attachment connection carry the task's canonical
 * URL? Walks `listAttachments` opaque cursors until found or exhausted — content is never a
 * filter; only URL equality under the frozen scheme decides.
 */
export async function issueCarriesTaskIdentity(
  port: Pick<LinearPort, "listAttachments">,
  urlConfig: AttachmentUrlConfig,
  issueId: string,
  taskUuid: string,
): Promise<boolean> {
  const target = canonicalAttachmentUrl(urlConfig, taskUuid);
  let cursor: string | null = null;
  let pages = 0;
  for (;;) {
    const page = await port.listAttachments(issueId, cursor);
    if (page.items.some((attachment) => attachment.url === target)) return true;
    if (page.nextCursor === null) return false;
    cursor = page.nextCursor;
    pages += 1;
    if (pages >= MAX_SCAN_PAGES) {
      throw new TrackerConfigError(`identity scan for issue '${issueId}' exceeded ${MAX_SCAN_PAGES} pages — inconsistent tracker state`);
    }
  }
}
