# history-rollover

History-page rollover world (quickstart 2.5, FR-009/FR-010; drives T035). Config override
`historyLogMaxEntries: 3` (world.json `config`) pins the entry threshold. Two matched tasks
have pre-existing history chains seeded via attachments: task 1.1 `[ACME-1]` page 0 holds
exactly three seeded events (AT threshold, no continuation page), and task 1.2 `[ACME-2]` pages
0 AND 1 each hold exactly three. The run lands one event per task — 1.1 is `spec-changed`
(`description-updated`), 1.2 is the checkbox control whose checkpoint says checked/completed
while the spec is unchecked (`checkbox-changed` ⇒ Backlog; description identical) — so both
appends exceed the threshold and roll deterministically: 1.1 gains page 1 holding only the new
event; 1.2's `getAttachmentByUrl` walk (0→1, last existing) pushes it to a NEW page 2, while
every prior entry stays byte-identical on its page (append-only, Principle IV). Continuation
attachments carry the data-model §7 page record `{ taskUuid, page, history }` under the same
namespace key at the deterministic continuation URLs.
