# Data Model: Package Publish Tooling

**Feature**: `specs/015-package-publish-tooling/spec.md` | **Date**: 2026-11-06
Phase 1 output. Entities introduced by 015. All are release-time / governance artifacts —
no runtime entity is added, and no frozen 002 or 011/012 surface entity is touched. The
frozen shapes referenced below (`exports` map, `SERVER_VERSION` exported name, CLI
command registry) are consumed verbatim.

## 1. Release Run

One gated execution of `scripts/release.mjs` — the pipeline instance the spec's Release Run
entity names. Memory-only during execution; persists only as process output (stage summary
lines + one final verdict JSON object on stdout, zero secrets, zero env values — names only).

| Field | Rule |
|---|---|
| `mode` | `"dry-run"` \| `"release"` — set by flag; `dry-run` NEVER reaches the publish stage and asserts publish credentials are ABSENT |
| `trigger` | release: `v<major>.<minor>.<patch>` tag name (workflow input); dry-run: the commit under verification (no tag required) |
| `stages` | ordered, fixed catalog (§2) — exactly one pass/fail/skip per stage, in order; a failed stage terminates the run (**fail closed**: no later stage executes, publish never executes) |
| `verdict` | `PUBLISHED` \| `WOULD_PUBLISH` (dry-run success) \| `REFUSED:<reason>` \| `FAILED:<stage>` — exactly one per run; every refusal names the stage and reason (§3 code) |
| `durationMs` | total plus per-stage durations (SC-005 measurement point) |

**State transition**: `started → stage[i].running → { stage[i].failed → ended(FAILED:i) |
stage[i].passed }` … `→ final-stage.passed → ended(PUBLISHED | WOULD_PUBLISH)`; any
preflight failure ends before `stage[0]` with `REFUSED:<code>`. Interrupted publish is
`REFUSED:PUBLISH_AMBIGUOUS` (report, reconcile, never auto-retry — constitution create-
indeterminate precedent).

## 2. Stage Catalog (FR-003 order)

Canonical, immutable order; the contract test asserts the implementation's catalog equals
this table (spec US1 scenario 1: stages "execute in order").

| # | Stage id | Dry-run | What passing means |
|---|---|---|---|
| — | `preflight` | shape-check only | clean tree; HEAD == tag; tag version == package version (both values named on mismatch); release mode only |
| 1 | `install-locked` | ✓ | `npm ci` succeeds from `package-lock.json` alone (lockfile-drift edge case) |
| 2 | `lint` | ✓ | `npm run lint` exit 0 |
| 3 | `typecheck` | ✓ | `npm run typecheck` exit 0 |
| 4 | `build-clean` | ✓ | `dist/` deleted first, then build (stale-cache edge case); `prebuild` regenerates `src/version.generated.ts` |
| 5 | `test-full` | ✓ | `npm test` (all tiers, coverage gate per existing posture) |
| 6 | `pack` | ✓ | `npm pack --json` produces exactly one tarball |
| 7 | `archive-verify` | ✓ | ArchiveManifest (§4) checks + isolated consumer env (subpath imports, typecheck, `--version` bin) + changelog entry for version |
| 8 | `defaults-scan` | ✓ | `secret-scan.scanFileTree` over the extracted archive finds 0 findings outside documented placeholders |
| 9 | `publish` | **skipped** | registry accepted the publish with attestation; ambiguity classified (§3) |

## 3. Verdict / Refusal Reason Codes

Machine-readable; the stage summary names the stage, the code names the cause.

| Code | Stage | Meaning |
|---|---|---|
| `DIRTY_TREE` | preflight | uncommitted changes at release time |
| `TAG_MISSING` | preflight | requested tag absent / HEAD not at tag |
| `TAG_MISMATCH` | preflight | tag version ≠ package version (message names both) |
| `LOCKFILE_UNSATISFIABLE` | install-locked | frozen lockfile cannot satisfy clean install |
| `STAGE_FAILED:<n>` | any | lint/typecheck/build/test failure (stage named) |
| `STALE_VERSION_DERIVATION` | archive-verify | embedded version ≠ manifest version (FR-002 artifact-level check) |
| `CHANGELOG_MISSING` | archive-verify | no `## [<version>]` entry in the packed changelog |
| `ARCHIVE_ALLOWLIST` | archive-verify | archive file list ≠ derived expected set (diff printed) |
| `LICENSE_MISSING` | archive-verify | LICENSE absent or ≠ MIT standard text |
| `EXPORT_UNRESOLVED:<subpath>` / `TYPES_UNRESOLVED:<subpath>` / `CLI_VERSION_MISMATCH` | archive-verify | consumer-env failures (FR-004) |
| `POSTURE_DRIFT` | archive-verify | published manifest lost engines/zero-deps/exports posture (FR-011) |
| `DEFAULTS_SCAN:<count>` | defaults-scan | findings in archive contents (FR-005) |
| `PROVENANCE_UNAVAILABLE` | publish | no attestation path and no operator override (FR-006) |
| `PUBLISH_REJECTED` | publish | registry rejection (already-published → versioning mistake) |
| `PUBLISH_2FA_REQUIRED` | publish | registry demanded an interactive OTP (EOTP) — pre-write refusal: fix token/policy, retry |
| `PUBLISH_FORBIDDEN` | publish | credentials refused (E401/E403) — pre-write refusal: fix the token, retry |
| `PUBLISH_AMBIGUOUS` | publish | interrupted mid-call; reconcile, do not retry blindly |

## 4. Archive Manifest (allow-list)

The expected file list of the packed artifact, **derived** (never duplicated) from
`package.json.files` plus npm's force-included entries.

| Rule | Detail |
|---|---|
| Source of truth | `package.json.files` = `["dist", "README.md", "docs", "LICENSE", "CHANGELOG.md"]` (015 adds LICENSE + CHANGELOG.md) |
| Derived expected set | every packed path lies under an allow-list root, plus npm-forced `package.json` (and root README/LICENSE hoisting — none duplicated since roots are already allow-listed) |
| Actual set (two readers) | `npm pack --json` per-entry list **and** `tar -tzf` on the tarball; the two readers must agree (SC-002 off-allow-list mutation is caught by both) |
| Required members | `LICENSE` (MIT standard text), `CHANGELOG.md` (entry for the version — §5), every subpath's `implementation + .d.ts` pair from the published manifest's `exports` (FR-011) |
| Forbidden members | `.npmignore` anywhere in the repo (contract test — FR-001's "no second exclusion config"); `build/`, `tests/`, `coverage/`, `.github/` never appear in the archive |

## 5. Version Source & Derived Values (FR-002)

| Element | Rule |
|---|---|
| `VersionSource` | `package.json.version` — the ONLY hand-edited version string in the repository |
| `src/version.generated.ts` | generated by `scripts/gen-version.mjs` (`prebuild`); committed; exports `PACKAGE_VERSION`; banner marks generated; contents derivable byte-for-byte from VersionSource |
| Derived embedded values | `SERVER_VERSION` (re-exported name unchanged), CLI `--version` output `task-linear-sync <version>`; no other embedded value may exist — `version-drift` contract test greps `src/**`, `docs/**`, `README.md` for semver literals outside the generated file |
| Artifact-level equality | archive verification asserts installed `SERVER_VERSION` and `bin --version` output equal VersionSource (SC-004: exactly 1 source, 0 mismatched strings in archive) |
| Tag | `v<VersionSource>` — release preflight (§2) is the enforcement; drift fails before publish, naming both values |

## 6. Changelog Entry

| Field | Rule |
|---|---|
| Header | `## [<semver>] - <YYYY-MM-DD>`; unique version per file; optional `## [Unreleased]` above all entries |
| Body | user-visible change summary for that version (release precondition; the gate verifies, never authors) |
| Membership | MUST be inside the packed archive (US4) — release refuses with `CHANGELOG_MISSING` at stage 7 when the entry for the released version is absent from the *archive's copy* (spec US3 scenario 2 placement) |
| CI posture | format linted on every PR by contract test (entry-header grammar, duplicate-version rejection) so release day never meets malformed history |

## 7. Versioning Policy (documented contract, FR-010)

`docs/versioning.md`, linked from `README.md`. Machine-checked presence (R8):

| Section | Rule |
|---|---|
| Semver discipline | package follows semver; 0.x posture: breaking changes land at minor bumps; post-1.0.0 strict semver |
| Surface-stability mapping | table: every public surface (per 014 stability declarations: core library + CLI, programmatic API, worker/hooks, history server, MCP server, CI action) → what "stable" pins (its frozen contract elements) → which package-version event may reopen it. Contract test greps the 014 stability-declared surface set and fails on an unmapped surface |
| 1.0.0 condition | stated verbatim: every public surface stable **and** real-workspace dogfooding complete; recorded as policy text, not executed code |
| Update duty | changes under the documentation duty whenever the surface stability set changes (014 promotions must add/refresh a row in the same change) |

## 8. Relationships

```text
ReleaseRun --executes--> StageCatalog[1..9] (+ preflight in release mode)
ReleaseRun.stage[7] --validates--> ArchiveManifest --derivedFrom--> package.json.files
ReleaseRun.stage[7] --reads--> ChangelogEntry (version == VersionSource, tag-matched)
ReleaseRun.stage[8] --scans--> extracted archive contents via scripts/lib/secret-scan.mjs
VersionSource --generates--> src/version.generated.ts --supplies--> {SERVER_VERSION, CLI --version}
VersioningPolicy --maps--> 014 per-surface StabilityDeclarations (read-only reference)
```
