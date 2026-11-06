# Contract: Tool definitions, visibility, and call posture

Module: `src/mcp/tools.ts` + `src/mcp/handlers.ts` (research R3/R4/R7). Tool names are
frozen by the spec: `task_sync_plan`, `task_sync_status`, `task_sync_inventory`,
`task_sync_apply`. Descriptions and examples use placeholder identifiers only.

## 1. `tools/list`

1. Result: `{ tools: [ { name, description, inputSchema }, … ] }` — only definitions whose
   visibility predicate passes: `visible = !def.mutating || settings.enabled`
   (data-model §4). At defaults the list is EXACTLY the three read-only tools —
   `task_sync_apply` is NOT advertised (FR-002, SC-003).
2. `inputSchema` is a JSON-Schema object with `additionalProperties: false` per tool
   (§2 shapes). No `outputSchema` claims (MCP 2025-03-26 optional field stays unused).
3. The listing is a pure function of the resolved settings — identical for every request
   while settings are unchanged; there is no dynamic visibility.

## 2. `tools/call` — input schemas

```jsonc
// task_sync_plan — {}
{ "type": "object", "additionalProperties": false }

// task_sync_status — {}
{ "type": "object", "additionalProperties": false }

// task_sync_inventory — {}
{ "type": "object", "additionalProperties": false }

// task_sync_apply — all three gate arguments stay explicit (never implied)
{
  "type": "object",
  "additionalProperties": false,
  "required": ["planReference", "confirmationKey"],
  "properties": {
    "planReference":       { "type": "string", "pattern": "^[0-9a-f]{64}$" },
    "confirmationKey":     { "type": "string", "minLength": 1 },
    "acceptLowConfidence": { "type": "boolean", "default": false }
  }
}
```

1. Unknown arguments / shape violations ⇒ `isError: true` result listing ALL problems in
   one message (`INVALID_ARGUMENTS`, complete-listing posture). Structural JSON-RPC faults
   (bad `params` type) remain `-32602` protocol errors (§jsonrpc §4 boundary: shape of the
   ENVELOPE vs shape of the tool ARGUMENTS).
2. Unknown tool names ⇒ `isError: true` ("unknown tool"), never `-32601` (the method
   `tools/call` itself was valid).
3. A call to `task_sync_apply` while `enabled: false` ⇒ `isError: true` naming
   `MUTATING_TOOLS_DISABLED` + the config key `mcp.enabled` — with ZERO engine/port/state
   writes touched (SC-001/SC-003).

## 3. Outputs (data-model §6 payloads)

Every result is one `content` item of type `text` carrying stable-key JSON
(`schemaVersion: 1` first key) — machine input mirroring the review-report posture:
screened strings, content hashes instead of bodies/descriptions, durable ids, run-state
paths, ISO timestamps. No tool result contains a raw task body, raw issue description,
credential value, or token (FR-005; sentinel contract test).

- `task_sync_plan` (FR-001): runs the 009 `check` lane via `runCli` (research R4); exit 0
  and exit 8 (`CHECK_FINDINGS`) are both SUCCESS (findings are content); embeds the frozen
  `PlanReportJson` verbatim under `report` and records `planReference` in the session store
  (apply-gating.md §2).
- `task_sync_inventory` (FR-001): runs the 009 `inventory` lane via `runCli`; files/
  refusals/warnings lists carry paths, adapter ids, and counts only.
- `task_sync_status` (FR-001): frozen read-only composition (research R7):
  `readLastRunMarker` + `readPendingJob` + `readQueueLockRecord` + session-store count.
  Zero port calls, zero writes, no `GateRequest`, no mutation fields in the payload type
  (engine-gates rule 4).

## 4. Read-only guarantees (FR-001, SC-002)

1. Read-only tools execute with the 009 `runCli` read-only lane guard
   (`createReadOnlyGuard`; allowed write prefixes into the STATE directory only —
   `plan`/`check` artifacts land in run state, never the repository working tree).
2. Integration/e2e proofs: fake-port call log contains READ members only; repository-tree
   hash is byte-identical before/after (009 `hashTree` harness).
3. Tool error text never crashes the transport: every failure renders as an
   `isError: true` result (jsonrpc-stdio.md §3).
