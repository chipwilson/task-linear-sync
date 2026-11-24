# spec-kitty-event-status

023 status-authority world (quickstart scenario 3). Mission
`002-auth-system` carries three work-package documents whose front matter and
whose `status.json` **deliberately contradict** the append-only
`status.events.jsonl` (all say `planned`):

- `WP01-setup.md` — the log carries NO lane event (only an envelope creation
  and an annotation): state untouched.
- `WP02-oauth.md` — last lane `in_progress` (preceded by an older `planned`),
  mixed with envelope/annotation lines and ONE malformed line. Pre-seeded in
  `Backlog` with its durable anchor: the plan moves it to `Doing` through the
  team's `lanes` map; history records `lane-changed`.
- `WP03-teardown.md` — last lane `canceled`; the `lanes` map has NO
  `canceled` entry: untouched + `lane-state-unmapped`.

The log also carries a lane event for `WP99`, which has no document —
ignored with a reported finding (the log never conjures issues).
