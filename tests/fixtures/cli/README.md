# CLI fixture worlds (feature 009)

World directories under `worlds/` follow the `tests/fixtures/engine/worlds/` conventions
(`world.json` schema authority: `tests/helpers/engine-harness.ts` header docblock — the
009 harness reuses `buildWorld` unchanged).

Hygiene contract (constitution Principle III + the distributed-defaults scan):

- **Placeholder identifiers only.** Zero real organization identifiers, team keys,
  project keys, tokens, credential values, or real UUID values. Team keys are `TEAM-A`,
  issue keys `ACME-<n>`, projects `proj-*`, ids use the 007 synthetic scheme
  `ac000000-0000-4000-8000-<12 decimal digits>`.
- Sentinel raw bodies/descriptions use plain prose (`SENTINEL-RAW-BODY…`,
  `SENTINEL-RAW-DESCRIPTION…`) so the SC-001 whole-corpus absence scan can grep them
  without tripping secret/UUID-shaped release scans.
- Non-blocking screening sentinels use the shared test screener shape `SECRET<digits>`
  (redacted by `makeScreener`); never the blocking `BLOCKED` token in artifact material.
- `repo/` is materialized into a temp tree by the harness; tests never write the source
  tree. `stateDirectory` is harness-owned and forbidden in `world.json`.

Worlds owned by 009:

- `review-report/` — multi-project, multi-milestone task tree; one unmapped parent whose
  only mapped relation is a **mapped sibling** (must stay `parentMapped: false`), one
  parent mapped **through a descendant** (`parentMapped: true`), one unresolved-conflict
  task with git-style markers, sentinel raw bodies/descriptions for the SC-001 scan, and
  a `SECRET<digits>`-shaped project name for output-screening assertions.
- `zero-task/` — configured repo with an empty `specs/` tree (zero-task plan edge case).

Apply/rollback scenarios reuse the 008 worlds (`tests/fixtures/engine/worlds/`) through
the harness pass-through — import-only, never edited here (ROADMAP rule 2).
