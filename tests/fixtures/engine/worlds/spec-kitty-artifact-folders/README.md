# spec-kitty-artifact-folders

023 artifact-hygiene world (quickstart scenario 1, SC-007/FR-015). Three
missions reproduce the upstream naming styles — `042-auth-system` (numeric
prefix), `auth-system-01KQ2VNJ` (ULID suffix), `bare-slug-mission` (bare
slug) — each carrying:

- the full inert artifact set (`tasks.md` roll-up, `wps.yaml`,
  `status.json`, `status.events.jsonl`),
- one canonical `tasks/WP01-*.md` document (anchors `T001`/`T002`),
- a per-WP artifact sub-folder `tasks/WP01-x/review-cycle-1.md` +
  `reviewer-feedback-cycle-1.md` **duplicating** the canonical
  `work_package_id` — the exact upstream shape that made the reference
  repository unplannable at 0.6.0,
- `tasks/README.md` (claimed notes, zero tasks).

`world.json` keeps the shipped default depth. Plan builds must show zero
collision refusals, exactly one task per mission at every allowed depth, and
no `generic` fall-through for any file under the mission `tasks/` folders.
