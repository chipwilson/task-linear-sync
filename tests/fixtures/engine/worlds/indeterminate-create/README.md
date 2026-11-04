# indeterminate-create

Indeterminate-create world (quickstart 2.2, FR-012, data-model §8; drives T034). Sync mode
(one seeded checkpoint for the healthy matched task). Unmatched task `2.1` is hit by the
world.json `createFailures` script (`titleIncludes: "Probe the indeterminate gauge"`): the
decorated `createIssue` throws `HarnessCreateFailureError` WITHOUT reaching the fake, and the
world is seeded so `findIssuesByAttachmentUrl(canonicalAttachmentUrl(2.1))` reconciles ZERO
matches — no issue or attachment anywhere in the seed mentions the probe task UUID ⇒ the
create intent lands `indeterminate` (terminal for the task; never auto-replayed in-run or on
resume). Child `2.1.1` hangs off `2.1` and must never see a create call (its creation aborts
with the parent). Healthy task `2.2` `[ACME-1]` carries a spec-side drift paragraph so its
`overwrite-linear` updateIssue + page-0 attachment rewrite still LAND, proving the indeterminate
abort stops only its own task (report entry, zero replay creates, run continues).
