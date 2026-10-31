# formatting-noise

Round-trip platform noise ONLY — never a content change (research R5 noise classes, the
same list fuzzed in `tests/unit/engine-normalize.test.ts` NOISE_OPS). The repo section
carries CRLF terminators, trailing whitespace, a padded blank run, and a dropped final
newline; the two issue descriptions carry *different* noise classes (NFD echo + CRLF +
extra trailing newlines; trailing whitespace + blank padding). Every variant normalizes to
the same baseline, so classification lands on `null` in bootstrap mode (both sides
normalized-identical) AND in sync mode when `expected/checkpoint-seed.json` is seeded via
the harness `seedCheckpoints` helper (hashes are precomputed over the normalized
baselines) — zero conflicts, zero planned rewrites, byte-stable files (SC-002; T018,
T027). Fixed clock; placeholder identities only.
