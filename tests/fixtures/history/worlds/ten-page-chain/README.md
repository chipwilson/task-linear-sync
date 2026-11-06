# ten-page-chain

Seed parameters (built in-process by `tests/helpers/history-harness.ts`
`buildChainWorld`):

```json
{ "pages": 10, "eventsPerPage": 1000, "interleave": true }
```

10 pages × 1000 events = 10 000 distinct events. Page 0 is the canonical
attachment (`SyncStatePayload`); pages 1–9 are continuation attachments
(`{ taskUuid, page, history }` records under the namespace key). Event
`at` times interleave across pages (page slices overlap chronologically), so
merge order must be proven by sorting, not assumed from chain order. Every
1000th event is a `SC001-MARKER-<n>` rollback-kind event (10 markers). Merge
must present exactly 10 000 events, each exactly once, in non-decreasing
`at` order (SC-001).
