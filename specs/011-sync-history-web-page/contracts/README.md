# 011 Contracts — Sync-History Web Component (011-local interfaces)

Normative behavior behind `src/history-server/`. Nothing here amends a frozen 002/007/008
contract: the URL scheme, `SyncStatePayload`, `SyncHistoryEvent`, continuation-page record,
`Linear_Port`, and `SecurityScreener` shapes stay exactly as frozen and are consumed
read-only.

| File | Covers |
|---|---|
| [http-surface.md](./http-surface.md) | Routes, content negotiation, status codes, JSON/HTML/SSE shapes, response headers |
| [access-control.md](./access-control.md) | Private/public modes, bearer token, stateless cookie session, leak rules |
| [history-reconstruction.md](./history-reconstruction.md) | Chain walk, page-record parsing, chronological merge, rendering rules |
| [component-api.md](./component-api.md) | `createSyncHistoryServer(deps)`, settings view of the frozen `web` group, hygiene invariants |

Enforcement tier map (per quickstart.md traceability): route/status/shape rules →
`tests/contract/history-route-conformance.test.ts` + `tests/integration/history-us1|sse|*`;
access rules → `tests/unit/history-auth.test.ts` +
`tests/integration/history-auth.test.ts` + `tests/contract/history-credential-sentinel.test.ts`;
reconstruction rules → `tests/unit/history-reconstruct.test.ts` +
`tests/integration/history-us1.test.ts` (SC-001); stateless/hygiene invariants →
`tests/contract/history-hygiene.test.ts` + `tests/integration/history-serverless-shape.test.ts`.
