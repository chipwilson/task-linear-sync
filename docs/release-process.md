# Release process

How `task-linear-sync` ships. The machine-readable contract lives in
[`specs/015-package-publish-tooling/contracts/release-pipeline.md`](../specs/015-package-publish-tooling/contracts/release-pipeline.md);
this page is the operator-facing procedure.

## The two doors

| Door | Where | What runs |
|---|---|---|
| Rehearsal | the `release-dry-run` job in CI, on every pull request and every push to `main` | `node scripts/release.mjs --dry-run` — every stage except `publish`, credential-free |
| Release | the **Release** workflow (`workflow_dispatch` only, `release` environment approval) | `node scripts/release.mjs --release --tag v<X.Y.Z>` — the same stages, then `npm publish` |

Because CI rehearses the whole gate, a tree that merges is a tree that can
publish — breakage cannot first appear at release time.

## Stage machine (fail closed)

`install-locked → lint → typecheck → build-clean → test-full → pack →
archive-verify → defaults-scan → publish`

A failing stage ends the run; nothing after it executes, so `publish` is
unreachable unless every earlier check passed. The last stdout line of every
run is a single JSON verdict object (`WOULD_PUBLISH`, `PUBLISHED`, or a
`REFUSED`/`STAGE_FAILED` verdict with the stage and reason code). Release mode
also preflights before stage 1: clean tree, HEAD at the tag, and
tag version === `package.json.version` (both values named on mismatch).

## Attestation and the operator override

Publishing is attested. The publish command shape is
`npm publish --provenance --access public --tag latest` (the orchestrator runs
it; `--allow-unattested` drops only the `--provenance` flag). The workflow mints
provenance via OIDC (`id-token:
write`) and npm Trusted Publishing — no npm secret exists on the primary path.
If the runner cannot demonstrate attestation capability, the run refuses with
`PROVENANCE_UNAVAILABLE` **before contacting the registry**.

`--allow-unattested` is the only way past that gate. It is an explicit,
documented operator override — never automatic, never a silent fallback:

1. Trigger the Release workflow with `allow_unattested` checked, or pass
   `--allow-unattested` on the command line.
2. Acceptable only when the capability outage is external (registry incident,
   attestation-service degradation) AND delaying the release harms users more
   than shipping unattested.
3. Record the evidence: the refusal log, the incident reference, the operator,
   and the reason in the release notes for the version. The orchestrator emits
   a loud warning line for exactly this record.

A `NPM_TOKEN` masked secret is the fallback store path only when Trusted
Publishing is unconfigured; its presence in a `--dry-run` environment is itself
a refusal (`MODE_CONFLICT`) — the rehearsal job must stay credential-free.

## Timing budget (SC-005)

The `release-dry-run` CI leg has a documented wall-clock **budget of ≤ 12
minutes** (`timeout-minutes: 20` is the backstop). Measurement: the job prints
each stage's duration (`stage=<id> status=<passed> ms=<n>`); the budget is the
sum of the printed `ms` values plus setup. If the sum trends above budget, split
`test-full` tiers or parallelize before touching the gates — never by skipping
a stage.

## Publishing steps (maintainer)

1. Land the version bump: edit **only** `package.json.version` — the generated
   version module follows on the next build (`npm run prebuild`), and the
   drift test refuses any hand-edited duplicate.
2. Add the `## [<version>] - <YYYY-MM-DD>` entry to `CHANGELOG.md` (the release
   refuses `CHANGELOG_MISSING` otherwise — but CI's changelog-format test
   catches rot long before release day).
3. Tag: `git tag vX.Y.Z && git push --tags`.
4. Run the Release workflow with `tag=vX.Y.Z`; approve the `release`
   environment prompt.
5. A rejected duplicate version means a versioning mistake
   (`PUBLISH_REJECTED`) — cut a new version; a transport interruption means
   reconcile against the registry first (`PUBLISH_AMBIGUOUS`) — never blindly
   retry.

Versioning policy (what `stable` means, the 0.x posture, the 1.0.0 condition):
[docs/versioning.md](versioning.md).
