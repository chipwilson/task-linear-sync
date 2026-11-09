# Contract: Versioning, Changelog, and License Hygiene

FR-001, FR-002, FR-008, FR-010; US3, US4. One derivation chain, one changelog grammar,
one license text, one policy document.

## 1. Version derivation chain (FR-002 — single source)

```text
package.json.version            ← the ONLY hand-edited version string
        │  scripts/gen-version.mjs  (wired as "prebuild"; runs on every npm run build)
        ▼
src/version.generated.ts        ← committed, banner-marked generated file:
        │                          export const PACKAGE_VERSION = "<exact>";
        ├──► src/mcp/create.ts      SERVER_VERSION = PACKAGE_VERSION   (exported NAME unchanged;
        │                            value not frozen in mcp-surface.json — verified)
        └──► src/cli --version flag  "task-linear-sync <version>" (new global flag; additive,
                                     zero other side effects, exit 0, works with or without a command)
```

| Rule | Enforcement |
|---|---|
| Generated file matches source byte-for-byte | `version-drift.test.ts` re-derives and diffs |
| No other embedded version anywhere | same suite greps `src/**`, `docs/**`, `README.md` for semver literals outside the generated file (changelog entry headers are the sole allow-listed exception — they record history, not the current version) |
| Artifact follows source | archive-verification `SERVER_VERSION` + `bin --version` equality (artifact-verification.md §2) |
| Fresh-clone orderability | the generated file is COMMITTED (lint before build stays green); staleness is caught by the drift test, not prevented by gitignore (research R4) |
| CLI docs updated in-change | `docs/cli.md`, 009 `command-surface.md` global-flags table, `specs/requirements.md` as-built wording (documentation duty; 014 R10 precedent; no amendment — CLI is outside the freeze regime) |
| 012 hygiene-import allowlist | `mcp-hygiene.test.ts` carries one additive exception: `../version.generated.js` (a compile-time constant with zero I/O — the rule's "no filesystem at runtime" purpose is upheld; implemented as a documented exception in the test) |

## 2. Changelog grammar (FR-008)

`CHANGELOG.md` at repo root, Keep-a-Changelog-shaped, ships in the archive.

```text
# Changelog
## [Unreleased]                     ← optional, at most one, above all entries
## [<semver>] - <YYYY-MM-DD>        ← entry header; version unique per file
### Added / Changed / Fixed / …     ← free-form user-visible summary below
```

| Rule | Enforcement |
|---|---|
| Header grammar (semver + ISO date) | `changelog.test.ts` on every PR |
| No duplicate version entries | same suite |
| Release requires entry for the tagged version | archive-verification stage 7 reads the ARCHIVE's copy: `## [<version>]` present or `CHANGELOG_MISSING` (spec US3 scenario 2 — fails at verification, naming the version) |
| The gate never authors | no release-time changelog mutation exists anywhere in the pipeline |
| Seeded content | initial file documents `0.2.0` (current version as-built) so the first release's diff is honest |

## 3. License (FR-001)

| Element | Rule |
|---|---|
| `LICENSE` at repo root | standard MIT text, copyright line `task-linear-sync contributors` (matches `action.yml` author); created by this feature |
| Manifest consistency | `package.json.license === "MIT"` — the shipped license must match the declared one |
| Archive membership | `files` includes `LICENSE`; absence from archive = `LICENSE_MISSING` (day-one-violation guard, US4) |
| Drift test | license text equals the canonical MIT template with the single copyright-line substitution |

## 4. Versioning policy document (FR-010)

`docs/versioning.md`, linked from `README.md` (US4 scenario 3). Required content:

| Section | Required statement |
|---|---|
| Semver discipline | package versions follow semver; **0.x posture**: breaking changes permitted at minor bumps; strict semver from 1.0.0 |
| Surface-stability mapping | table mapping EVERY public surface (per 014 stability declarations — core library + CLI, programmatic API, worker/hooks, history server, MCP server, CI action) to what its `stable` status pins (frozen contract elements) and which package-version event may reopen it; a surface promoted by 014 without a policy row fails CI (contract test greps the stability set) |
| 1.0.0 condition | verbatim: every public surface declared stable under the 014 regime AND real-workspace dogfooding complete; policy text only — this feature executes nothing toward it |
| Action alignment | `action.yml` consumers pin repository tags; the release tag IS the action ref — preflight (clean tree, HEAD==tag) is what prevents action/package drift (013 posture; no separate action channel) |
| Update duty | any surface-stability-set change must update this doc in the same change (documentation duty, mirrors 014 FR-003's consistency rule) |

Enforcement: `versioning-policy.test.ts` — presence of the 1.0.0 condition sentence, full
surface coverage in the mapping table, README link existence.

## 5. Mutation checks (SC-004, US3 independent test)

| Injected fault | Catching check |
|---|---|
| version bumped only in `package.json`, no build | `version-drift` fails (generated file stale) — CI red |
| differing duplicate version hand-injected in `src/` | `version-drift` grep fails, naming file |
| embedded `SERVER_VERSION` ≠ manifest (drifted dist) | artifact-verification `STALE_VERSION_DERIVATION` |
| changelog entry for tag deleted | release refuses `CHANGELOG_MISSING` (stage 7) |
| tag `v9.9.9` on version `0.2.0` | preflight refuses `TAG_MISMATCH` naming both, before any stage |
| LICENSE removed from `files` | stage 6/7 allow-list fails `LICENSE_MISSING` |
