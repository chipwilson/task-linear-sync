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

## Log — 002 frozen surface

Amendments to the 002 frozen contracts, same entry format as the per-surface logs below
(`YYYY-MM-DD · surface · element-id · before → after · rationale · migration`), recorded in
the same change as the contract doc + module + snapshot trio (three-artifact rule).

- 2026-11-10 · domain · `type.FrameworkId` · `"bmad" | "spec-kit" | "open-spec" | "kiro" |
  "generic"` → `"bmad" | "spec-kit" | "open-spec" | "kiro" | "spec-superpower" | "generic"` ·
  A-018-0 (feature 018): `spec-superpower` ships as a built-in, default-enabled identity
  (FR-001); the widening was pre-authorized as an amendment candidate in
  `src/discovery/types.ts`. Mirrored in lockstep within this entry: `src/domain/task.ts`,
  `specs/002-core-domain-contracts/contracts/task-model.md`, the `plan-report.schema.json`
  `framework` enum, `specs/002-core-domain-contracts/data-model.md` §1, and the regenerated
  `tests/contract/snapshots/frozen-surface.json` · no migration: the member is additive,
  existing records and seeds are unchanged

- 2026-11-10 · discovery (003 contract) · `selectAdapter` zero-match rule +
  `DEFAULT_PRECEDENCE` · zero matches → unconditional `generic` fallback; precedence
  `kiro → open-spec → spec-kit → bmad → generic` → zero matches → `generic` ONLY when the
  basename still matches generic's effective `taskFilePatterns`, else unclaimed (`null`,
  omitted from `DiscoveryResult.files`, no diagnostic); precedence `kiro → open-spec →
  spec-kit → bmad → spec-superpower → generic` · A-018-1 (feature 018): a date-named plan
  outside the configured plans root must never enter the sync through the catch-all
  (spec-superpower-adapter.md Rule 2, US1-AC4); amends
  `specs/003-task-discovery-framework-adapters/contracts/framework-adapter.md` and
  `docs/framework-adapters.md` in the same change · migration: pre-existing candidates are
  unaffected (every built-in row's patterns include `tasks.md`/`TASKS.md`); only files that
  matched NO enabled rule while their basename also missed generic's patterns — previously
  claimed noise — change behavior

- 2026-11-10 · parsing (004 contract) · `TaskFileAdapter.identityFileScope` · absent →
  optional whitelisted member consumed at the `parseTaskFile` seed call site · A-018-2
  (feature 018): plans sharing a derived feature name need file-scoped seed inputs to keep
  pairwise-distinct `Stable_UUID`s (FR-010); amends
  `specs/004-task-parsing-line-rendering/contracts/adapter-consumption.md` rule 2 —
  `taskStableSeed` and its frozen layout are unchanged · no migration: adapters omitting the
  member (all current ones) keep byte-identical seed inputs

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
- 2026-11-06 · history · `status.401` / `status.403` · case-sensitive `Bearer ` prefix
  with any `Authorization` header counting as a presented credential → MCP-canonical
  `<ows>* bearer <token>` (case-insensitive, whitespace-tolerant); a malformed scheme
  or empty token now reads as NO credential ⇒ `401` challenge (was `403`) · 014 R5
  cross-surface bearer parity · envelopes themselves unchanged; well-formed credentials
  keep the exact 401-absent / 403-invalid split

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
- 2026-11-06 · mcp · `protocol.default` / `error.-32602` · a PRESENT non-string
  `initialize` `protocolVersion` answered the fallback → answered `-32602` invalid
  params without consuming the handshake (a corrected retry may initialize); a
  MISSING value keeps the lenient fallback · 014 quickstart Scenario 5 shape fault ·
  clients sending string versions (supported or not) see unchanged behavior

