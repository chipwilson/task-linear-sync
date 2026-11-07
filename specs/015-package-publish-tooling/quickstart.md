# Quickstart: 015 — Package Publish Tooling

**Date**: 2026-11-06 | **Journey**: from "no release machinery exists" to a single, repeatable,
fail-closed gated release — locked install through provenanced publish — rehearsed
merge-blocking on every PR as a dry-run, with one version source, a shipped license +
changelog, and a defaults scan that protects the ARTIFACT, not just the repo.

Every local check below runs the same `scripts/release.mjs` stages CI runs; the dry-run needs
no credentials and makes no network calls beyond `npm ci`. Verification mirrors the contract
docs (contracts/README.md enforcement map); platform: Linux/macOS (or WSL/Git-Bash — stage 8
uses system `tar`).

## Prerequisites

```bash
npm ci                 # frozen lockfile (stage 1 does this itself)
npm run build          # regenerates src/version.generated.ts via prebuild
npm test               # full suite green BEFORE starting (baseline)
```

## Scenario 1 — full dry-run on the current tree (US1, US2, SC-001, SC-005)

```bash
node scripts/release.mjs --dry-run
```

**Expected**: stages print in FR-003 order
(`install-locked → lint → typecheck → build-clean → test-full → pack → archive-verify →
defaults-scan`) with `status=passed` and per-stage `ms`; `publish` skipped; final stdout line
is one JSON object with `"verdict":"WOULD_PUBLISH"`, exit 0. In `archive-verify` every
declared subpath (including `./mcp` and `./history-server`) imports and type-checks **from
the installed tarball in a temp dir** — 0 shipping failures (SC-001); the CLI `--version`
prints `task-linear-sync <package version>`. Stage durations sum ≤ 12 min on CI runner
hardware (SC-005 budget; CI leg `release-dry-run` logs are the measurement of record).

Hermeticity: run with `NPM_TOKEN` unset (as in the CI job) — pass; run with `NPM_TOKEN=x` set
— the dry-run REFUSES `MODE_CONFLICT` (credentials must be ABSENT, US2 scenario 1's inverse).

## Scenario 2 — the 6/6 mutation matrix halts publishing (SC-002)

```bash
npm run test:contract -- release-pipeline   # harness runs all mutations against stubbed worlds
```

Each mutation asserts correct stage, reason code, and `publish` never executed
(contracts/release-pipeline.md §5): UUID/org literal in a shipped file → stage 8
`DEFAULTS_SCAN`; broken export target → `EXPORT_UNRESOLVED:<subpath>`; non-running binary →
CLI failure; off-allow-list file → `ARCHIVE_ALLOWLIST` diff; changelog entry deleted →
`CHANGELOG_MISSING`; tag mismatch → `TAG_MISMATCH` naming BOTH values, zero stages ran.
Human demo of one class:

```bash
echo '// 550e8400-e29b-41d4-a716-446655440000' >> docs/cli.md   # UUID into shipped docs
node scripts/release.mjs --dry-run          # FAILS at defaults-scan; exit 1; nothing packed forward
git checkout -- docs/cli.md
```

**Expected**: `REFUSED:DEFAULTS_SCAN:1` naming the file and pattern. 0 secret values and 0
org identifiers appear in the run's logs (US2 scenario 3 — credential-sentinel posture).

## Scenario 3 — CI rehearsal is merge-blocking and credential-free (US2, SC-003)

```bash
# On a pull request (no publishing secret configured anywhere on the repo):
gh run list --workflow=CI --job=release-dry-run        # executes on 100% of PRs
grep -c 'secrets\.' <(gh api .../jobs/<id> --jq .steps) # 0 credential steps
# Break the build on a branch → release-dry-run job goes red → merge blocked.
```

Contract-level equivalent runnable now: `npm run test:contract -- release-pipeline`
(workflow-shape checks assert `ci.yml`'s dry-run job has zero `secrets.` references,
`release.yml` is `workflow_dispatch`-only with `id-token: write`, and no npm secret appears
in `release.yml` under trusted publishing).

## Scenario 4 — one version, changelog, tag (US3, SC-004)

```bash
npm version minor --no-git-tag-version      # touches ONLY package.json (single source)
npm run build                               # prebuild regenerates src/version.generated.ts
node -e "import('./dist/mcp/index.js').then(m=>console.log(m.SERVER_VERSION))"  # follows automatically
node scripts/release.mjs --dry-run          # embedded-version artifact check passes
npm run test:contract -- version-drift      # green

# Now inject drift (the permanent correctness trap, closed):
sed -i 's/0\.3\.0/0.3.1/' src/version.generated.ts
npm run test:contract -- version-drift      # RED — names generated-vs-manifest mismatch

# Tag/changelog gates:
node scripts/release.mjs --release --tag v9.9.9            # REFUSED:TAG_MISMATCH v9.9.9 vs package version; before stage 1
# remove the changelog entry for the real version → --dry-run ... REFUSED:CHANGELOG_MISSING at archive-verify
```

**Expected**: exactly 1 hand-edited version string; 0 mismatched version strings in the
archive; both refusals fail before any publish.

## Scenario 5 — licensable, discoverable, honest artifact (US4)

```bash
npm pack --dry-run --json | node -e "/* collect .files[].path */"   # or: node scripts/verify-package.mjs --list
```

**Expected**: file list equals the allow-list derived from `package.json.files`
(`dist`, `README.md`, `docs`, `LICENSE`, `CHANGELOG.md`, + npm-forced `package.json`) —
0 files outside it; `LICENSE` = standard MIT text; `CHANGELOG.md` present with the release
entry; published manifest posture intact (`engines >=20.0.0`, zero `dependencies`, full
exports map, `types` first per subpath, `license: "MIT"`). Policy doc: `docs/versioning.md`
states the 1.0.0 condition + per-surface mapping, linked from `README.md`;
`npm run test:contract -- versioning-policy` greps the 014 stability set against the mapping
table (a promoted surface without a row = red).

## Scenario 6 — provenance fails closed; publish outcomes (US1 edge cases)

Local proof of the fail-closed path (no registry contact):

```bash
# Simulated: runner without OIDC + no NPM_TOKEN (contract suite stubs the attestation probe):
#   REFUSED:PROVENANCE_UNAVAILABLE — nothing contacted, nothing published.
# With explicit override (documented operator action only):
node scripts/release.mjs --release --tag v0.3.0 --allow-unattested   # proceeds WITH a loud warning
```

Registry outcomes (demonstrated in the suite's stubbed-registry mode): already-published
version → `PUBLISH_REJECTED` reported as a versioning mistake, nothing partial; interrupted
transport → `PUBLISH_AMBIGUOUS` with "check the registry, do not blindly retry". The first
real release (maintainer, post-merge of this feature + Trusted Publisher configured on npm)
exercises the real registry leg once; until then `release.yml` runs are refused-or-would —
which IS the gate working.

## Exit criteria (feature-level)

- `node scripts/release.mjs --dry-run` green locally AND as the merge-blocking
  `release-dry-run` CI job on the PR (SC-001/003).
- 6/6 mutation checks red-the-right-way in `release-pipeline` suite (SC-002).
- `version-drift`, `changelog`, `archive-verification`, `secret-scan`,
  `versioning-policy` contract suites green; `npm test` full suite green (SC-004).
- Dry-run CI leg duration ≤ 12 min documented + measured (SC-005).
- Zero new dependencies (`git diff main -- package.json` shows files/scripts only), zero new
  runtime export, zero frozen-surface amendment (contracts/README.md ledger).
