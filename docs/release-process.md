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
unreachable unless every earlier check passed. The tool stages (`lint`,
`typecheck`, `build-clean`, `test-full`) stream their tool output live into the
run log — a failed stage is diagnosable from the CI log alone. The last stdout
line of every run is a single JSON verdict object (`WOULD_PUBLISH`, `PUBLISHED`, or a
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

## One-time setup (first release only)

The registry leg needs a trust relationship established before the first
workflow-dispatched publish; none of it is a repository change:

1. **GitHub environment**: create an environment named exactly `release` under
   Settings → Environments. The workflow references it; an undefined environment
   fails the run. Adding required reviewers there gives a human approval gate on
   every publish (recommended; the workflow assumes nothing beyond existence).
2. **The package must exist before Trusted Publishing can be configured** —
   npm configures trusted publishers on an existing package, and the name
   `task-linear-sync` is unregistered today. So the FIRST version publishes via
   the documented `NPM_TOKEN` fallback: set that repository secret to a npm
   **Granular Access Token** and dispatch the release
   **with `allow_unattested` checked** — a token-authenticated publish can never
   carry provenance (npm mints attestations only over OIDC), so the capability
   probe sees the token and refuses `PROVENANCE_UNAVAILABLE`; the override is
   the documented way through, recorded per the section above. Then delete the
   secret. Subsequent releases take the secret-less OIDC path.
   The GAT must be created with exactly (each omission produced a distinct
   real refusal during the v0.3.0 first release): permission **Read And
   publish** — "Read and stage" only submits for approval and 403s a direct
   publish; scope **All packages** — "Selected packages" can never create a
   package that does not exist yet; **Bypass 2FA** checked — without it npm
   intercepts the unattended publish with an interactive OTP prompt (`EOTP`),
   and the flag cannot be added to an existing token; **no IP allowlist** —
   GitHub-hosted runners' IPs cannot be pre-approved. (Classic "automation"
   tokens were removed by npm in December 2025; they are no longer creatable.)
3. **npm Trusted Publisher**: on npmjs.com → the package → Settings → Trusted
   publisher → GitHub Actions, configure: owner chipwilson, repository
   task-linear-sync, workflow filename release.yml, environment name release,
   and enable `npm publish` in the allowed actions (configurations created since
   September 2026 default to stage-only publishing otherwise). A new trusted
   publisher expires unless its first successful publish lands within 2 days —
   configure it immediately before that first OIDC release.
4. **Hardening after migration** (recommended by npm): set the package to
   require two-factor authentication and disallow token publishing, and confirm
   the source repository stays public — provenance attestations are not minted
   from private repositories.

The manifest's repository.url must exactly match the GitHub repository (npm
verifies it for OIDC publishes), which is why it is pinned by the release
workflow-shape test.

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
5. A rejected publish's verdict code names the repair. `PUBLISH_REJECTED` is a
   versioning mistake (the registry already has that version) — cut a new
   version. `PUBLISH_FORBIDDEN` (credentials refused, E403) and
   `PUBLISH_2FA_REQUIRED` (OTP interception, EOTP) are PRE-WRITE refusals —
   nothing reached the registry: fix the token or account policy per the
   one-time setup above, update the secret, and re-dispatch. Only
   `PUBLISH_AMBIGUOUS` (transport interruption) means reconcile against the
   registry first — never blindly retry.

Versioning policy (what `stable` means, the 0.x posture, the 1.0.0 condition):
[docs/versioning.md](versioning.md).
