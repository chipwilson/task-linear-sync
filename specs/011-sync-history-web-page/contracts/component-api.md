# Contract: Component API (`task-linear-sync/history-server`)

Normative behavior behind `src/history-server/create.ts` + `index.ts` + `options.ts`
(research R1/R6/R9). The subpath export is the feature's entire published surface.

## 1. Factory (frozen-shape deps, 011-shape app)

```ts
export interface SyncHistoryServerDeps {
  readonly port: LinearPort;                       // the ONLY route to the tracker (V)
  readonly config: ResolvedConfig;                 // frozen merged config (scheme, ns key, `web` group)
  readonly clock?: Clock;                          // default systemClock — TTL/cadence/expiry
  readonly screener?: SecurityScreener;            // default createDefaultSecurityScreener(config)
  readonly env?: Readonly<Record<string, string | undefined>>; // default process.env (sole such site)
}

export interface SyncHistoryServerApp {
  /** Deployable unit: usable directly as an http.createServer listener. */
  handle(req: IncomingMessage, res: ServerResponse): void;
  /** Optional convenience over node:http; absence of any listener = full function (SC-004). */
  listen(port?: number, host?: string): Promise<{ readonly port: number; close(): Promise<void> }>;
  readonly settings: ResolvedHistoryServerSettings; // validated view of the `web` group
}

/** Throws HistoryServerConfigError (naming config keys / env-var NAMES only) on: invalid
 *  out-of-range `web` values, private mode with unset/empty token env var, or an
 *  unusable URL scheme config
 *  (probed once via the frozen builders at construction — fail fast, never silent). */
export function createSyncHistoryServer(deps: SyncHistoryServerDeps): SyncHistoryServerApp;
```

Re-exported for hosts/tests: `resolveHistoryServerConfig`, the settings/view types, and the
`HistoryServerConfigError` taxonomy. NOTHING else is exported (no port constructors, no
internals).

## 2. Settings: validated view of the frozen `web` group (no new config keys)

`resolveHistoryServerConfig(config)` is pure validation over the existing
`ResolvedConfig.web` (`WebSurfaceConfig`, 001 frozen schema) plus construction-time range
guards (001 bounds no numeric ranges). Out-of-range values fail with ALL problems listed
(one dotted-key line each, queue-group posture):

| Setting | Source (frozen 001 default) | Surface guard |
|---|---|---|
| `accessMode` | `web.accessControlMode` (`"private"`) | enum (schema-typed) |
| `tokenEnvVarName` | `web.authEnvVarName` (`${envVarPrefixFor(toolId)}_WEB_TOKEN`) | non-empty |
| `sseEnabled` | `web.realtimeSse` (`true`) | — |
| `refreshSeconds` | `web.pollIntervalSeconds` (`15`) | integer `1..3600` |
| `cacheTtlSeconds` | `web.cacheTtlSeconds` (`10`) | integer `0..3600` (0 disables) |

Session lifetime, SSE heartbeat cadence, and queue/limit constants are **module constants**,
not config (the frozen schema reserves no keys for them). Adding keys to `web` would edit
001's frozen schema — forbidden.
Defaults ship zero organization identifiers (Principle III + release scan).

## 3. Stateless invariants (provable; hygiene contract scan targets)

Inside `src/history-server/**`:

1. ZERO `node:fs` / `node:fs/promises` imports ⇒ no manifest, state-directory, or
   checkpoint READ possible and no file WRITE possible (FR-004, SC-004; scan-enforced,
   mirroring `engine-no-direct-tracker.test.ts` / the queue scans).
2. Zero `../state/` imports; zero identifier occurrences: `StateStore`, `sync-state.json`,
   `manifest`, `last-run`, `checkpoint`, `keyProvider`, `manifestKey`.
3. Inbound transport only: `node:http` allowed for the listener; `node:https|http2|net|
   tls|dns|dgram`, `fetch(`, `undici`, `WebSocket`, `XMLHttpRequest` banned — the
   component never becomes a client.
4. No `../tracker/internal|http` or `../tracker/testing` reach-ins; no
   `task-linear-sync/*` package specifiers (relative-import convention).
5. `process.env` in exactly one file (`create.ts` deps default).
6. `node:crypto` use confined to `auth.ts` (`createHmac`, `hkdfSync`, `timingSafeEqual`,
   `createHash`) — Node 20 APIs only.
7. Zero credential-shaped literals, zero non-placeholder UUIDs/hosts in source, defaults,
   fixtures, and docs (distributed-defaults posture).
8. Zero runtime dependencies added to `package.json` (existing dependency-budget contract
   test stays green unmodified).

## 4. Cache contract (FR-006)

- Key: `taskUuid`. Fresh iff `clock.elapsed(builtAtIso) < cacheTtlSeconds * 1000`.
- Hit serves the stored view verbatim (with `X-History-Cache: hit`); miss re-walks and
  stores; `cacheTtlSeconds: 0` ⇒ no stores, no hit headers semantics change (`miss` only).
- Failures are never cached; stale is never served on error; entries are non-authoritative
  display material only.
- Single-flight: concurrent misses for one task share one in-flight walk promise.

## 5. Packaging

One additive `package.json` entry:

```json
"./history-server": {
  "types": "./dist/history-server/index.d.ts",
  "default": "./dist/history-server/index.js"
}
```

`history-packaging.test.ts` proves resolution + the public surface (factory + types) and
that no other export changed.
