# Feature Specification: Sync-History Web Component

**Feature Branch**: `011-sync-history-web-page`

**Created**: 2026-10-21

**Status**: Draft

**Input**: Decomposition of `specs/001-extract-functional-requirements/spec.md` (clarification session 2026-10-21). Absorbs 001 group P (Sync-history web component, source R20–R24).

## Purpose and Scope

An optional, stateless web component serving exactly the URL scheme the sync engine
records on each issue's attachment, so anyone with access opens a task's complete,
ordered, screened sync history live from the tracker. Wave-4 feature and the strongest
parallel-development candidate in the set: it depends only on the frozen 002 contracts
(attachment URL scheme, history event shape) and the 007 read operations — never on the
engine's internals, local state, or encryption keys.

**Owns**: URL-template routing and 404 rules; live chain reconstruction; tiered
real-time transport with polling fallback; optional server-safe caching; private-by-
default access control with server-side-only token.

**Consumes from 002**: attachment URL scheme; Sync History Event shape; screening
mandate. **Consumes from 007**: attachment query and chain enumeration as read
operations.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Open the recorded URL, see the whole story (Priority: P1)

A reader or auditor opens the address recorded on the issue's attachment; the page shows
the task's complete sync history reconstructed from the canonical attachment page and
all continuation pages, chronological, with human-readable timestamps, refreshed
near-realtime where the host supports push and by periodic refresh otherwise — with no
separate history datastore anywhere.

**Why this priority**: This is the entire feature: a history view that lies (misses
pages, drifts from the tracker) is worse than no view.

**Independent Test**: Serve a task UUID whose history spans multiple attachment pages;
verify chronological rendering across the full chain, not-found responses for malformed
paths or unknown UUIDs, and graceful fallback from push updates to periodic refresh.

**Acceptance Scenarios**:

1. **Given** a request path matching the configured URL template with a well-formed
   task identifier, **When** the page renders, **Then** the full history is
   reconstructed from the canonical attachment page and all continuation pages (pages
   concatenated ascending) and shown chronologically with human-readable timestamps and
   descriptions, rollback events rendered like any other.
2. **Given** a path that mismatches the template, the tool identifier segment, or the
   UUID shape, **When** requested, **Then** a not-found response is returned with no
   history data.
3. **Given** an open history page, **When** new events land in the tracker, **Then** the
   page updates near-realtime where the host supports long-lived push and otherwise
   falls back to periodic refresh (configurable interval, default 15 s, range 1–3600 s),
   refreshing server-side on that cadence.

### User Story 2 - Private by default, portable everywhere (Priority: P2)

Access defaults to private (valid credential or 401/403 with zero history leakage);
public read-by-URL is an explicit opt-in; server-side caching is optional with a TTL;
no filesystem, database, or long-lived in-process state is required, so the component
runs on serverless, edge, and shared hosts.

**Why this priority**: The history is screened but still sensitive operational detail;
deployment portability is what keeps the feature optional and cheap to run.

**Independent Test**: Exercise both access modes with missing/invalid/valid
credentials; assert leak-free refusals; toggle cache TTL and verify cache-then-reread
behavior; run the component with caching, filesystem writes, and databases all disabled
and confirm full function on a serverless-shaped host fixture.

**Acceptance Scenarios**:

1. **Given** access mode `private` (the default), **When** a request presents no or an
   invalid credential, **Then** an unauthorized/forbidden response reveals no history
   data; in `public` mode, valid requests need no credential.
2. **Given** server-side caching enabled with TTL (default 10 s, range 0–3600 s; 0
   disables), **When** requests arrive within the TTL, **Then** the cached reconstructed
   history serves, and after expiry the attachment chain re-reads.
3. **Given** the component's dependencies, **When** it deploys, **Then** it requires no
   local audit manifest, state directory, checkpoints, or manifest encryption key, reads
   none of them, and maintains no separate authoritative history datastore (an optional
   non-authoritative cache only).
4. **Given** a tracker read that ultimately fails under rate limits, **When** the page
   responds, **Then** the error names no credential and reveals no history data.

## Requirements *(mandatory)*

- **FR-001** (001 FR-082): The web component MUST serve routes matching the same
  configured URL template the sync engine records on attachments
  (`<base-host>/<toolId>/<task-uuid>`), deriving host, tool segment, and template solely
  from that configuration, parsing each request path against the template to extract the
  tool segment and task UUID.
- **FR-002** (001 FR-083): The web component MUST respond with a not-found status and no
  history data when the path mismatches the template, the tool segment mismatches the
  configured tool identity, the task identifier is not a well-formed UUID, or no
  canonical attachment carries that identity.
- **FR-003** (001 FR-084): The web component MUST resolve history live per request by
  reading the state payload from the canonical attachment's metadata via the tracker and
  walking the deterministic continuation pages upward until none remain, concatenating
  pages in ascending order, and presenting every event chronologically with a
  human-readable timestamp and description (rollback events rendered like any other).
- **FR-004** (001 FR-085): The web component MUST NOT read the local audit manifest,
  state directory, or checkpoints, MUST NOT require the manifest encryption key, and MUST
  NOT maintain a separate authoritative history datastore (an optional non-authoritative
  cache only).
- **FR-005** (001 FR-086): The web component MUST deliver near-realtime updates with a
  tiered transport that prefers push-based streaming where the host supports long-lived
  responses and MUST always offer periodic refresh as a fallback (configurable interval,
  default 15 s, range 1–3600 s), refreshing server-side on that cadence.
- **FR-006** (001 FR-087): Where server-side caching is enabled, the web component MUST
  serve the cached reconstructed history for a task identifier until the configured TTL
  (default 10 s, range 0–3600 s; 0 disables) elapses, then re-read the attachment chain;
  caching, filesystem writes, databases, and long-lived in-process state MUST all be
  optional so the component runs on serverless, edge, and shared-host environments.
- **FR-007** (001 FR-088): The web component MUST respect tracker rate limits using the
  constitution-mandated resilience behavior and MUST respond with an error that names no
  credential and reveals no history data when the tracker read ultimately fails.
- **FR-008** (001 FR-089): The web component MUST default to private access (valid token
  or session required; missing/invalid credentials yield unauthorized/forbidden with no
  history data) with public read-by-URL access as an explicit opt-in, reading the access
  token server-side only, and MUST expose to browsers only security-screened,
  human-readable history data (re-screening rendered values per the constitution's
  screening mandate).

### Edge Cases

- **History volume** (001 edge case, read side): tasks whose history spans many
  continuation pages must render fully; chain-walk cost is cacheable but never cached
  authoritatively.
- **Deleted/archived issue**: canonical attachment unreachable → not-found with no
  history data.
- **Cache stampede at TTL expiry**: constitution resilience rules govern tracker
  re-reads; the component never serves stale data as authoritative.

## Key Entities

**Sync-History Page** (owned): public/private web view of one task's complete
chronological history, addressed by the recorded attachment URL scheme. **Sync History
Event** and **Attachment Chain** read per 002/007 contracts.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001** (001 SC-010): A sync-history page displays the complete event history for
  tasks whose history spans up to 10 attachment pages, with events in exact
  chronological order and every page-1000th event present exactly once.
- **SC-002**: 100% of malformed requests (template mismatch, wrong tool segment,
  non-UUID identifier, unknown identity) return not-found with zero history bytes.
- **SC-003**: In `private` mode, 0 requests lacking a valid credential receive any
  history data; 0 credential values appear in any response or error body across the
  corpus.
- **SC-004**: The component serves full history with caching, filesystem writes,
  databases, and long-lived processes all disabled (serverless-shape fixture passes).

## Assumptions

- The component is strictly stateless regarding authorship: it reads what 008 wrote via
  007's port semantics and trusts only the attachment chain.
- Hosting/deployment packaging follows the constitution's technology-stack constraints;
  this spec pins behavior, not framework.
- Access-token mechanism (static token vs session) is configuration; both satisfy
  FR-008's posture.
