# Feature Specification: Issue-Tracker Integration Port

**Feature Branch**: `007-issue-tracker-integration`

**Created**: 2026-10-21

**Status**: Draft

**Input**: Decomposition of `specs/001-extract-functional-requirements/spec.md` (clarification session 2026-10-21). Absorbs 001 group G (Issue-tracker integration surface, source R8).

## Purpose and Scope

The single, injectable door to the issue tracker (constitution Principle V): issue
listing with per-team scoping and pagination, metadata discovery, issue CRUD/archive,
and the attachment operations — including the deterministic attachment-URL upsert and
continuation-page chain walking — that carry identity and history. A Wave-2 feature
built against the 002 tracker-port contract; every other feature tests against its
hermetic fake.

**Owns**: pagination and scoping rules; per-team metadata discovery; issue operations;
identity lookup **only** via attachment metadata; attachment create-or-update by
deterministic URL; chain enumeration.

**Consumes from 002**: tracker-port contract; attachment URL scheme; resilience rules
(retry/backoff/`Retry-After`, creates never auto-retried) and credential handling —
constitution-governed, cited not re-authored.

**Provides to**: 006 (candidate issues with attachment metadata), 008 (all mutations),
011 (history reads via attachment chain), 013 (via published commands only).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Complete, correctly scoped inventory (Priority: P1)

The engine asks for the issues in its configured world and gets all of them: every page,
across every configured team, restricted to issues in a configured team AND one of that
team's configured projects AND not in an ignored state type, with per-team scoping never
leaking across teams.

**Why this priority**: Every plan is built from this inventory; a missed page or a
scoping leak corrupts matching downstream.

**Independent Test**: Contract suite against a fake tracker with multi-page responses,
multi-team fixtures, and cross-team trap issues; assert page-count requests, complete
retrieval, scoping filter exactness, and per-team result isolation.

**Acceptance Scenarios**:

1. **Given** configured teams with projects and thousands of issues, **When** listing
   runs with the configured page size, **Then** all pages are retrieved until exhausted.
2. **Given** an issue in a configured team but a non-configured project (or an ignored
   state type — default canceled, duplicate), **When** listing filters, **Then** it is
   excluded; per-team scoping is preserved exactly.
3. **Given** each configured team, **When** metadata discovery runs, **Then** the team
   key, its projects, and its workflow states are returned as three collections per
   team.

### User Story 2 - Identity and history via attachments only (Priority: P2)

Issues are found by a task's durable identity strictly through attachment metadata
(deterministic-URL query or attachment scan — never description search), and a task's
attachment chain is walked page 0, 1, 2, … until none exists, with identity keyed
solely off the canonical page-0 attachment.

**Why this priority**: This is the physical embodiment of constitution Principle II;
description-search would silently break durable identity.

**Independent Test**: Fake tracker with attachments addressed by deterministic URLs;
assert create-or-update updates in place without duplicating, continuation URLs form the
expected chain, walking stops at the first missing page, identity resolution uses only
page 0, and a description containing UUID-like text never produces a match.

**Acceptance Scenarios**:

1. **Given** a task's durable identity, **When** its issue is located, **Then** lookup
   uses only attachment metadata — query by the task's deterministic attachment URL or
   scan the issue's attachments — and never searches issue descriptions.
2. **Given** an issue, **When** get-by-identifier, create, update, or archive is
   called, **Then** the operation performs with configured resilience (non-create
   requests retried with backoff/`Retry-After`; creates never automatically retried).
3. **Given** the canonical URL for a task's page-0 attachment, **When**
   create-or-update runs twice, **Then** the attachment is updated in place (no
   duplicate), and no attachment identifier needs storing.
4. **Given** a task with continuation pages 0..N, **When** the chain is enumerated,
   **Then** page indices are walked upward via their deterministic paged URLs until no
   further page exists, with cursor-paginated attachment listing for a single issue
   also supported.

## Requirements *(mandatory)*

- **FR-001** (001 FR-043): System MUST list issues with configured page-size pagination
  until all pages are retrieved, across all configured teams, including only issues that
  belong to a configured team AND one of that team's configured projects AND are not in
  an ignored state type (default: canceled, duplicate), preserving per-team scoping.
- **FR-002** (001 FR-044): System MUST discover, per configured team, the team key, its
  projects, and its workflow states, returning all three collections per team.
- **FR-003** (001 FR-045): System MUST provide operations to get an issue by identifier,
  create an issue, update an issue, and archive an issue.
- **FR-004** (001 FR-046): System MUST locate an issue by a task's durable identity
  **only** via the tool attachment metadata (query by the task's deterministic
  attachment URL or scan the issue's attachments) and MUST NOT search issue descriptions
  for identity.
- **FR-005** (001 FR-047): System MUST provide attachment operations to create-or-update
  the canonical attachment by its deterministic URL (updating in place rather than
  duplicating, without storing the attachment identifier), update an attachment, query
  attachments for a given URL, and list an issue's attachments with cursor-based
  pagination.
- **FR-006** (001 FR-048): System MUST provide attachment operations for continuation
  (history) pages addressed by their deterministic paged URLs and MUST enumerate a
  task's attachment chain by walking page indices upward until no further page exists;
  identity matching keys solely off the page-0 canonical attachment.

### Edge Cases

- **Mid-pagination failure**: a page request failing after retries surfaces the tracker
  error with no partial-inventory consumption by callers.
- **Rate limiting**: honor `Retry-After` per the constitution's resilience constraint;
  never mutate as a retry of a create.
- **Chain gap** (page 3 missing but page 4 present): the walk stops at the first absent
  index; orphaned higher pages are reported, not silently skipped.

## Key Entities

**Attachment Chain** (owned mechanics): canonical (page-0) attachment as the sole
identity anchor plus ordered continuation pages extending the append-only history.
**Sync State Payload** storage location (shape owned by 002/008).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Over the multi-team, multi-page fixture corpus, listing retrieves 100% of
  in-scope issues and 0 out-of-scope issues.
- **SC-002**: Repeated create-or-update of the same deterministic attachment URL yields
  exactly 1 attachment per URL (0 duplicates) across the corpus.
- **SC-003**: Identity lookups resolve 100% via attachment metadata and 0 via
  description content (adversarial fixtures with UUID-like descriptions prove the
  negative).

## Assumptions

- The tracker is Linear per the source document; behaviors (attachment metadata,
  URL-idempotent attachments, workflow state types, pagination) follow its documented
  capabilities, phrased generically so the port stays swappable.
- Credentials come from configured environment variables with pre-flight diagnostics
  (constitution); this spec owns no credential logic.
- Screening of attachment payload content is enforced by callers (008); the port
  transmits what it is given.
