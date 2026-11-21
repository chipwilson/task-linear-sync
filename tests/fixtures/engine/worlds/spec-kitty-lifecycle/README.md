# spec-kitty-lifecycle (022 US3)

Lifecycle world for work-package documents. Two missions (`002-alpha`, `003-beta`)
each carry a `tasks/WP01-*.md` document — same work-package number, different
missions, therefore two DISTINCT Stable_UUIDs (022 FR-007/US3-AC3). The tracker
starts empty.

`tests/integration/sync-spec-kitty-lifecycle.test.ts` drives the scenario:
bootstrap apply (one issue per document) → full no-op re-plan → in-repo lane flip
(`lane: planned → claimed`), Activity Log / Review Report appends and an
in-collection rename `WP01-one.md → WP01-one-tooling.md` → the SAME issue updates
content only, zero new issues, repo bytes untouched (no confirmation prefixes),
and a settling re-plan is a full no-op (022 SC-003/FR-010, quickstart step 5).
