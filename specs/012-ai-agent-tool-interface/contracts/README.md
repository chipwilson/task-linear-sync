# 012 Contracts — AI-Agent Tool Interface (012-local interfaces)

Normative behavior behind `src/mcp/`. Nothing here amends a frozen 002/007/008/009
contract: the gate vocabulary, `GateRequest`/`ApplyResult`, plan/report schema,
`StateStore`, `Linear_Port`, `SecurityScreener`, and `LastRunMarker` shapes stay exactly as
frozen and are consumed verbatim. This feature ADDS only: the JSON-RPC/MCP wire posture,
the tool definitions + visibility rules, the session-scoped plan-reference store, the
`mcp` config group, and the transport/token gate.

| File | Covers |
|---|---|
| [jsonrpc-stdio.md](./jsonrpc-stdio.md) | Framing, handshake/lifecycle, method table, JSON-RPC error codes |
| [tool-definitions.md](./tool-definitions.md) | The four tools: input schemas, output shapes, visibility gating |
| [apply-gating.md](./apply-gating.md) | Apply pipeline: enablement → session store → engine `GateRequest` (one engine pass) |
| [transport-auth.md](./transport-auth.md) | stdio default, http bearer gate, pre-auth refusal, credential-leak rules |
| [component-api.md](./component-api.md) | `createAgentToolServer(deps)`, settings view, hygiene invariants |

Enforcement tier map (per quickstart.md traceability): framing/lifecycle/error codes →
`tests/unit/mcp-jsonrpc.test.ts` + `tests/unit/mcp-framing.test.ts` +
`tests/integration/mcp-stdio.test.ts`; tool shapes/visibility →
`tests/unit/mcp-tools.test.ts` + `tests/contract/mcp-tool-schema.test.ts` +
`tests/e2e/mcp-user-stories.test.ts` (SC-003); apply pipeline →
`tests/unit/mcp-plan-store.test.ts` + `tests/unit/mcp-handlers.test.ts` +
`tests/integration/mcp-apply.test.ts` (SC-001); transport/auth →
`tests/integration/mcp-http.test.ts` + `tests/contract/mcp-credential-sentinel.test.ts`
(SC…FR-004/005); config → `tests/unit/mcp-config.test.ts`; packaging/budget/hygiene →
`tests/contract/mcp-packaging.test.ts` + `tests/contract/mcp-hygiene.test.ts` +
defaults-scan additions (FR-001 zero-write posture, Principle III/V).
