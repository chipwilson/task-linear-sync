# Contract: Cross-Surface Bearer Parity (FR-008, research R5)

## 1. Shared parsing semantics (normative on BOTH surfaces)

```
Authorization: <ows>* bearer <token>   — matched case-insensitively, whitespace-tolerant
```

Canonical implementation (already live in `src/mcp/auth.ts`):
`/^\s*bearer\s+(.+)$/i`. `src/history-server/auth.ts` replaces its case-sensitive
`startsWith("Bearer ")` with the same semantics. Then: empty-capture ⇒ scheme rejection;
length-guard + `timingSafeEqual` comparison (server-side token from the env-var NAME only).

## 2. Verdict matrix (identical accept/reject verdicts on both surfaces' real transports)

| Header value (token otherwise valid) | Verdict |
|---|---|
| `Bearer <t>` / `bearer <t>` / `BEARER <t>` / `BeArEr <t>` | ACCEPT |
| `Bearer  <t>` (extra spaces) / `\tbearer <t>` / `  bearer <t>` | ACCEPT |
| `Bearer` (no token) / `Bearer ` (empty) | REJECT_401_SCHEME |
| absent header | REJECT_401_SCHEME |
| `Basic <t>` (wrong scheme) | REJECT_401_SCHEME |
| `Bearer <wrong>` | REJECT_403_TOKEN (history: existing leak-free 401/403 posture per access-control.md; MCP: 403 — parity is on VERDICT (reject + constant envelope + no dispatch), not on cross-surface status unification) |

- REJECT_401_SCHEME carries `www-authenticate: Bearer` on both surfaces.
- **Zero-dispatch rule (unchanged, re-asserted for the new parser):** every rejection path —
  including scheme-casing rejections — performs zero tool/handler/engine/port/state work
  (empty call logs asserted).
- **Leak rule:** the presented header value appears in NO response, NO log, NO error body, on
  either surface (credential-sentinel sweep extended to casing variants).

## 3. Enforcement

`tests/integration/bearer-semantics-parity.test.ts` — boots the real history server (its
`node:http` handler against the fake tracker world) and the real MCP server (`listenHttp()` on
port 0), runs §2's matrix against BOTH, and asserts row-by-row verdict equality plus the
zero-dispatch and leak sweeps. The parity lives in the TEST: no shared runtime module is added
(hygiene contracts keep the two groups mutually unreachable).
