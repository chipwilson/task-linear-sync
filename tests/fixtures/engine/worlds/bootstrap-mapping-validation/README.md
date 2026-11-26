# bootstrap-mapping-validation (feature 024, US2 / C4)

Linear teams are seeded with DIFFERENT incomplete default workflows:
`ALPHA` offers the full default set; `BETA` lacks `Canceled`; `GAMMA` lacks
`In Progress`; `DELTA` offers only `Todo`/`Done` (and carries no canceled
state — the type-category line). One configured team is enough to refuse the
whole bootstrap; the error groups every team's outcome in ONE pass (FR-009),
before any mutation or state-directory write (FR-010). Pushing the missing
states into the fake world ("the operator fixed Linear") must make an
otherwise-identical re-run succeed (SC-004).
