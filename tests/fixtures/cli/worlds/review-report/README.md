# review-report world

Multi-project, multi-milestone review-report fixture for feature 009 (contract
`specs/009-operator-cli-plan-report/contracts/plan-review-report.md` §2):

- Groups span two projects (`proj-alpha`, `proj-beta`) and three milestones
  (`alpha-feature`, `beta-feature`, `gamma-feature`) to prove the project→milestone
  sorting of `groups[]`.
- Task `2.1` claims `ACME-90` (routed to `proj-alpha`) while the issue lives in
  `proj-beta` — project-gated pairing keeps it **unmapped**, and its mapped descendant
  `2.1.1` (`ACME-91`) makes `parentMapped: true`.
- Task `2.2` claims `ACME-92` the same way, but only the **sibling** `2.3` (`ACME-3`) is
  mapped — `parentMapped` must stay `false` (spec edge case).
- Task `1.2` carries an unresolved git-style conflict block → surfaced in both artifacts.
- `SENTINEL-RAW-BODY-*` / `SENTINEL-RAW-DESCRIPTION-*` strings are the SC-001 absence
  sentinels; `Secret Lab SECRET555` (team metadata project name) exercises output
  screening.
