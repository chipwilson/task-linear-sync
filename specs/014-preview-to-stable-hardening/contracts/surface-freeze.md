# Contract: Surface Freeze for 011/012 (FR-002)

## 1. Frozen inventories (the guaranteed scope of each Stability section)

**MCP surface** (`specs/012-*/contracts/{tool-definitions,jsonrpc-stdio,transport-auth,
apply-gating,component-api}.md`):

| Category | Snapshot key | Derived from (runtime, at test time) |
|---|---|---|
| Tool name + description + `inputSchema` | `tools[]` | `TOOL_DEFINITIONS` (exported via `task-linear-sync/mcp`) |
| Visibility default per tool | `tools[].visibleByDefault` | `isVisible()` at default settings |
| Protocol revision set + default | `protocolVersions[]` | `SUPPORTED_PROTOCOL_VERSIONS`, `DEFAULT_PROTOCOL_VERSION` |
| JSON-RPC error codes | `jsonrpcErrorCodes[]` | closed code constants in `src/mcp/jsonrpc.ts` |
| HTTP status → constant body | `httpStatusBodies` | refusal table in `src/mcp/errors.ts` / `http.ts` |
| `mcp.*` config keys + defaults | `configKeys` | `src/config/defaults.ts` mcp group (post-amendment) |
| Transports | `transports[]` | `["stdio","http"]` via `mcp.transport` guard set |

**History surface** (`specs/011-*/contracts/{http-surface,access-control,
history-reconstruction,component-api}.md`):

| Category | Snapshot key | Derived from |
|---|---|---|
| Route patterns + methods | `routes[]` | `parseHistoryRoute` behavior table + `create.ts` dispatch |
| Status → envelope body | `statusBodies` | `ERROR_ENVELOPES` (exported via `task-linear-sync/history-server`) |
| SSE content type / framing | `sseContentType` | `src/history-server/sse.ts` |
| `web.*` config keys + defaults | `configKeys` | `src/config/defaults.ts` web group (post-amendment) |
| Access modes | `accessModes[]` | `private` \| `public` guard set |
| Cookie attribute set | `cookieAttributes` | `auth.ts` builder base set; `Secure` recorded as conditional on `web.secureCookies` |

## 2. Snapshot + comparator rules

- Files: `tests/contract/snapshots/history-surface.json`, `tests/contract/snapshots/mcp-surface.json`.
- Built from the runtime registries above — never hand-written; hand-editing is invisible to
  regeneration and shows up as drift at the next run.
- Comparator (`tests/helpers/surface-freeze.ts`): deterministic ordering (sorted keys/ids);
  drift lines `ADDED <id>` / `REMOVED <id>` / `CHANGED <id>: <before> → <after>`, one per
  element, sorted.
- Regeneration: `UPDATE_SURFACE_SNAPSHOTS=1 npm run test:contract` — deliberate, mirrors
  `UPDATE_FROZEN_SNAPSHOT`; the refresh writes BOTH surfaces only when each has an amendment
  entry covering its drift ids (rule below).

## 3. Amendment-entry rule (extends `docs/contract-amendments.md`)

CI passes iff `driftIds ⊆ amendmentEntryIds` (entries in the per-surface log section, format
per data-model §2). Any drifted `element-id` without its entry keeps CI red. Regenerating a
snapshot without the entry re-opens the failure on the next drift check — regeneration does not
interpret entries, only humans do; the test compares ids, so a fresh snapshot without an entry
passes once regenerated… therefore the entry check is structural, not diff-based: the freeze
test additionally asserts every amendment-entry id in the log EXISTS in the current snapshot
(`entry-id ⊆ snapshot ∪ history`), so an entry can never be silently dropped from the log, and
the regeneration script prints drift ids for the human to cite. (Documented honesty: the log +
review is the audit trail, mirroring 002's "deliberate, never automatic" posture.)

## 4. Mutation checks (SC-001, in-suite, run on every CI leg)

| # | Injected drift (synthetic object into comparator input — never into src/) | Expected drift line |
|---|---|---|
| 1 | drop one tool from the tools inventory | `REMOVED tool.task_sync_status` |
| 2 | rename one route pattern | `REMOVED route.…` + `ADDED route.…` |
| 3 | flip one envelope body for a status | `CHANGED status.429 …` |
| 4 | add an error code | `ADDED error.<NEWCODE>` |
| 5 | remove a config key | `REMOVED config.web.maxCacheEntries` (surface-appropriate) |
| 6 | change a tool's `inputSchema` | `CHANGED tool.task_sync_plan.inputSchema …` |

Both surfaces run their applicable rows; each row asserts the EXACT line (not just "some
failure"), proving every frozen element category is individually guarded.

## 5. Relationship to existing guards

`mcp-tool-schema`, `history-route-conformance`, and `*-packaging` contract tests stay exactly as
written (they predate 014 and remain first-line defenses); the freeze snapshots SUPERSET them
with routes/status/codes/config keys. The 002 `frozen-surface` regime is untouched except the
R1 amendment itself.
