# Contract: Access Control (private by default; server-side-only token)

Normative behavior behind `src/history-server/auth.ts` (research R5). Implements FR-008 and
SC-003; satisfies the constitution's "Credential handling" constraint for Web transports.

## 1. Modes

| Mode | Selection | Behavior |
|---|---|---|
| `private` (default) | `web.accessControlMode: "private"` (frozen 001 `web` group default) | every `GET` requires a valid credential; missing ⇒ `401` + `WWW-Authenticate: Bearer`; invalid/expired ⇒ `403`; BOTH with zero history bytes (SC-003: 0 credential-less requests receive history data) |
| `public` | explicit `web.accessControlMode: "public"` | credentials ignored; valid requests need none (opt-in is a config decision, never a fallback) |

Private mode requires the configured token env var (`web.authEnvVarName`,
001 derivation `${envVarPrefixFor(toolId)}_WEB_TOKEN` — default
`TASK_LINEAR_SYNC_WEB_TOKEN`) to be set non-empty; construction
otherwise refuses, naming the env-var NAME only, never a value.

## 2. Credential forms (private mode, checked in order)

1. **Bearer token** — `Authorization: Bearer <value>`, compared to the server-side token
   with `crypto.timingSafeEqual` (length-equalized first; timing side channel closed).
   Used by API clients, proxies injecting auth, and the page's fetch-stream SSE/polling.
2. **Stateless session cookie** — `<toolId>-history=<base64url({exp})>.<tag>` with
   `tag = base64url(HMAC-SHA256(K, payload))`,
   `K = hkdfSync("sha256", ikm = token, salt = toolId, info = "history-session-v1", 32)`,
   `exp` enforced against the injected `Clock` (`SESSION_TTL_SECONDS` module constant — 3600 s;
   the frozen `web` schema has no session-lifetime key). Any verification failure is `403` — never a downgrade to anonymous-read.

A `public`-mode request bearing credentials is served identically (no 4xx for surplus
headers).

## 3. Session bootstrap (browser navigation)

- A `401` HTML response is a **zero-history shell** containing only a token-entry form
  (`POST` to the same route, `application/x-www-form-urlencoded`, body cap 8 KB, larger ⇒
  `403`).
- Correct token ⇒ `303` back to the route with `Set-Cookie: <name>=<payload>.<tag>;
  Path=/; HttpOnly; SameSite=Strict` (no `Secure` attribute decision in-component —
  deployment/TLS concern, documented).
- Wrong/missing form token ⇒ `403`, no cookie set, zero history bytes.
- The 401/403 shells are identical in shape regardless of route content, so response
  SHAPE alone must not leak whether a task identity exists: for a routed-but-unauthorized
  request the component answers 401/403 WITHOUT probing the tracker (auth strictly before
  reconstruction) — ordering test enforced.

## 4. Leak rules (normative; sentinel-swept)

1. The token value appears in NO response body, error message, header value, redirect
   target, cookie, or log line (SC-003 corpus-wide).
2. The cookie and HMAC key `K` are key-DERIVED material only; reversing them to the token
   is infeasible by construction (HKDF/HMAC).
3. `401`/`403`/`404` bodies are rendered exclusively from the fixed `ErrorEnvelope`
   constants — the error renderer imports nothing from `reconstruct.ts`.
4. All browser-visible text (event descriptions, references, kind labels, error messages,
   HTML form copy) passes `screener.screen()` + HTML escaping immediately before writing
   (FR-008 "re-screening rendered values"); blocked findings emit only the
   `[blocked:<category>]` sentinel.
5. Rate-limit/upstream failures name no credential (FR-007): messages are fixed constants
   from §4 of http-surface.md.
