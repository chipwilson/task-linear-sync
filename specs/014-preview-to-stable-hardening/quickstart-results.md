# Quickstart execution record — feature 014 (T044, promotion-review evidence)

**Date**: 2026-11-06 · **Branch**: `014-preview-to-stable-hardening` · **HEAD at record**: `7414f46` + phase-7 work
**Prerequisites**: `npm run build` (dist/ current) · full `npm test` **1578/1578 green, exit 0** —
coverage 81.18 lines / 80.62 branches / 80.97 functions against the 80/70/80 gate;
`tracker-dependency-budget` reports `SPENT 0`; `package.json` (incl. `exports`) unchanged across
the whole 014 range.

Each scenario ran against the compiled test tree (`build/`) exactly as the suites do in
`npm test`; scenario commands and totals:

| Scenario | Command | Result |
|---|---|---|
| 1 — freeze catches unamended drift (SC-001) | `node --test build/tests/contract/surface-freeze-{history,mcp}.test.js build/tests/unit/surface-freeze.test.js` | 18/18 green — mutation rows emit their exact `ADDED/REMOVED/CHANGED` lines, amendment-entry integrity green |
| 2 — history fan-out/overload (SC-002/SC-003) | `node --test build/tests/integration/history-bounds.test.js build/tests/unit/history-cache.test.js build/tests/unit/history-options.test.js` | 27/27 green — size ≤ bound + byte-equality vs control run; walk/stream 429 `RATE_LIMITED` + `Retry-After: 1` with zero history bytes; `Last-Event-ID` ignored; `Secure` conditional cookie |
| 3 — long-lived MCP store, fail-closed (SC-001) | `node --test build/tests/unit/mcp-plan-store.test.js build/tests/integration/mcp-http.test.js` | 21/21 green — expired ≡ evicted ≡ unknown with zero engine/port/state touch (spy + state-dir hash); `mcp-hygiene` stays green in the full run |
| 4 — bearer parity (SC-004) | `node --test build/tests/integration/bearer-semantics-parity.test.js` | 1/1 green — matrix verdict-equal on BOTH real transports, scheme challenges present, per-row zero-dispatch deltas, token-value leak sweep clean |
| 5 — MCP negotiation (FR-010) | `node --test build/tests/unit/mcp-jsonrpc.test.js build/tests/integration/mcp-stdio.test.js` | 32/32 green — echo rows, newest-supported fallback, non-string ⇒ `-32602` retryable, `tools/list` unchanged at three tools |
| 6 — docs & traceability audit (SC-005/SC-006) | `node --test build/tests/contract/stability-docs.test.js` | 8/8 green — 0 `preview` labels, status symmetry (docs + README rows + spec `Status:` lines, effective 2026-11-06), ghost-wording greps 0 hits, README scripts ⊆ `package.json`, full deferral register with non-empty revisit triggers |

## T045 final audit

- Amendment commit `5d633df` is standalone (three artifacts + data-model note); the 014 commit
  range `5d85959..HEAD` touches no other `src/config/` or `specs/002-*` file (verified by
  `git diff --name-only`).
- Documentation duties rode their own changes: US1 T013–T015 (`4bc9889`), US2 T024 + snapshot
  (`aa3afdf`), US3 T033 (`81159f8`), US4 T038 + amendment entry (`7414f46`).
- Every 014 snapshot drift is cited by a `docs/contract-amendments.md` entry; drift-set math
  and entry-integrity tests green in scenario 1.
- SC-001…SC-006 evidence lines: scenario table above; SC-005/SC-006 additionally machine-enforced
  by `tests/contract/stability-docs.test.ts` (kept in CI).
