# Contract amendments (FR-008)

The modules under `src/domain`, `src/config`, `src/state`, `src/urls`, `src/gates`, and
`src/ports` are the **frozen contract surface** of feature 002: every shape and behavior
they define mirrors a normative document in
[`specs/002-core-domain-contracts/contracts/`](../specs/002-core-domain-contracts/contracts/).
Later features (003–013) consume these contracts and may **not** edit them.

## The amendment rule

A contract change is a **constitution-governed cross-feature amendment**. One amendment
updates all three artifacts **together, in one change**, noted against feature 001:

1. the contract document in `specs/002-core-domain-contracts/contracts/`,
2. the `src/` module that mirrors it,
3. the contract-test snapshot `tests/contract/snapshots/frozen-surface.json`.

Nothing else may ride along with the amendment; behavior changes additionally require
spec/plan updates for the affected consumer features.

## How drift is enforced

`tests/contract/frozen-surface.test.ts` parses the generated `.d.ts` of every frozen
module and diffs the exported-name sets against the checked-in snapshot. Any addition,
removal, or module rename fails the suite with a per-module drift list:

```
config/schema: ADDED NewThing
domain/task:   REMOVED IssueRef
```

Regenerating the snapshot is deliberate, never automatic:

```sh
UPDATE_FROZEN_SNAPSHOT=1 npm run test:contract
```

Because `npm test` runs that suite on every CI run, an unnoticed edit to a frozen module
breaks the build — amendments are visible by construction (feature 002 SC-004
"contract-drift" scenario).

## Companion freeze tests

- `tests/contract/report-schema.test.ts` — the plan-report schema forbids raw
  task-body/issue-description fields structurally (`additionalProperties: false` +
  schema scan).
- `tests/contract/package-surface.test.ts` — the exports map must keep resolving for the
  root and all six subpaths.
- `tests/contract/defaults-scan.test.ts` — shipped defaults stay free of real
  organization identifiers.

## Surface contract freezes (011/012) — feature 014

The history server (011) and the MCP server (012) carry the same freeze regime as the 002
surface, one snapshot each, built **from the runtime registries** at test time and compared
against checked-in JSON (never hand-written):

| Surface | Frozen contract docs | Snapshot |
|---|---|---|
| history | `specs/011-sync-history-web-page/contracts/{http-surface,access-control,history-reconstruction,component-api}.md` | `tests/contract/snapshots/history-surface.json` |
| mcp | `specs/012-ai-agent-tool-interface/contracts/{tool-definitions,jsonrpc-stdio,transport-auth,apply-gating,component-api}.md` | `tests/contract/snapshots/mcp-surface.json` |

Frozen elements: tool names/descriptions/`inputSchema`, route patterns + methods, HTTP status
codes + constant bodies/envelopes, JSON-RPC error codes, protocol-revision set, `web.*`/`mcp.*`
config keys + defaults, transports, SSE framing constants, cookie attribute set. The drift
posture mirrors 002 (`ADDED`/`REMOVED`/`CHANGED`, one line per element). Full format:
[`specs/014-preview-to-stable-hardening/contracts/surface-freeze.md`](../specs/014-preview-to-stable-hardening/contracts/surface-freeze.md).

### Amendment-entry rule

Changing a frozen element requires an **entry in the per-surface log below**, in the same
change as the snapshot regeneration (`UPDATE_SURFACE_SNAPSHOTS=1 npm run test:contract`):

```text
YYYY-MM-DD · surface · element-id · before → after · rationale · migration
```

`element-id` forms: `tool.<name>`, `tool.<name>.inputSchema`, `route.<pattern>`,
`status.<code>`, `error.<CODE>`, `config.<dotted.key>`, `protocol.<revision>`,
`transport.<name>`, `sse.<aspect>`. Entries are append-only; corrections append a new
entry. The freeze tests assert every logged entry-id still exists in the current snapshot,
so entries can never be silently dropped.

### Log — history surface

- 2026-11-06 · history · `config.web.maxCacheEntries` / `config.web.maxConcurrentWalks` /
  `config.web.maxConcurrentSseStreams` / `config.web.secureCookies` · absent → 500 / 8 / 16 /
  false · 014 R1 resource bounds, defaults preserve pre-amendment behavior · no migration
  (defaults keep every existing deployment byte-identical)
- 2026-11-06 · history · `status.429` · tracker-origin trigger only → also self-protective
  (walk/stream admission) with `Retry-After: 1` header · 014 R3 bounded inbound load ·
  clients treat the self-protective 429 exactly like the tracker one (retry later)
- 2026-11-06 · history · `sse.cookieAttributes` / `sse.cookieSecure` · base set → base set
  (default unchanged) with `sse.cookieSecure` gaining conditional `Secure` on
  `web.secureCookies: true` · 014 R4 TLS-front-door deployments · default `false` keeps
  the cookie byte-identical

### Log — mcp surface

- 2026-11-06 · mcp · `config.mcp.planReferenceTtlSeconds` / `config.mcp.planReferenceMaxEntries`
  · absent → 3600 / 1000 · 014 R6 bounded session store · no migration (defaults generous)
- 2026-11-06 · mcp · `protocol.2025-06-18` · `{2024-11-05, 2025-03-26}` →
  `{2024-11-05, 2025-03-26, 2025-06-18}`, default `2025-06-18` · 014 R7 current agent hosts ·
  older clients still negotiate their supported revision (unchanged echo/fallback)
- 2026-11-06 · mcp · `tool.task_sync_apply` (apply-gating step 3) · session-membership-only →
  session membership with TTL/capacity expiry folded in; refusal vocabulary unchanged
  (`PLAN_REFERENCE_UNKNOWN`) · 014 R6 long-lived servers · none; expired references refuse
  exactly as unknown ones always did

