# spec-kitty-two-level

023 two-level promotion world (quickstart scenario 2). Mission
`002-auth-system` carries two canonical work-package documents:

- `WP01-setup.md` — block-list roster `T001–T004`, `### Subtask Tnnn – Title`
  anchors with step guidance, and an Activity-Log **restatement**
  (`#### Subtask T001: …`) that must stay mirrored parent content.
- `WP02-oauth.md` — flow-form roster `[T005, T006, T007, T099]`, anchors
  `T005–T007`, roster-only id `T099` with no anchor (excluded, never an
  empty issue), and a `## Review Report` anchor-region stop.

Config pins `maxTaskIssueDepth: 2`; team `acme` has `workflowStates` and
**no `lanes` map** — no issue state may ever move in this world. The
cap-toggle test (`engine-spec-kitty-cap-toggle.test.ts`) reconfigures the
same world to 1 and back to 2 through programmatic config overrides.
