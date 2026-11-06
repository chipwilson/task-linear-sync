# Contract: History Reconstruction (read side of the 008 history log)

Normative behavior behind `src/history-server/reconstruct.ts` (research R3). Consumes the
frozen 002 payload shapes, the 008 exported `parseHistoryPageRecord`/`historyPageAddress`
(`src/engine/history-page.ts`), and the 007 walk's URL-addressed semantics; mirrors
(read-only)
`specs/008-sync-engine-apply-rollback/contracts/history-log.md` §1/§3 — this contract
NEVER redefines those shapes.

## 1. Chain walk (FR-003)

1. `walk = await walkHistoryChain(port, urlConfig, taskUuid)` — a serving page-walk over
   the injected port with the 007 walk's semantics: sequential probes of the deterministic
   page URLs built by 002's builders (`historyPageAddress`), stopping at the first absent
   index, bounded at 1000 pages (local constant mirroring 007's internal `MAX_CHAIN_PAGES`).
   NO orphan-probe window: a page beyond the first gap is unreachable by the scheme's own
   semantics and is not probed (per-request reads stay minimal; `enumerateAttachmentChain`
   is the diagnostic variant, not the serving one).
2. Canonical probe `null` ⇒ **not-found**: 404 with zero history bytes — this covers
   the deleted/archived-issue edge case (FR-002 "no canonical attachment carries that
   identity").
3. Page payloads are read ONLY from `attachment.metadata[config.metadataNamespaceKey]`
   (string value): page 0 via `parseSyncStatePayload(...).history`; each continuation page
   n ≥ 1 via the 008 `parseHistoryPageRecord(view, nsKey)` (canonical-serialized record
   `{ taskUuid, page, history }`); a `null` return mid-chain is the §1.4 integrity posture.
4. Integrity refusals (502 `TRACKER_UNAVAILABLE`, never a partial or silently-patched
   view): page-record `taskUuid` ≠ routed UUID; page-record `page` ≠ addressed index;
   malformed JSON; non-array `history`; page-0 payload `taskUuid` ≠ routed UUID; malformed
   event entries (missing `kind`/`at`/`description`).

## 2. Merge and presentation (FR-003, SC-001)

1. **Ascending concatenation**: `events = page0.history ++ page1.history ++ … ++ pageN.history`.
2. **Chronological order**: stable sort by `at` (ISO-8601 string compare); ties keep chain
   order. The SC-001 fixture interleaves timestamps across pages, so the sort is asserted,
   not assumed.
3. **Completeness**: every event of every chain page appears EXACTLY ONCE — for the
   10-page × 1000-event corpus this means every page-1000th marker event is present
   exactly once and the full sequence is non-decreasing in `at` (SC-001).
4. **Human-readable timestamps**: `atHuman = YYYY-MM-DD HH:MM:SS UTC` (UTC arithmetic, no
   locale, no `toLocaleString`); the raw ISO `at` stays in the JSON view.
5. **Rollback parity**: a `kind: "rollback"` event is rendered exactly like every other
   kind — same row shape, no special section, no filtering (FR-003; its `references` list
   the reversed opIds like any other reference list).
6. Empty history is VALID (200, `events: []`) — an unbootstrapped-but-anchored task is not
   a 404.

## 3. Cost posture (FR-004/FR-006, spec edge cases)

- Chain-walk cost is cacheable but NEVER cached authoritatively: cache entries are TTL-
  bounded, process-local, and non-authoritative (component-api.md §4); stampede at TTL
  expiry coalesces to one walk per task (single-flight) and defers to the port's
  resilience posture.
- Reads per cold reconstruction: one `getAttachmentByUrl` per probed page (canonical +
  pages 1..N, plus the single first-absent probe that terminates the walk) — the 007 walk
  request profile minus the orphan-probe window;
  ZERO other port members except none (mutation members MUST never be called — call-log
  assertion).

## 4. Screening (FR-008 re-screen mandate)

Every string entering `HistoryEventView` (`description`, `references` items) and every
derived line (`atHuman` is synthetic — still routed through the same pipeline) passes the
injected `SecurityScreener.screen()` at view-build time; HTML rendering additionally
escapes `& < > " '`. A blocked finding propagates the screener's `[blocked:<category>]`
output only. Re-screening is a SECOND pass over already-screened stored data — belt and
braces; it never fails a request (screening output is always returned).
