# secret-shape

T039 [US2] security-posture world (constitution I, research R12). Sync mode (seed
`expected/checkpoint-seed.json`): BOTH task sections moved since the last sync ⇒ two
`spec-changed` classifications with the built-in sync action `overwrite-linear`, so apply
would hand each screened section to `port.updateIssue`. Task 1.1's added paragraph carries
a fabricated high-entropy `api_key=…` assignment — the built-in screener's blocking
`secret-token` category — so exactly that op must fail unsent with a category-only detail.
Task 1.2's added paragraph carries an `ops@example.invalid` address (non-blocking,
`[redacted:email]`) plus a `REVIEW REQUIRED` term (annotated `…[review-term]`), proving
the clean sibling still syncs and that the transmitted text is post-screen output. The
`api_key` value is a synthetic placeholder, never credential material (Principle III).
Titles, checkboxes and state types are stable so only the description channel moves.
