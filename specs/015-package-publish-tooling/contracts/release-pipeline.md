# Contract: Release Pipeline (`scripts/release.mjs` + workflows)

The release entry point. Plain Node ≥ 20 ESM, **zero dependencies** (FR-012: release
tooling adds no runtime dependency and no new dev dependency — npm, git, tar are platform
tools). FR-003, FR-006, FR-007, FR-009.

## 1. Invocation

```text
node scripts/release.mjs --dry-run
node scripts/release.mjs --release --tag v<version> [--allow-unattested]
```

| Token | Rule |
|---|---|
| `--dry-run` | every stage except `publish`; asserts NO publish credential env var (`NPM_TOKEN`/`NODE_AUTH_TOKEN`) is present — if one is, the run REFUSES (`MODE_CONFLICT`), proving US2 hermeticity mechanically |
| `--release --tag v<X>` | full run including publish; tag required (no implicit HEAD tag) |
| `--allow-unattested` | the ONLY escape from provenance fail-closed; requires explicit operator action; never default; logs a loud annotation-safe warning (no secret values) |
| neither mode flag | usage error, exit 2 |
| `--keep-workdir` | debug aid: leave the temp consumer/pack dirs; never used by CI |

## 2. Stage machine (fail closed — FR-003)

Order fixed as `data-model.md §2` (`install-locked → lint → typecheck → build-clean →
test-full → pack → archive-verify → defaults-scan → publish`). Contract test asserts the
implemented catalog matches the data-model table exactly (names + order). Semantics:

1. `--release` runs **preflight before stage 1**: clean tree → HEAD at tag → tag version ===
   `package.json` version (both values named) → fail closed with `REFUSED:<code>`.
2. A failing stage ends the run; nothing after it executes; `publish` is therefore unreached.
3. `build-clean` removes `dist/` before building (no stale/partial incremental output).
4. Each stage prints one summary line (`stage=<id> status=<passed|failed> ms=<n>`).
5. Final stdout line is a single JSON object:
   `{"verdict":"PUBLISHED"|"WOULD_PUBLISH"|"REFUSED:<code>","stage":"<id>",
   "tag":"<tag|commit>","dryRun":<bool>,"durationMs":<n>,"stages":[...]}`.
   Zero secrets, zero env values (names only), zero organization identifiers.
6. `publish` classification (edge cases): existing-version rejection →
   `REFUSED:PUBLISH_REJECTED` (reported as versioning mistake — nothing partial);
   transport interruption after request dispatch → `REFUSED:PUBLISH_AMBIGUOUS` with
   reconcile-don't-retry guidance; attestation unavailable and no override →
   `REFUSED:PROVENANCE_UNAVAILABLE` **before** contacting the registry.

## 3. Exit codes

| Code | Meaning |
|---|---|
| 0 | verdict `PUBLISHED` or `WOULD_PUBLISH` |
| 1 | any `REFUSED:*` / stage failure |
| 2 | usage error (bad flags) |

## 4. Workflow triggers

### `ci.yml` job `release-dry-run` (FR-009, US2)

- `pull_request` + `push: [main]` (same triggers as `validate`); merge-blocking like the
  existing job; `timeout-minutes: 20`; documented wall-clock budget ≤ 12 min (SC-005),
  measured from the printed stage durations in the job log.
- Single Node `20.x` leg (engines floor = weakest consumer shape, research R10).
- Steps: checkout → setup-node(npm cache) → `npm ci` → `node scripts/release.mjs --dry-run`.
- **Zero `secrets.*` references in the job**; workflow-shape contract test greps the job
  body for `secrets.` and fails on any hit (SC-003).

### `release.yml` (US1, FR-006/007)

| Element | Rule |
|---|---|
| trigger | `workflow_dispatch` ONLY, inputs: `tag` (required, pattern `^v\d+\.\d+\.\d+$`), `allow_unattested` (boolean, default `false`) — maintainer-initiated, never automatic-on-merge |
| permissions | `contents: read`, `id-token: write` (OIDC provenance); nothing else |
| environment | `release` (maintainer-gated approval) |
| primary auth | npm **Trusted Publishing** — no npm secret exists (research R2) |
| fallback auth | `NPM_TOKEN` from the CI secret store ONLY when Trusted Publishing is unconfigured; consumed via a masked env var; never echoed; `npm publish --provenance --access public --tag latest` |
| checkout | `fetch-depth: 0` + tags (preflight needs HEAD↔tag) |
| body | preflight → `node scripts/release.mjs --release --tag <input>` (same stages the PR rehearsed) |
| log hygiene | no step prints environment values; annotations carry stage ids and reason codes only (constitution "Hermetic pipelines"; FR-006) |

## 5. Mutation checks (SC-002 — 6/6)

Harness `tests/contract/release-pipeline.test.ts` runs the orchestrator with stubbed stage
executors over synthetic worlds (fake pack lists, fake tarballs):

| Injected fault | Expected |
|---|---|
| org-identifier/UUID literal in a shipped file | stage 8 fails, `REFUSED:DEFAULTS_SCAN:*`, publish not attempted |
| broken export target (missing file in pack list) | stage 7 fails, `EXPORT_UNRESOLVED:<subpath>` |
| non-running CLI binary in consumer env | stage 7 fails, `CLI_VERSION_MISMATCH`/spawn failure |
| off-allow-list file in archive | stage 7 fails, `ARCHIVE_ALLOWLIST` (diff shown) |
| changelog entry for version removed | stage 7 fails, `CHANGELOG_MISSING` |
| tag ≠ package version | preflight fails `REFUSED:TAG_MISMATCH` naming both; zero stages ran |

Each check asserts: correct stage, correct reason code, `publish` never executed.
