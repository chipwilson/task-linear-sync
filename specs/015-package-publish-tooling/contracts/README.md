# 015 Contracts — Package Publish Tooling (release-time interfaces)

This feature adds NO new runtime subpath, no new dependency, and no new engine behavior. What
it adds is the **release plane**: the pipeline orchestrator and its verdict vocabulary, the
artifact-verification contract, the version derivation chain, and the release-gate workflow
triggers. The only runtime-source touches are additive and non-frozen: the CLI global
`--version` flag and `SERVER_VERSION`'s derivation (the exported NAME is unchanged; the MCP
surface snapshot does not freeze the version VALUE — verified, no mention).

| File | Covers |
|---|---|
| [release-pipeline.md](./release-pipeline.md) | `scripts/release.mjs` CLI contract, stage catalog, verdict/exit codes, workflow triggers, secret posture |
| [artifact-verification.md](./artifact-verification.md) | ArchiveManifest allow-list rule, consumer-environment checks, defaults-scan over archive, published-posture assertions |
| [versioning-policy.md](./versioning-policy.md) | version derivation chain, changelog grammar, LICENSE requirements, `docs/versioning.md` content contract |

**Frozen-surface ledger**: zero amendments. `docs/contract-amendments.md` gains no entry —
002 surfaces untouched; 011/012 snapshots unchanged (`SERVER_VERSION` name preserved, value
not frozen); `action.yml` untouched (tag consistency enforced via preflight, 013 posture);
009 `command-surface.md` global-flags table gains `--version` (addition, not redefinition —
CLI is a Wave-4 surface outside the freeze regime).

Enforcement map: stage order + verdict machine → `tests/contract/release-pipeline.test.ts`
(SC-002 harness drivers); archive + consumer-env + scan →
`tests/contract/archive-verification.test.ts` + `tests/e2e/release-dry-run.test.ts`
(SC-001/SC-002); version derivation + drift grep → `tests/contract/version-drift.test.ts`
(SC-004); changelog grammar + tag gate → `tests/contract/changelog.test.ts` +
`tests/contract/release-pipeline.test.ts` (US3); license/allow-list/posture/policy docs →
`tests/contract/archive-verification.test.ts` + `tests/contract/versioning-policy.test.ts`
(US4); CI wiring + secret absence → `.github/workflows/{ci,release}.yml` +
`tests/contract/release-pipeline.test.ts` workflow-shape checks (SC-003).
