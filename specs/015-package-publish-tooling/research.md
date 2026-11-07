# Research: Package Publish Tooling

**Feature**: `specs/015-package-publish-tooling/spec.md` | **Date**: 2026-11-06
Phase 0 output. Every Technical-Context unknown and every tooling decision below;
no NEEDS CLARIFICATION markers remain.

## R1. Where the release pipeline lives: one orchestrator script, two workflow entry points

- **Decision**: `scripts/release.mjs` (plain Node ≥ 20 ESM, zero dependencies) is the single
  release orchestrator. It runs the FR-003 stage sequence as a fail-closed stage machine
  (`locked install → lint → typecheck → clean build → full suite → pack → archive
  verification → defaults scan → publish`), prints a one-line stage summary plus a final
  single-JSON-object verdict (published / would-publish / refused-with-reason), and exposes
  `--dry-run` (everything except publish) versus `--release`. Two GitHub Actions entry points
  drive it: `.github/workflows/ci.yml` gains a `release-dry-run` job (no secrets, every PR,
  merge-blocking — FR-009); new `.github/workflows/release.yml` is `workflow_dispatch`-only
  with a required `tag` input (maintainer-initiated per the spec Assumption, never
  automatic-on-merge) and performs the publish leg.
- **Rationale**: the constitution's merge-blocking gate already lives in `ci.yml`
  (`Project_CICD_Pipeline`), so the dry-run rides the same workflow and inherits its
  merge-blocking status — one pipeline, one gate vocabulary (Principle V's "one engine"
  applied to CI). A single script with a mode flag guarantees the rehearsal and the real run
  execute the *same* code path (spec US2's premise: a gate that only fires at release is
  untested). Both modes are spawnable locally, so the quickstart can validate without CI.
- **Alternatives considered**:
  - (a) Shell steps inline in two workflow files: rejected — 1,000+ lines of duplicated YAML
    that can silently drift from each other; untestable locally; FR-003's stage ordering
    belongs in one implementation.
  - (b) `semantic-release` / `changesets` (dev deps): rejected — adds a dependency tree and
    automates the release *decision*, which the Assumptions keep manual; the spec asks for a
    gated pipeline, not a changelog generator.
  - (c) A composite GitHub Action: rejected — this repository already *ships* an action
    (013); authoring a second one for internal use adds surface with no consumer.

## R2. Publish authentication and provenance: Trusted Publishing first, token fallback, fail closed

- **Decision**: Primary mode is npm **Trusted Publishing** (GitHub Actions OIDC, GA since
  2025-07): `release.yml` carries `permissions: id-token: write` and no npm secret exists at
  all; the npm CLI then generates provenance attestations automatically. Fallback mode (for
  runners/platforms without OIDC) consumes `NPM_TOKEN` **from the CI secret store** together
  with `npm publish --provenance --access public --tag latest` — still `id-token: write`,
  still attested. The pipeline *detects* attestation capability before publish and refuses
  (verdict `REFUSED: PROVENANCE_UNAVAILABLE`) unless the operator passes the explicit,
  documented `--allow-unattested` override (workflow input `allow_unattested`, default
  `false`); there is no silent fallback (FR-006, spec edge case). A publish failure is
  classified: registry rejection of an existing version → `PUBLISH_REJECTED` (reported as a
  versioning mistake, nothing partially published); a transport-level failure after the
  request left the runner → `PUBLISH_AMBIGUOUS` with a "reconcile against the registry, do
  not blindly retry" instruction (mirrors the constitution's never-retry-a-create posture).
- **Rationale**: the spec Assumption names "token-based, OIDC-provenanced publishing
  configured in the CI platform". Trusted Publishing satisfies that assumption's intent at a
  strictly stronger posture — the credential that "MUST come only from the secret store"
  (FR-006) does not exist, so it structurally cannot appear in logs or annotations; 2026
  ecosystem guidance (npm docs; post-2025 supply-chain incidents) treats long-lived publish
  tokens as the vulnerable primitive. Both modes are implemented so the pipeline works on day
  one regardless of which registry configuration the maintainer completes (registry-side
  setup is explicitly outside this feature).
- **Alternatives considered**:
  - (a) Token-only (`NPM_TOKEN` + `--provenance`): kept as fallback but rejected as primary —
    a stealable long-lived secret is the exact primitive recent npm compromises exploited.
  - (b) Skip provenance entirely: forbidden by FR-006 and the spec edge case.
  - (c) `npm publish --provenance` under trusted publishing too (belt-and-braces): harmless
    no-op — the CLI auto-attests; the script keeps the flag for the token fallback path.

## R3. Archive verification: isolated temp consumer environment, zero network, no repo tree

- **Decision**: `scripts/verify-package.mjs` builds a throwaway consumer under a temp dir
  (`mkdtemp` in the OS temp area): `npm init -y` → `npm install <packed-tarball>` → (i) read
  the **installed** package's own `exports` map and dynamic-`import()` every subpath
  (asserts resolution + execution of the runtime entry, covering the `<pkg>/mcp` and
  `<pkg>/history-server` subpaths); (ii) write a generated `consumer-types.ts` that imports
  every subpath and run the repository's own `tsc --noEmit` (module `NodeNext`) against it
  with the temp project resolving to the installed package — proving each `types` condition
  points at a loadable declaration; (iii) spawn `node_modules/.bin/task-linear-sync --version`
  and assert exit 0 with the version equal to the manifest version (FR-004). Nothing reads
  the repository tree except the tarball path. Because the package has **zero runtime
  dependencies**, `npm install <tarball>` is fully offline — the isolated install is
  hermetic by construction.
- **Rationale**: FR-004 says "consume only the packed artifact in an isolated consumer
  environment (never the repository tree)". Installing the tarball reproduces exactly what a
  consumer gets (npm's normalization included), which copying `dist/` would not. The
  zero-dep posture (transport allowance unspent) makes isolation cheap and credential-free.
- **Alternatives considered**:
  - (a) `node --input-type=module -e` importing `file://…/dist/...` paths: rejected — bypasses
    the `exports` map, package resolution, and `bin` wiring; tests the repo, not the artifact.
  - (b) `publint`/`attw` (dev deps): good tools, but they are a dependency and they check
    the manifest heuristically rather than *executing* every subpath and the CLI; FR-012
    pushes all release-time tooling to zero new dependencies anyway (R6 keeps even the
    dev-dep count unchanged).
  - (c) Docker for isolation: rejected — CI runners are already throwaway; a local container
    requirement would make the quickstart heavier than the gate it proves.

## R4. One version source: package.json + committed generated module + drift contract test

- **Decision**: `package.json.version` is the ONLY version source. `scripts/gen-version.mjs`
  (wired as `prebuild`, so `npm run build` always runs it) rewrites the committed
  `src/version.generated.ts` (`export const PACKAGE_VERSION = "<exact version>";`, a
  banner-commented generated file). `src/mcp/create.ts` becomes
  `SERVER_VERSION = PACKAGE_VERSION` (the exported NAME is unchanged — the 012/014 MCP
  surface snapshot freezes tool schemas and protocol revisions but **not** the server-version
  *value*, verified: no snapshot/contract mention). The CLI gains a global `--version` flag
  (print `task-linear-sync <version>`, exit 0, zero other side effects — the flag is accepted
  alongside any command or alone) sourced from the same module; `docs/cli.md` updates in the
  same change (documentation duty). A new contract suite `version-drift.test.ts` fails CI
  when (1) `src/version.generated.ts` disagrees with `package.json.version`, (2) any
  semver-literal appears in `src/**`, `docs/**`, `README.md` outside the generated file
  (allow-listed exception for the changelog's own entry headers), or (3) the built
  `dist/mcp/index.js` value ≠ manifest version.
- **Rationale**: FR-002 demands build-time derivation with a failing contract test on drift.
  Committing the generated file (rather than gitignoring it) keeps `npm run lint` and
  `npm run typecheck` runnable in any order from a fresh clone — the current CI runs lint
  *before* build, and a gitignored generated module would break that ordering. The drift
  test converts "forgot to rebuild" from a silent artifact bug into a red CI check, and US3's
  independent test ("bump the version, the embedded one follows with no other edit") holds
  because `prebuild` regenerates on every build. `src/mcp` keeps its zero-`node:fs` posture
  because derivation is build-time text generation, not runtime `package.json` reading — and a
  runtime `createRequire` read would violate the `mcp-hygiene` zero-filesystem rule.
- **Alternatives considered**:
  - (a) Runtime `createRequire(import.meta.url)("../../package.json").version` inside
    `src/mcp`: rejected — violates `mcp-hygiene` (zero filesystem), and breaks under bundlers
    where `package.json` sits above the package root.
  - (b) Gitignored generated file: rejected — CI step-order coupling and cold-clone lint/typecheck failure.
  - (c) `npm version` lifecycle hook writing multiple files: rejected — two sources written
    from one command is drift by construction; one derived file keeps the dependency arrow
    strictly one-way.
  - (d) Separate `version` *command*: the global `--version` flag is the CLI convention
    (and what the spec's "the CLI binary MUST run its version command" verifies); a twelfth
    subcommand would churn the 009 command-surface contract doc for the same capability.

## R5. Allow-list, license, and changelog in the archive

- **Decision**: `package.json.files` gains `"LICENSE"` and `"CHANGELOG.md"` (joining `dist`,
  `README.md`, `docs`). `LICENSE` is created with the standard MIT text, copyright line
  "task-linear-sync contributors" (matching `action.yml` author). `CHANGELOG.md` starts with
  `0.2.0` (current) and the first release entry; Keep-a-Changelog-shaped headers
  `## [<semver>] - <YYYY-MM-DD>`. The verification tool derives the expected file set from
  the manifest allow-list itself (plus npm's force-included entries: `package.json`, its
  `readme`, and a root `LICENSE`/`CHANGELOG` npm hoists) — there is **no second hard-coded
  list**, so "belt-and-braces exclusion config kept consistent" (FR-001) is satisfied by the
  absence of a drift-capable duplicate: a contract test additionally asserts no `.npmignore`
  exists (it would shadow nothing while `files` is present, but its presence would signal two
  competing lists). The archive file list is read from `npm pack --json` and cross-checked
  against `tar -tzf` on the tarball (two independent readers of the same artifact).
- **Rationale**: FR-001/US4: publishing with `license: "MIT"` declared and no LICENSE shipped
  is the day-one license violation the spec calls out; deriving the expected list from
  `files` makes the allow-list mechanically the single source. The changelog ships in the
  archive (US4 scenario 1) so consumers see the history offline.
- **Alternatives considered**:
  - (a) `.npmignore` as the second exclusion layer: rejected — `files` already wins in npm's
    precedence; a second list is exactly what FR-001 warns drifts.
  - (b) Ship `README.md` from root only vs also `docs/` — unchanged from 013's posture
    (`docs` stays in `files`; its examples are already defaults-scanned).

## R6. Defaults scan over the archive: extract the existing patterns into `scripts/lib/secret-scan.mjs`

- **Decision**: The banned-shape inventory + placeholder allowances + file-walking logic
  already contract-tested in `tests/contract/ci-defaults-scan.test.ts` (and mirrored in
  `defaults-scan.test.ts`) is extracted VERBATIM into `scripts/lib/secret-scan.mjs`
  (plain ESM, JSDoc-typed), which exports `BANNED`, `isPlaceholder`, `scanText`,
  `scanFileTree`. `ci-defaults-scan.test.ts` refactors to import that module (single source —
  "reusing not reauthoring", FR-005), and the release pipeline's scan stage runs
  `scanFileTree` over the tarball extracted to a temp dir (`tar -xzf`; a platform tool
  present on CI runners and macOS, documented for Windows-WSL/Git-Bash in the quickstart).
  Scan covers every file in the archive (shipped `dist` sources/maps, `docs`, examples,
  `README.md`, `CHANGELOG.md`) — the same BANNED set: `lin_api_` token values, PEM material,
  credential-header keys, fictional-org literals standing in for tenants, emails, UUID-shaped
  identifiers, long hex digests — with the documented placeholder allowances (single-repeat
  hex probes, the `ac000000-…` documented seed).
- **Rationale**: FR-005 names reuse explicitly. One module keeps the repo scan and the
  artifact scan from diverging; scanning the *extracted archive* (not the installed tree)
  matches the spec's "over archive contents" and sees the files exactly as published, before
  any install-time normalization.
- **Alternatives considered**:
  - (a) Scan the consumer-install tree from R3: rejected — npm rewrites `package.json` on
    install (adds `_resolved`/`_integrity`), so findings would not name shipped bytes.
  - (b) `gitleaks`/`secretlint` (dev deps): rejected — dependency, different pattern set than
    the contract-tested one, and cannot encode this project's documented placeholder
    allowances; would create the two-list drift FR-005 forbids.
  - (c) Keep patterns in test files and `execFileSync` a copy: rejected — that is reauthoring.

## R7. Release preflight: tag ↔ version ↔ changelog, in the spec-mandated order

- **Decision**: `--release` mode runs preflight **before the first build stage** (spec edge
  cases): (1) working tree clean (`git status --porcelain` empty); (2) `git describe` /
  `HEAD` resolves to the requested tag (`v<version>`); (3) tag version === `package.json`
  version — mismatch refuses naming BOTH values (US3 scenario 3); (4) dry-run mode instead
  verifies "tag shape" only (a `v0.x.y` version literal in the input) since PRs carry no
  release tag. The changelog-entry check runs at the **archive-verification** stage, exactly
  where the spec puts it (US3 scenario 2): `## [<version>]` MUST exist in the packed
  `CHANGELOG.md`, and the packed changelog must parse (every entry header well-formed
  semver+date). CI additionally lints changelog format on every PR (cheap contract test,
  R8's suite), so format rot is caught before release day.
- **Rationale**: the spec fixes the failure points — dirty tree/missing tag fail before
  building; changelog absence fails at verification; tag/version mismatch fails before any
  publish. Encoding each check at its mandated stage keeps acceptance scenarios directly
  testable.
- **Alternatives considered**: (a) Changelog check in preflight: rejected — contradicts US3
  scenario 2's "fails at the archive-verification stage"; (b) auto-stamping the changelog at
  release: rejected — the entry is curated human content ("user-visible changes"), the gate
  verifies, never authors.

## R8. Versioning policy document and its machine-checkable contract

- **Decision**: `docs/versioning.md` — package semver rules (0.x: breaking changes at
  minor-bump, per the current posture); the mapping from 014's per-surface stability
  declarations to package versions (a surface promoted to stable is pinned for its frozen
  contract elements; a package major bump is the only event that may re-open them); and the
  1.0.0 condition: **every public surface declared stable per the 014 regime AND the
  real-workspace dogfooding complete** (spec Assumption, recorded as policy text). Linked
  from `README.md`. Contract test `versioning-policy.test.ts` asserts: the 1.0.0 condition
  sentence exists; the mapping table names every surface the 014 stability docs declare
  (grep-driven, so a future surface added without a policy row fails CI — "updated under the
  documentation duty whenever the surface stability set changes", FR-010); and the README
  link exists.
- **Rationale**: FR-010 requires the doc and its update duty; the grep-based surface check is
  the same consistency-test pattern 014 used for its stability declarations, making the
  policy text self-enforcing rather than aspirational.
- **Alternatives considered**: policy as front-matter'd data parsed at runtime: rejected —
  the policy is governance prose for maintainers and auditors; a runtime artifact would
  imply package behavior that doesn't exist.

## R9. Changelog, action-version consistency, and as-built doc touchpoints

- **Decision**: changelog format contract (`changelog.test.ts`): header shape, one entry per
  version, no duplicate versions, `Unreleased` section allowed. `action.yml` ships from
  repository tags (013's posture, unchanged): consistency with the package version is
  guaranteed by construction — the release tag IS the action ref, and preflight (R7) makes
  HEAD==tag a precondition; no action-version field exists to drift. The CLI `--version` flag
  (R4) updates `docs/cli.md`, the command-surface contract doc's global-flags table, and
  `specs/requirements.md` as-built wording in the same change (documentation duty; precedent
  014 R10). No amendment: the CLI command surface is not under the 002/014 freeze regime
  (only 002 config/ports and the 011/012 surfaces are), and the addition is strictly
  additive.
- **Rationale**: spec Scope explicitly keeps action releases out ("aligns tag/version
  consistency" only); the touchpoints are exactly the docs that mention what changes.
- **Alternatives considered**: (a) separate action release channel: explicitly out of scope;
  (b) a `version`-bumping bot: out of scope (release decision stays manual).

## R10. CI integration, runtime budget, and secret hygiene of the pipeline itself

- **Decision**: `ci.yml` gains job `release-dry-run` (runs-on `ubuntu-latest`, single Node
  `20.x` leg — the engines floor, which is also the weakest consumer shape): `npm ci` →
  `node scripts/release.mjs --dry-run`. No `secrets.*` context anywhere in the job; the
  script asserts `NPM_TOKEN`/`NODE_AUTH_TOKEN` are absent in dry-run and still runs the pack
  + verify + scan stages (proving they need no credentials — US2). Job timeout
  `timeout-minutes: 20`; documented budget **≤ 12 min wall-clock** for the dry-run leg
  (SC-005), with the script printing per-stage durations so CI logs carry the measurement.
  Log/annotation hygiene: the script never echoes environment values, only env-var NAMES;
  the existing credential-sentinel suites extend to the release scripts (they are scanned as
  `scripts/**` sources by the defaults scan on dry-run output). `release.yml` is
  `workflow_dispatch` with `inputs: { tag: { required }, allow_unattested: { default false } }`,
  `permissions: contents: read, id-token: write`, environment `release` (maintainer-gated),
  and no pull_request/push triggers.
- **Rationale**: constitution "Hermetic pipelines" + "Merge-blocking validation" apply to this
  tooling per spec US2; the floor-Node leg doubles as the engines-floor consumer check; a
  budget without a measurement point is not a budget.
- **Alternatives considered**: (a) dry-run on the 24.x leg: rejected — the 20.x floor catches
  engines-constraint lies earlier; (b) separate `release-dry-run.yml` workflow: rejected —
  the constitution names one `Project_CICD_Pipeline`; a second file splits merge-blocking
  status; (c) caching the packed tarball between matrix legs: rejected — packs are
  sub-second, and cross-leg caching would let a stale artifact slip past verification.
