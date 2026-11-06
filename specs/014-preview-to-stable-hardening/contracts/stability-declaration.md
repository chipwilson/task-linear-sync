# Contract: Stability Declaration (FR-001, FR-003, FR-011)

## 1. Required doc section

Both usage docs (`docs/agent-tools.md`, `docs/history-server.md`) gain a final `## Stability`
section with exactly these elements, in order:

1. **Status line** — `Stable` + effective date + `promoted by feature 014`; this is the only
   wording that removes the preview label. Before promotion completes, both surfaces must read
   identically (either both preview or both stable) — FR-003's symmetry rule.
2. **Guaranteed scope** — a pointer list, never a restatement: the feature's contract docs
   (`specs/012-*/contracts/*.md` / `specs/011-*/contracts/*.md`) and the surface snapshot
   (`tests/contract/snapshots/*-surface.json`). The pointer IS the scope definition.
3. **Not guaranteed** — one sentence: behavior outside the frozen inventory may change without
   notice (internal refactors, formatting, diagnostics).
4. **Explicit non-goals** — one bullet per Deferred Decision Record (data-model §4): slug,
   decision, rationale, revisit trigger. MUST include, at minimum:
   `mcp-sdk-protocol-surface` (streamable HTTP, resources, prompts, sampling, elicitation,
   roots, subscriptions), `mcp-tls-remote-exposure`, `sse-last-event-id-resume`;
   `history-inbound-identity-limiting` (per-client limits — R3). 0 silent deferrals (FR-011).
5. **Deployment assumptions** (history) — TLS-front-door model + `web.secureCookies` rule;
   (MCP) — loopback-only HTTP, stdio default.

## 2. Promotion checklist (all entries verified by tests or review before the label drops)

- [ ] SC-001…SC-006 green (quickstart traceability).
- [ ] Both snapshots checked in; amendment entries present for every element this feature
      changed (contracts/README.md amendment list).
- [ ] README surface table: no `(preview)` suffix anywhere; feature bullet + section headings
      cleaned; npm-script list matches `package.json` exactly.
- [ ] `specs/011-*/spec.md` and `specs/012-*/spec.md` `Status:` lines updated to reference the
      014 promotion.
- [ ] `specs/requirements.md` as-built wording (R10) — no Next.js/React, no remote-HTTP/SSE
      MCP transport claims.

## 3. Machine checks (enforced in `surface-freeze-*.test.ts`)

- Grep `docs/agent-tools.md`, `docs/history-server.md`, `README.md` for `preview` (word
  boundary, case-insensitive) outside the 014 spec directory: 0 hits post-promotion (SC-005).
- Each Stability section contains every required slug (SC-006) and a non-empty revisit trigger
  per re-deferred item.
- Grep `specs/requirements.md` for `Next.js`, `React`, and `HTTP/SSE transport`: 0 hits (SC-005).
