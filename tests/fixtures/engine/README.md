# Engine fixture worlds (008)

Fixture worlds drive the sync-engine suites through `tests/helpers/engine-harness.ts`.
The harness is the single reader of this layout; see its header docblock for the normative
`world.json` schema.

## Conventions (Principle III — zero organization-specific literals)

- **Placeholders only.** No real organization identifiers, team keys, tokens, or UUIDs
  anywhere — not in spec files, `world.json`, or expected artifacts. Use the harness
  deterministic seed helpers (e.g. synthetic uuids, `TEAM-A`/`ACME`-style placeholder keys
  as used by the 006/007 fixtures).
- **No secrets, even shaped ones**, except the deliberate secret sentinels used by the
  screening security tests (they are harness-generated markers, never real credentials).

## Layout

Each world lives in `worlds/<world-name>/`:

```text
worlds/<world>/
├── repo/        # spec-side files materialized into a temp fixture repo (tasks/*.md)
├── world.json   # fake-Linear seed: workflow states, issues, attachments, scripted failures
├── expected/    # optional expected artifacts (plan fragments, marker goldens)
└── README.md    # one-paragraph scenario description
```

## Worlds

| World | Scenario |
|---|---|
| `first-run-bootstrap/` | No checkpoints — bootstrap mode seeds the tracker |
| `linear-changed/` | Only the issue description moved — `linear-changed` |
| `spec-changed/` | Only the task section moved — `spec-changed` |
| `both-changed/` | Both sides moved — `both-changed` |
| `unresolved-block/` | Task section already holds a conflict block — frozen run |
| `completion-toggle/` | Checkbox toggled, description unchanged — workflow-state op |
| `indeterminate-create/` | Create failure + identity reconcile finds 0 or >1 |
| `history-rollover/` | History exceeds entry/byte thresholds — continuation pages |
| `formatting-noise/` | Round-trip formatting drift only — zero conflicts (SC-002) |
| `rollback-full/` | Full apply → total-restoration rollback (SC-003) |
| `rollback-interrupted/` | Rollback interrupted at every step index — resumable |
