# Tracker Recorded-Fixture Corpus (007)

Recorded HTTP-scenario fixtures and fake-world seeds for the issue-tracker integration port
(`src/tracker/**`). Driven by `createRecordedTransport` / `loadScenario` from
`task-linear-sync/tracker/testing` plus `tests/helpers/tracker-harness.ts`. **Zero live
platform calls exist in any tier** — every recorded pair is replayed verbatim and every
fake world is in-memory (constitution VI, "Hermetic pipelines").

## Scenario directory layout (data-model.md §8)

```text
scenarios/<name>/
├── scenario.json          # { name, notes?, placeholderIdentities: ["acme-team", …] }
├── NN-<operationName>.json # ordered pairs (see below); NN = 01, 02, … ordering
└── world.json             # optional fake-world seed for the SAME shape of world
```

Ordered pair files (`NN-<operationName>.json`):

```jsonc
{
  "request":  { "operationName": "issues", "variables": { "teamKey": "acme-team", "after": null } },
  "response": { "status": 200, "headers": { "retry-after": "3" }, "body": { "data": { } } }
}
```

- `operationName` + `variables` identify the GraphQL operation the driver matches against.
- `variables` entries are **pins**: the driver matches on exactly the keys present here and
  ignores the rest of the request's variables. Pin identity keys (`teamKey`, `url`, `id`,
  `after`, …) so retries of the same operation replay in file order.
- `response.status` / `headers` / `body` replay verbatim — `Retry-After` and 429/5xx codes
  are first-class fixture data (they drive the real resilience stack under an injected fake
  clock/rng/sleeper, so nothing is ever slept at real durations).
- **`"status": 0` is a synthetic network error**: the driver throws a transport-level
  `Error` instead of returning a response (exercises the `network` classification row).
- **Redaction rule:** headers never include Authorization — redacted at record time. A
  fixture carrying an `authorization` or `cookie` header key (case-insensitive) fails the
  hygiene contract scan; the driver never reads or replays the bearer token at all.

`world.json` (fake seeds) is a plain JSON program for `createFakeLinearPort`:
`{ teams, issues, attachments, scriptedFailures?, pageSize?, maxRetries? }`.

## Driver matching (tracker-testing.md §2)

Matching is the **earliest unconsumed pair whose `operationName` matches and whose pinned
variable keys deep-equal the live request**. An unmatched request throws `FixtureMiss` —
loud, never silent: a fixture that no longer reflects the adapter's requests must fail.

## Placeholder identities only (hygiene-scanned)

- Teams: `acme-team`, `globex-team`, `initech-team` … Projects: `proj-alpha`, `proj-beta`, …
- Issue keys: `ACM-123`-shaped (`ACM-<n>`, `GLX-<n>`, `INI-<n>`).
- Synthetic UUIDs only, scheme `ac000000-0000-4000-8000-<12 hex>` (as produced by
  `syntheticUuid(n)` from `task-linear-sync/tracker/testing`); attachment hosts use the
  frozen placeholder host `https://sync.example.invalid`.
- No `lin_api_`-shaped token values, no email shapes, no real organization identifiers —
  `tests/contract/tracker-hygiene.test.ts` walks this whole corpus and the shipped
  `src/tracker` constants and fails otherwise (release-gate posture).
