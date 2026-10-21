# Phase 0 Research: Core Domain Contracts, Configuration, and Run State

**Feature**: `002-core-domain-contracts` | **Date**: 2026-10-21

All Technical Context items are resolved (no NEEDS CLARIFICATION remained after the spec and
constitution were loaded — the constitution's "Technology stack" constraint fixes the
runtime, module format, engine floor, and dependency posture). This document records the
decisions made while designing the frozen contracts and the two behavioral components,
each as Decision / Rationale / Alternatives considered.

## R1 — Runtime, module format, and toolchain

- **Decision**: TypeScript 5.x strict, `module: NodeNext`, ESM-only output with `declaration:
  true`; compiled by plain `tsc`; `engines.node >= 20.0.0`. No bundler.
- **Rationale**: The constitution mandates ESM output with a generated declaration per
  exported module and declared `exports`/`types` fields. Plain `tsc` produces exactly that
  with zero build dependencies, and per-module output keeps the future subpath exports
  (`<pkg>/mcp`) trivial. Node ≥ 20 is the declared floor.
- **Alternatives considered**: tsup/unbuild/esbuild bundlers — rejected: add dev-dependency
  surface and blur the one-module-per-export declaration mapping the constitution requires;
  a bundler buys nothing for a Node-only library.

## R2 — Test runner

- **Decision**: `node:test` (built-in runner) with `node:assert/strict`, run against the
  compiled output; a `--test` script per tier (`unit`, `integration`, `contract`, `e2e`) so
  the pipeline can gate tiers separately.
- **Rationale**: Principle VI demands hermetic, deterministic tests; the constitution limits
  runtime dependencies and the project's minimal-dependency posture extends comfortably to
  dev tooling. `node:test` gives suites, subtests, and concurrency with zero install, and
  tests importing the compiled package exercise the real `exports` map (a light contract
  check on packaging itself).
- **Alternatives considered**: Vitest/Jest — rejected as an extra dev-dependency and config
  surface with no capability this feature needs (no DOM, no transforms); they remain
  acceptable for later features only if a concrete need appears.

## R3 — Configuration merge semantics (deep merge)

- **Decision**: Recursive merge of plain objects (higher-precedence keys replace same-keyed
  lower values; keys absent from higher sources are retained — 001 R17.3). Arrays and
  scalars replace wholesale (never concatenated or element-merged). `null` is a value
  (replaces), `undefined` means "absent" (ignored). Merged config serialization uses sorted
  object keys, giving byte-identical output for identical inputs (SC-001).
- **Rationale**: Constitution III fixes the precedence order (defaults → file →
  programmatic) but not array semantics; whole-value array replacement is the only
  non-surprising, deterministic rule (a consumer overriding `taskFilePatterns` expects the
  override to *be* the list, not to extend it). Sorted-key serialization makes the
  determinism success criterion testable at the byte level.
- **Alternatives considered**: Array concatenation/merge-by-index — rejected: nondeterministic
  intent, breaks override ergonomics; JSON Merge Patch `null`-deletes — rejected: the spec
  has no delete semantic and `null`-as-delete would surprise config-file authors.

## R4 — Configuration file failure categories

- **Decision**: Exactly three file failure categories — `missing`, `unreadable`,
  `invalid-json` — reported together with the configured config-file path; loading aborts
  and applies no partial configuration from that file (FR-006). Category is decided in
  order: path provided but stat-misses → `missing`; stat succeeds but read throws (EACCES,
  EISDIR) → `unreadable`; read succeeds but `JSON.parse` throws or the root is not a JSON
  object → `invalid-json`.
- **Rationale**: These three map one-to-one to the spec's wording ("missing, unreadable, or
  syntactically invalid") and keep the diagnostic machine-categorizable for 009's error
  rendering and 013's log parsing.
- **Alternatives considered**: A single "config load failed" category — rejected: the spec
  requires naming the failure category; per-field validation errors folded into load —
  rejected: identity validation is a separate, later step (R5) with its own complete-listing
  contract.

## R5 — Required-identity validation completeness

- **Decision**: One validation pass (`validateWorkspaceIdentity`) over the fully merged
  config that collects **all** missing/empty required values before failing, naming each:
  team identities (≥1); for each team, ≥1 project identity and ≥1 workflow-state identity
  set; each `ProjectByPath` entry must carry both `teamKey` and `project`; default team and
  default project present and non-empty. Empty strings and empty arrays count as absent
  (001 R17.5). Error type carries a structured `missing: string[]` list.
- **Rationale**: FR-007/SC-002 require naming *every* missing value in one abort — a
  fail-fast-on-first-error validator would force debug-round-trips and would not satisfy
  "naming each missing value". Identity values intentionally have no defaults (Principle
  III), so validation is the only enforcement point and must be complete.
- **Alternatives considered**: JSON-Schema-based validation — rejected: adds a dependency
  and produces messages we'd have to reformat to list *all* misses anyway; zod-style —
  rejected: runtime dependency against the zero-dependency posture.

## R6 — State directory placement and naming

- **Decision**: Resolution order: (1) configured `stateDirectory` — used verbatim after
  canonicalization; (2) platform default: base = `$XDG_STATE_HOME` or `~/.local/state`
  (Linux), `~/Library/Application Support` (macOS), `%APPDATA%` (Windows); final path =
  `<base>/<toolId>/<hash>`, where `<hash>` is the first 16 hex chars of `sha256` over the
  canonical absolute repository root path (realpath, relative segments and symlinks
  resolved, UTF-8). **Inside-repo rule**: if the resolved path lies inside the canonical
  repository root (or equals it), the system aborts with a clear error and never falls back
  to an in-tree location (SC-003, edge case).
- **Rationale**: Matches 001 R11.1 and FR-001. Hash-of-canonical-root gives per-repository
  isolation with a stable, collision-resistant directory name; the explicit abort rule is
  what makes "out-of-repo by construction" testable rather than aspirational. 16 hex chars
  (64 bits) is ample for directory-name disambiguation while staying human-scannable.
- **Alternatives considered**: Full-length digest — rejected: unwieldy paths for no
  practical collision benefit; hashing a repo *identifier* (remote URL) instead of the path
  — rejected: the spec keys on the canonical root path, and remotes can be absent (001 R1.10
  tolerates missing origin).

## R7 — Owner-only, atomic state writes

- **Decision**: A single `state/fs` primitive used by every state write: directory created
  `0o700` (recursive creation applies it to every created level); file written to a sibling
  temp file in the same directory, `chmod 0o600`, then `rename()` over the target (same
  filesystem ⇒ atomic replace); permissions re-applied post-rename on platforms where
  umask could have interfered with the temp file mode. All readers go through JSON codecs
  that reject non-object roots.
- **Rationale**: Directly implements 001 R11.2–.4; centralizing in one primitive is what
  lets SC-003 and the permission tests be proven once instead of per-callsite.
- **Alternatives considered**: `open()` with `O_EXCL` + direct write — rejected: partial
  write observable on crash; `writeFile` then `chmod` — rejected: window of permissive
  access and non-atomic.

## R8 — Run lock, liveness probe, and stale takeover

- **Decision**: Lock file `lock.json` containing `{ runId, pid, acquiredAt (ISO-8601 UTC,
  injected clock) }`. Acquisition: exclusive create (`O_CREAT|O_EXCL`) wins immediately; on
  EEXIST, read the lock and take over **only if** `process.kill(pid, 0)` raises ESRCH
  (process dead) **and** `now - acquiredAt > staleTakeoverSeconds` (default 60, injected
  clock). Both conditions required, exactly (FR-003). EPERM on the kill probe counts as
  *alive* (we cannot prove death). Takeover is a re-attempt of exclusive create after an
  atomic unlink-if-still-matching (compare recorded `runId` before removing) so simultaneous
  losers (edge case "lock race") see either the live lock or the winner's fresh lock and
  report-and-exit; the loser never silently proceeds.
- **Rationale**: The AND rule is spec-mandated (protects a live-but-slow run and a just-
  crashed run within the grace window). The compare-before-unlink plus exclusive-create loop
  converts the TOCTOU race into a single-winner outcome using only built-in primitives.
  Treating EPERM as alive is the fail-safe direction (SC-004: 0 false takeovers).
- **Alternatives considered**: flock(2)-style advisory locking — not available portably in
  Node built-ins without a native dependency; pid-file with age-only takeover — rejected:
  violates the AND rule (live process could lose the lock); pid+boot-time reclamation —
  rejected: over-engineered for the spec's rule.

## R9 — Audit-manifest expiry, envelope, and key separation

- **Decision**: The manifest file is either a versioned encryption envelope
  `{ schemaVersion, keyId, iv, tag, ciphertext }` (all base64 where binary) when encryption
  is enabled, or a plain JSON manifest when disabled. Expiry is computed from the recorded
  creation timestamp of the *manifest* (`createdAt` stored inside the envelope plaintext and
  in an unencrypted sidecar header field for envelope files): elapsed > `manifestExpiryDays`
  (default 30) ⇒ expired, rollback-unavailable, regardless of encryption state (FR-002).
  Key resolution: configured environment-variable name or pluggable platform key-store
  provider interface (interface frozen here; 008 wires providers); a failed AES-256-GCM tag
  check rejects the manifest with no plaintext returned. Encryption algorithm constants and
  envelope schema are contracts here; 008 exercises journaling end-to-end.
- **Rationale**: FR-002 requires expiry evaluation independent of encryption; reading the
  timestamp from a small unencrypted header makes "expired" decidable without key material —
  necessary for the unencrypted-rollback-refusal and disabled-encryption paths and harmless
  (a creation timestamp is not secret). The key-store *provider* is an injectable interface
  so this feature stays dependency-free and hermetic.
- **Alternatives considered**: Encrypting the timestamp too (no header) — rejected: expiry
  checks would then require the key, breaking the "regardless of encryption" testability and
  the disabled-encryption path; age-by-file-mtime — rejected: mtime is mutable/unreliable
  and the spec says "recorded creation timestamp".

## R10 — Create-intent lifecycle (contract for 008)

- **Decision**: `Create_Intent` record `{ intentId, runId, taskUuid, targetTeamKey,
  targetProject, status, createdAt, updatedAt }` with lifecycle statuses `pending` →
  `confirmed-created` | `indeterminate` (→ `reconciled` written later by 008). 002 owns the
  store and the hard rule: `writeBeforeAttempt(intent)` persists `status: pending`
  durably (atomic write) and **resolves only after the rename completes**, before the
  caller may attempt the create (FR-004). Status transitions are read-modify-atomic-write;
  records are keyed by `intentId` and indexed by `taskUuid` for 008's reconciliation
  queries.
- **Rationale**: FR-004's value is crash-safety: a process killed mid-create must leave a
  `pending` record behind so 008's indeterminate reconciliation (008 FR-012) can find it.
  002 provides the durable bookkeeping; 008 owns when creates happen and what
  reconciliation means — matching the spec's ownership split.
- **Alternatives considered**: In-memory intent list flushed later — rejected: defeats the
  crash-window guarantee; journaling intents inside the audit manifest — rejected: the
  manifest may be disabled, but intent bookkeeping must persist regardless.

## R11 — `Stable_UUID` derivation shape (contract; 004 computes, 002 freezes)

- **Decision**: v5-shaped UUID derived as: name = canonical seed string
  `frameworkId + "\u0000" + (featureName ?? "") + "\u0000" + (localTaskId ?? ordinal+fileIdentity)`;
  digest = `sha256(namespacePrefix + name)`; set version nibble to `5` and variant bits per
  RFC 4122; render lowercase 8-4-4-4-12. Namespace prefix is a fixed constant **derived
  from `toolId`** (itself a fixed constant in shipped defaults — no org literals). Excluded
  from the seed by construction: visible issue prefix, checkbox state, title text.
- **Rationale**: The constitution fixes the seed composition and exclusion list; the spec
  says "RFC-4122 version-5-shaped", not literal SHA-1 v5, so SHA-256 (available in
  `node:crypto` and stronger) with v5 shape markers satisfies "shaped as" while remaining
  deterministic. Freezing the exact seed string layout here is precisely the point of Wave
  1: 004 implements, 006 matches against the same bytes.
- **Alternatives considered**: Literal RFC-4122 v5 (SHA-1) — viable, rejected in favor of
  the stronger digest given "shaped as" wording; storing a random UUID on first sight —
  rejected outright: violates determinism (Principle IV) and the "never persisted in-file"
  rule.

## R12 — Attachment URL scheme builders

- **Decision**: Pure functions over config templates: canonical (page 0)
  `<base-host>/<toolId>/<task-uuid>`; continuation page n ≥ 1
  `<base-host>/<toolId>/<task-uuid>/<pageN>`. Builders normalize the base host (strip
  trailing `/`, reject whitespace) and validate the UUID shape; templates themselves are
  config-overridable strings with `{baseHost}`, `{toolId}`, `{uuid}`, `{page}` placeholders,
  defaulting to the two canonical templates. Base-host default is a benign placeholder
  (e.g. `https://sync.example.invalid`) carrying no real organization identifier. A
  `parseAttachmentUrl()` companion recognizes both shapes and reports the page index — used
  by 007's chain walk and 011's routing.
- **Rationale**: Single source of truth for the sole identity anchor (Principle II);
  placeholder-template design keeps URL shape overridable without code changes while the
  page-index semantics (0 canonical, continuation from 1) stay frozen.
- **Alternatives considered**: Query-string page addressing (`?page=n`) — rejected: the
  spec fixes the path-segment form; encoding page 0 in the URL too — rejected: the
  page-0-canonical-URL *is* the idempotency key and must remain exactly the historical
  form.

## R13 — Plan artifact and report schema (contract for 008/009/013)

- **Decision**: One canonical `Plan` shape persisted as JSON in the state directory
  (`plans/<planId>.json`) with `planId` = sha256 over the canonicalized plan JSON (sorted
  keys, deterministic serialization). `guards` record per-input-file content hashes and the
  VCS HEAD at plan time; a `Plan_Reference` is valid iff it resolves to a stored plan whose
  guards still hold — the validity predicate is frozen here (`validatePlanReference`), the
  re-check at apply start belongs to 008. The paired review-report JSON schema is published
  as `contracts/plan-report.schema.json`; its per-task field set is exactly 009 FR-006's
  list; content exclusion is structural: entries carry `descriptionContentHash` and
  `expectedMarkdownChanges` digests/summaries, and the schema forbids raw-body/description
  string fields (enforced by the contract test scanning schema property names).
- **Rationale**: Freezing planId computation and the guard shape here is what makes
  "fresh `Plan_Reference`" a cross-surface-meaningful gate (CLI, worker, MCP all validate
  the same predicate). Making the exclusion structural (no such fields exist) rather than
  behavioral (fields filtered) is the strongest way to hold SC-005/013's machine input
  trustworthy.
- **Alternatives considered**: Random UUID planIds — rejected: planId must be re-derivable
  and drift-detecting; embedding raw bodies in JSON but redacting at render time —
  rejected: leaves secret material at rest in a file 013 uploads/parses.

## R14 — Gate vocabulary representation

- **Decision**: A typed union of discrete gate-failure codes — `APPLY_FLAG_MISSING`,
  `CONFIRMATION_KEY_MISMATCH`, `LOW_CONFIDENCE_NOT_ACCEPTED`, `PLAN_REFERENCE_UNKNOWN`,
  `PLAN_REFERENCE_STALE`, `LOCK_HELD`, `MANIFEST_EXPIRED`, `MANIFEST_UNJOURNALED` — plus a
  `GateRequest` type `{ applyFlag, confirmationKey, acceptLowConfidence, planReference? }`.
  The gate *evaluator* runs inside 008's engine; 002 freezes the vocabulary, request shape,
  and result shape so 009/010/012 render identical refusals and 013 can match on codes.
  `Confirmation_Key` comparison is exact-string against the configured value (default
  `SYNC`), never against a built-in constant (001 R17.7).
- **Rationale**: Constitution I + Principle V: one engine's gates must have one vocabulary
  or surfaces diverge. Codes are the machine interface (013's sole input is report JSON, but
  CLI exit rendering needs stable codes).
- **Alternatives considered**: Free-text refusal messages as the contract — rejected:
  unmatchable by 012/013 tests; per-surface local codes — rejected: re-implements divergent
  gating paths.

## R15 — Freezing the contract surface (amendment enforcement, FR-008)

- **Decision**: Two automated guardrails: (1) a **contract test** snapshotting the exact set
  of exported names from each frozen module (`src/domain`, `src/config`, `src/state`,
  `src/urls`, `src/gates`, `src/ports`) — any addition/removal/shape-drift fails the suite;
  (2) a **distributed-defaults scan** test asserting `src/config/defaults.ts` transitively
  contains no value matching real-identifier heuristics (UUID regex, `lin_api_`, long
  base64/hex secrets, email shapes) and that the only placeholder host/keys are the generic
  ones. Amendments must update the snapshot deliberately and be noted against 001
  (ROADMAP rule 2).
- **Rationale**: FR-008 demands that frozen-contract changes be visible amendments, not
  silent edits; tests are the only enforcement that survives a hundred agent-hours of
  parallel Wave-2/4 work (Principle VI).
- **Alternatives considered**: API Extractor report files — rejected: dev-dependency and
  heavier review flow than a plain snapshot test; documentation-only "please don't edit"
  rule — rejected:unenforceable.

## R16 — Clock injection for determinism

- **Decision**: `state/clock.ts` exports a `Clock` interface (`now(): Date`, monotonic
  elapsed helper) defaulting to system time, injectable through config into state paths
  (expiry, lock age, event timestamps). All time-based decisions take the clock as a
  parameter rather than calling `Date.now()` internally.
- **Rationale**: Principle VI forbids wall-clock nondeterminism in tests; FR-002/FR-003
  scenarios (aged manifest, stale lock) become deterministic unit tests instead of sleeps.
- **Alternatives considered**: Fake timers via a test library — rejected: adds a dependency
  and leaks through transitive calls; explicit injection is also better production design.

## Resolved unknowns summary

| Item | Resolution |
|---|---|
| Test runner, build toolchain | R1, R2 |
| Deep-merge array/null semantics | R3 |
| Failure categories & complete-listing validation | R4, R5 |
| Platform state locations, hash naming, in-repo refusal | R6 |
| Atomic owner-only writes | R7 |
| Lock semantics incl. race and EPERM | R8 |
| Manifest expiry header, envelope, key separation | R9 |
| Create-intent crash window | R10 |
| UUID digest choice | R11 |
| URL templates and parsing | R12 |
| planId / guards / reference validity / report exclusion structure | R13 |
| Gate codes | R14 |
| Amendment enforcement | R15 |
| Test determinism clock | R16 |

No NEEDS CLARIFICATION remains; Phase 1 gate cleared.
