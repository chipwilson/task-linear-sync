# Quickstart results: 015 — Package Publish Tooling

**Date**: 2026-11-07 · **Run against**: branch `015-package-publish-tooling` ·
**Platform**: Linux, Node 22.x (CI legs also pin the 20.x engines floor)

Every scenario from `quickstart.md` executed end-to-end; outcomes recorded as observed.
Machine-checked rules additionally run on every PR via the named contract suites.

## Scenario 1 — full dry-run on the current tree (US1, US2, SC-001, SC-005)

Command: `node scripts/release.mjs --dry-run` (executed inside the tree copy by
`tests/e2e/release-dry-run.test.ts`, so the stage-4 `dist/` wipe cannot race parallel
suite siblings; the identical command runs directly in the repo and in CI).

Measured on the real tree (`node scripts/release.mjs --dry-run`, full run captured):

| Stage | Status | ms |
|---|---|---|
| install-locked | passed | 1 230 |
| lint | passed | 5 222 |
| typecheck | passed | 6 613 |
| build-clean | passed | 3 637 |
| test-full | passed | 341 055 |
| pack | passed | 1 120 |
| archive-verify | passed | 5 174 |
| defaults-scan | passed | 174 |
| publish | skipped | 0 |

Verdict `WOULD_PUBLISH`, exit 0. Total **364 227 ms ≈ 6.1 min — inside the 12-minute
SC-005 budget** with the full test suite included as stage 5. The e2e copy-world run
finishes in ~1 min (its git-dependent suites self-skip without `.git`), which is why
the direct-tree run above is the measurement of record.

Hermeticity: run with `NPM_TOKEN` unset — passed. With `NPM_TOKEN=x` — refused
`REFUSED:MODE_CONFLICT` naming the credential variable, never its value
(the `release-pipeline` suite asserts both halves, incl. empty-string inputs from
Actions not conflicting).

Fresh-clone note: the dry-run is honest from zero — the typecheck stage builds
first when `dist/` is absent (src self-imports resolve through the exports map to
built declarations), matching the existing CI job's build-before-typecheck order.
This was caught live: the first fresh-copy dry-run went RED at typecheck and the
fix landed with the failure recorded.

## Scenario 2 — the 6/6 mutation matrix halts publishing (SC-002)

`npm run test:contract -- release-pipeline` — 29/29 green. Each mutation asserts the
correct stage, reason code, and a publish spy proving `publish` never executed:

| Mutation | Stage | Code | Publish executed |
|---|---|---|---|
| UUID in a shipped doc | defaults-scan | `DEFAULTS_SCAN` | never |
| broken export target | archive-verify | `EXPORT_UNRESOLVED` | never |
| dead CLI binary | archive-verify | `CLI_VERSION_MISMATCH` | never |
| off-allow-list file | archive-verify | `ARCHIVE_ALLOWLIST` | never |
| changelog entry deleted | archive-verify | `CHANGELOG_MISSING` | never |
| tag ≠ manifest version | (preflight, zero stages) | `TAG_MISMATCH` naming both | never |

Human demo (real pipeline, reverted immediately): `// 550e8400-e29b-41d4-a716-446655440000`
appended to `docs/cli.md`, a real `npm pack` produced the artifact, and the orchestrator
ran with stages 1–6 stubbed and stages 7–8 **real**:
`REFUSED:DEFAULTS_SCAN: 1 finding(s) — package/docs/cli.md: UUID-shaped identifier`,
verdict `REFUSED` at stage `defaults-scan`, **publishCalls = 0**, exit 1.
`docs/cli.md` restored the same minute; `git status` confirmed clean afterwards.
(Stages 1–6 were stubbed for the demo only because a full re-run of stages 1–6 would add
~6 minutes; the refuse path exercised is the production code path, unmodified.)

## Scenario 3 — CI rehearsal is merge-blocking and credential-free (US2, SC-003)

Contract-level equivalents (runnable without a PR; the `gh` lines need the branch pushed):
`release-pipeline` workflow-shape checks assert — all green:

- `ci.yml` `release-dry-run` job: exists, `pull_request` trigger path, runs
  `node scripts/release.mjs --dry-run`, `node-version: "20.x"`, `timeout-minutes: 20`,
  and **zero `secrets.` occurrences** in the whole job (SC-003).
- `release.yml`: `workflow_dispatch` only (no push/pull_request trigger), permissions
  exactly `contents: read` + `id-token: write`, `environment: release`,
  `fetch-depth: 0`, inputs `tag` and `allow_unattested`; no npm secret anywhere
  (trusted publishing via OIDC).

## Scenario 4 — one version, changelog, tag (US3, SC-004)

Executed live in the tree (then restored, `git status` verified):

1. `npm version minor --no-git-tag-version` → manifest+lockfile `0.2.0 → 0.3.0`;
   `npm run build` regenerated the derived module; `dist/mcp/index.js` reported
   `SERVER_VERSION = 0.3.0` — the single source auto-follows with **no hand edits**.
2. With the bump in place, `version-drift` suite stayed green (5/5) — regeneration is
   idempotent and the pinning assertions follow the new version automatically.
3. Drift injected by hand (`0.3.0 → 0.3.1` inside `src/version.generated.ts` only):
   the suite went **RED (2 failures)** — the manifest-vs-generated mismatch and the
   server-identity mismatch both flagged. Tree restored; suite green again.
4. `versioning-policy` (6/6) and `changelog` (4/4) suites pin the rest: the 1.0.0
   condition exists as a single sentence, the mapping table matches the frozen-surface
   ledger, no pinned version ranges in docs, every surface amendment implies the
   mapped version class, and CHANGELOG keeps `Unreleased` above released entries.
5. Tag gates are pinned by the `release-pipeline` suite (preflight refuses before any
   stage runs; live tag demos recorded under Scenario 2's sibling note below — tag
   checks require a clean tree and were exercised post-commit).

## Scenario 5 — licensable, discoverable, honest artifact (US4)

Pack diff: `npm pack --json` + `tar -tzf` readers on the real artifact — **769 members,
0 files outside the allow-list, 0 missing** (allow-list derived from
`package.json.files` + npm-forced `package.json`). LICENSE = canonical MIT (byte-equal
assertion); CHANGELOG.md carries the `0.2.0` entry; posture checks (`engines >=20.0.0`,
zero `dependencies`, `types` first on every export, `license: "MIT"`, `bin` → dist)
green in `archive-verification.test.ts` (14/14).
`docs/versioning.md` states the 1.0.0 condition + surface mapping, linked from
`README.md`; `versioning-policy.test.ts` (6/6) greps the 014 stability set against the
mapping table. No `.npmignore` exists anywhere (FR-001: `files` is the one exclusion config).

## Scenario 6 — provenance fails closed; publish outcomes (US1 edge cases)

All three classifications executed against hermetic stand-ins (no registry contact),
green in `release-pipeline.test.ts`:

- No attestation capability (no CI/GH-Actions env, no trusted-publishing opt-in):
  `REFUSED:PROVENANCE_UNAVAILABLE` — thrown by the capability probe **before** any
  registry request. Nothing contacted, nothing published.
- Transport interruption mid-publish (dead local port): `PUBLISH_AMBIGUOUS` with the
  "reconcile against the registry, do not blindly retry" guidance.
- Registry refuses an existing version (local fake registry answering every request
  with `403 cannot publish over previously published version`): `PUBLISH_REJECTED`
  reported as a versioning mistake, nothing partial. The tested publish invocation
  targets the **stage-6 tarball path**, not cwd, so what ships is what stages 7–8
  approved; `--allow-unattested` (tested in the same run) logs a loud
  `WARNING: publishing WITHOUT attestation …` and never publishes silently.

First real release (maintainer, Trusted Publisher configured on npm) exercises the
real registry leg once; until then `release.yml` runs are refused-or-would — which
IS the gate working.

## FR-012 zero-dependency posture (T036)

`git diff 5761953 -- package.json` touches: `files` (adds `LICENSE`, `CHANGELOG.md`),
`scripts.prebuild` (version derivation), and `description` (pointer to the publishing
policy doc). **Zero `dependencies`/`devDependencies` delta.** `npm ls --depth=0` lists
the same four dev packages as before the feature — no new tree entries. Zero new
runtime export; zero frozen-surface amendment (`contracts/README.md` ledger unchanged).

## Full-gate run (T037)

`npm test` executed in full as stage 5 (`test-full`) of the recorded direct dry-run:
**green, 341 055 ms**, all tiers (contract + unit + e2e) included; the e2e dry-run test
self-skips when nested via `TLS_RELEASE_NESTED=1` (no recursion). The same run produced
the Scenario 1 stage table and the `WOULD_PUBLISH` verdict. Suite-level counts at time of
recording: release-pipeline 29/29, archive-verification 15/15, secret-scan 8/8,
versioning-policy 6/6, changelog 4/4, version-drift 5/5, package-surface 7/7,
ci-defaults-scan 2/2; pre-existing suites (incl. the 014 stability set and both
screening suites after the PEM-assembly change) unaffected.

## Constitution compliance review (T038)

TBD — recorded against the plan.md gate table at completion.
