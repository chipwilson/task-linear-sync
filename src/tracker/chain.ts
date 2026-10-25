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
import type { AttachmentView, LinearPort } from "../ports/linear-port.js";
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
