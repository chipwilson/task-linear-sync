# Implementation Plan: Package Publish Tooling

**Branch**: `015-package-publish-tooling` | **Date**: 2026-11-06 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/015-package-publish-tooling/spec.md`

## Summary

Make a release a single, repeatable, gated action that fails closed. Headline decisions
(research R1–R10): **one zero-dependency orchestrator** `scripts/release.mjs` runs the FR-003
stage machine (locked install → lint → typecheck → clean build → full suite → pack → archive
verification → defaults scan → publish) in release and `--dry-run` modes with a
machine-readable verdict vocabulary; **two workflow entry points** — a credential-free,
merge-blocking `release-dry-run` job in the existing `ci.yml` (every PR rehearses the gate)
and a `workflow_dispatch`-only `release.yml` (maintainer-initiated, `id-token: write`).
Publishing is **npm Trusted Publishing (OIDC) first** — no npm secret exists at all; provenance
auto-attested — with a secret-store `NPM_TOKEN` fallback and fail-closed
`PROVENANCE_UNAVAILABLE` absent the explicit `--allow-unattested` override (R2). Archive
verification installs the tarball into an **isolated temp consumer** (offline by the zero-dep
posture) and imports every export subpath, type-checks every declaration with the repo's own
tsc, and runs `task-linear-sync --version` (new global CLI flag) (R3). **One version source**:
`package.json.version` → committed generated `src/version.generated.ts` (via `prebuild`) →
`SERVER_VERSION` + CLI `--version`, with a drift contract test (R4). The existing contract-tested
scan patterns are extracted **verbatim** into `scripts/lib/secret-scan.mjs` and re-run over the
extracted archive — reuse, not reauthoring (R6). LICENSE + CHANGELOG ship in the archive; the
allow-list is *derived* from `package.json.files`, no second list (R5); `docs/versioning.md`
records the semver/0.x posture, the 014 per-surface stability mapping (grep-checked), and the
1.0.0 condition (R8). Zero new dependencies (runtime or dev), zero frozen-surface amendments.

## Technical Context

**Language/Version**: TypeScript 5.7 (`strict: true`), ESM + generated `.d.ts`, Node ≥ 20.0.0
(unchanged). Release tooling itself: plain Node ≥ 20 ESM scripts (`scripts/*.mjs`) — npm, git,
and system `tar` as platform tools; no build step for scripts.

**Primary Dependencies**: **None added — runtime or dev** (FR-012; `tracker-dependency-budget`
stays `SPENT 0` and the dev-dep set is unchanged). Touches: `scripts/{release,verify-package,gen-version}.mjs`
+ `scripts/lib/secret-scan.mjs` (new), `.github/workflows/{ci,release}.yml`, `package.json`
(`files`, `prebuild`), new root `LICENSE` + `CHANGELOG.md`, `src/version.generated.ts`
(generated), `src/mcp/create.ts` (derivation), `src/cli/{argv,commands,main}.ts`
(`--version` flag), `docs/versioning.md`, `docs/cli.md`, `README.md`.

**Storage**: **N/A** — Release Runs are memory-only, persisting as stage-summary lines + one
verdict JSON object on stdout (no secrets, env names only). No state outside the run.

**Testing**: `node:test` + `node:assert/strict`, existing tiers via `scripts/run-tests.mjs`;
tests-first per constitution VI. New contract suites: `release-pipeline` (stage catalog, verdict
machine, 6/6 mutation matrix, workflow-shape greps), `archive-verification` (real `npm pack`,
allow-list, posture), `version-drift`, `changelog`, `secret-scan` (extracted patterns),
`versioning-policy`; new e2e `release-dry-run` (full pipeline, verdict `WOULD_PUBLISH`).
Existing defaults-scan/hygiene suites keep passing — the scan module refactor is behavior-
identical.

**Target Platform**: unchanged — publishable `task-linear-sync` npm package for Node ≥ 20
consumers; GitHub-hosted `ubuntu-latest` runners for the pipeline (dry-run leg on Node
`20.x` = engines floor).

**Project Type**: single npm package (existing) + its release plane: dev-time scripts, CI
workflows, governance docs. No second package or app; `action.yml` stays as 013 shipped it.

**Performance Goals**: release gate credible in review — documented dry-run CI leg budget
**≤ 12 min wall-clock** (`timeout-minutes: 20` backstop), measured from per-stage durations
the orchestrator prints (SC-005); `npm pack` sub-second; isolated install offline (zero
runtime deps).

**Constraints**: fail closed at every stage (any failure publishes nothing); dry-run
hermetic with NO credential present; publish credentials (fallback mode) only from the CI
secret store, never in logs/annotations; no silent unattested publish (explicit documented
override only); zero new dependencies; zero frozen-surface amendments; builds always from
clean `dist/`; the artifact scan reuses the contract-tested pattern set verbatim.

**Scale/Scope**: 12 FRs, 5 SCs, 4 user stories; 4 new scripts + 1 workflow file + 1 CI job;
2 new root files (`LICENSE`, `CHANGELOG.md`) + 1 policy doc + 1 generated module; ~6 new test
files + 2 extended; ~30–35 tasks (tasks phase).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Gate (constitution clause) | Verdict | Evidence in this plan |
|---|---|---|
| I. Safety First (NON-NEGOTIABLE) | PASS | Release plane touches no engine/apply path; the gate is structurally safety-first — every failure publishes nothing; publish never auto-retries an ambiguous outcome (create-indeterminate precedent, R2) |
| II. Durable Identity | PASS (N/A) | No identity behavior; UUID-shaped values are scan TARGETS in shipped bytes, unchanged semantics |
| III. Intelligent Defaults / no org literals | PASS | FR-005 extends the distributed-defaults guarantee from repo to ARTIFACT via the same pattern set + documented placeholder allowances (R6) |
| IV. Determinism & Idempotency | PASS | Locked `npm ci`, clean `dist/` build, fixed stage catalog asserted against the data-model table; re-running a refused release is safe (registry rejects dupes → reported, not replayed) |
| V. One Engine, Additive Surfaces | PASS | CLI `--version` is additive (no gating logic); dry-run and release share ONE orchestrator (one gate path); `action.yml` untouched |
| VI. Test-First & Quality Gates (NON-NEGOTIABLE) | PASS | Every FR maps to at least one automated check (contracts/README.md enforcement map); 6/6 mutation checks are the SC-002 property evidence; dry-run job is merge-blocking |
| Additional: Credential handling | PASS | Trusted Publishing = credential does not exist; fallback token only from secret store, masked env, never echoed (FR-006, R2, R10) |
| Additional: Technology stack | PASS | ESM + per-module `.d.ts` + exports/types + engines ≥ 20 + zero-dep posture of the ARTIFACT actively asserted at publish time (FR-011, stage 7 posture checks) |
| Additional: No org-specific literals | PASS | Scan over archive contents (R6); docs add no literals — placeholders only |
| Workflow: Merge-blocking validation | PASS | `release-dry-run` job joins `ci.yml` on PR + main push, same blocking status (FR-009) |
| Workflow: Hermetic pipelines | PASS | Dry-run asserts credential ABSENCE; zero `secrets.` in its job body (grep-tested); no org identifiers in its logs (sentinel posture) |
| Workflow: Release gates | PASS | This feature IS the clause made mechanical: build ESM+declarations ✓, publish every declared entry point ✓, defaults scan publishes nothing on detection ✓ (stages 4/7/8/9) |
| Workflow: Documentation duty | PASS | `docs/versioning.md` + README link + `docs/cli.md`/command-surface/requirements as-built wording in the same change as `--version` (R4/R9) |

**Result: PASS — no violations; Complexity Tracking not needed.**

*Post-design re-check (after research.md + data-model.md + contracts/)*: re-evaluated against
the concrete decisions — trusted-publishing-vs-assumption wording resolved as strict
strengthening, not deviation (R2 rationale); `--version` verified outside the freeze regime;
`SERVER_VERSION` value verified absent from `mcp-surface.json` (no amendment ledger entry
needed); changeline-failure stage placement matches spec US3 scenario 2. **Still PASS.**

## Project Structure

### Documentation (this feature)

```text
specs/015-package-publish-tooling/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (R1–R10, complete)
├── data-model.md        # Phase 1 output (Release Run, Stage Catalog, Archive Manifest, Version Source, Changelog, Policy)
├── quickstart.md        # Phase 1 output (6 validation scenarios + exit criteria)
├── contracts/           # Phase 1 output
│   ├── README.md        # Contract index + frozen-surface ledger + enforcement map
│   ├── release-pipeline.md
│   ├── artifact-verification.md
│   └── versioning-policy.md
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
scripts/
├── release.mjs              # NEW — orchestrator: stage machine, verdicts, preflight, publish classify
├── verify-package.mjs       # NEW — stage 7 engine: pack reads, consumer env, allow-list, posture
├── gen-version.mjs          # NEW — prebuild: package.json → src/version.generated.ts
├── lib/secret-scan.mjs      # NEW — patterns extracted from ci-defaults-scan (single source)
└── run-tests.mjs            # existing, unchanged

src/
├── version.generated.ts     # NEW — committed generated module (PACKAGE_VERSION)
├── mcp/create.ts            # SERVER_VERSION = PACKAGE_VERSION (name unchanged)
└── cli/{argv,commands,main}.ts  # global --version flag (additive)

.github/workflows/
├── ci.yml                   # + release-dry-run job (no secrets, merge-blocking, Node 20.x)
└── release.yml              # NEW — workflow_dispatch(tag, allow_unattested), id-token: write

LICENSE                      # NEW — MIT, "task-linear-sync contributors"
CHANGELOG.md                 # NEW — seeded at 0.2.0
docs/versioning.md           # NEW — semver + surface mapping + 1.0.0 condition (README-linked)
docs/cli.md                  # + --version section (documentation duty)
README.md                    # + versioning-policy link
package.json                 # files += LICENSE/CHANGELOG.md; scripts.prebuild (no dep changes)

tests/
├── contract/{release-pipeline,archive-verification,version-drift,changelog,secret-scan,versioning-policy}.test.ts   # NEW
├── contract/{ci-defaults-scan,defaults-scan}.test.ts        # refactor: import lib/secret-scan (behavior-identical)
├── contract/{cli-packaging,package-surface}.test.ts         # extended: --version + files allow-list
└── e2e/release-dry-run.test.ts                              # NEW — full pipeline → WOULD_PUBLISH
```

**Structure Decision**: single-project layout stays (the repository IS one package); 015 adds
a *release plane* only — dev-time scripts under `scripts/`, CI under `.github/workflows/`,
governance docs at root/`docs/` — plus two minimal additive source touches (version
derivation, `--version` flag). No new directories under `src/` beyond the generated module.

## Complexity Tracking

> No constitution violations — section unused.
