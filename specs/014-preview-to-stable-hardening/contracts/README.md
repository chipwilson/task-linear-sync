# 014 Contracts — Preview-to-Stable Hardening (014-local interfaces)

This feature adds NO new runtime subpath, transport, or gate vocabulary. What it adds is the
**promotion layer**: the stability declaration format, the 011/012 surface freeze, the new
resource-bound settings, and the cross-surface bearer contract. One frozen-surface touch: the
R1 config amendment, executed under `docs/contract-amendments.md` (configuration.md +
`src/config/{schema,defaults}.ts` in one commit, noted against 001).

| File | Covers |
|---|---|
| [stability-declaration.md](./stability-declaration.md) | Required "Stability" doc sections, promotion checklist |
| [surface-freeze.md](./surface-freeze.md) | Frozen-element inventories, snapshot format, amendment-entry rule, mutation checks |
| [resource-bounds.md](./resource-bounds.md) | New `web.*`/`mcp.*` settings, guards, backpressure envelopes, cookie attributes, store lifecycle |
| [bearer-parity.md](./bearer-parity.md) | Cross-surface bearer matrix, verdicts, leak rules |

**Amendments landed by this feature** (each = doc + module + snapshot entry, same change):
1. 002 `configuration.md`: the six R1 keys (§ resource-bounds.md §1).
2. 012 `jsonrpc-stdio.md`: protocol-revision set `+ 2025-06-18`, `DEFAULT` → `2025-06-18`.
3. 012 `apply-gating.md`: plan-reference TTL/capacity eviction folded into the step-3
   `PLAN_REFERENCE_UNKNOWN` rule (no ladder change).
4. 011 `access-control.md`: bearer scheme case-insensitivity + `Secure` attribute rule.
5. 011 `http-surface.md`: self-protective 429 (`RATE_LIMITED` envelope + `Retry-After`) and the
   bounded-cache/stream posture.

Enforcement map: freeze/mutation checks → `tests/contract/surface-freeze-{history,mcp}.test.ts`
(SC-001); bounds/cookies/SSE-ignore → `tests/integration/history-bounds.test.ts` +
`tests/unit/history-cache.test.ts` + `tests/unit/history-options.test.ts` (SC-002/003); store
lifecycle → `tests/unit/mcp-plan-store.test.ts` + `tests/integration/mcp-http.test.ts`; bearer
matrix → `tests/integration/bearer-semantics-parity.test.ts` (SC-004); doc state →
`tests/contract/surface-freeze-*.test.ts` doc greps (SC-005); deferral register → same tests'
non-goal presence checks (SC-006).
