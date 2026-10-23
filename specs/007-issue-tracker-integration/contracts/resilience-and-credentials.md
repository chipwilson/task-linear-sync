# Contract: Resilience & Credential Posture (007-local, constitution-governed)

Modules: `src/tracker/resilience.ts`, `src/tracker/credentials.ts`,
`src/tracker/internal/request.ts`. This document makes two constitution constraints
concrete **verbatim** — the quoted blocks below are the governing text; this feature may
tighten but never weaken them.

## 1. Governing text (quoted verbatim, constitution v1.0.0)

> **Resilience:** Non-create Linear requests that fail with HTTP 429, 5xx, or network errors
> MUST retry with exponential backoff and randomized jitter up to the configurable maximum,
> honoring `Retry-After`. Issue creation MUST never be automatically retried; a failed
> create is recorded as indeterminate and reconciled, not replayed.

> **Credential handling:** Credentials MUST be read only from configured
> environment-variable names, MUST be rejected with a naming diagnostic before any request
> when unset or empty, and MUST NEVER appear in diagnostics, logs, reports, web responses,
> or MCP outputs.

Frozen interface invariants (002 tracker-port.md, consumption invariants 2–3, quoted):

> Non-create requests retry with backoff/jitter honoring `Retry-After`; `createIssue` never
> auto-retries (constitution Resilience) — the interface carries no retry knobs to tempt
> per-caller retries.

> All transmitted text is pre-screened by the caller (engine); the port transmits what it is
> given. Credential values never enter this interface's types or errors.

## 2. Failure classification (request site is the sole mapper — R12)

| Signal | Category | Retryable | Notes |
|---|---|---|---|
| Network error / `AbortSignal` timeout | `network` / `timeout` | yes (`non-create`) | constitution "network errors" |
| HTTP 429 | `rate-limit` | yes (`non-create`) | honor `Retry-After` (§4) |
| HTTP 5xx | `server` | yes (`non-create`) | constitution "5xx" |
| HTTP 401/403 | `auth` | no | names env-var **name** only in `detail` |
| HTTP 404 | `not-found` | no | `getIssue`/`getAttachmentByUrl` map to `null` where the frozen signature allows null |
| Other HTTP 4xx | `client` | no | request defect; surfacing beats retrying |
| HTTP 200 + GraphQL `errors[]` | `graphql` | no | user-input errors do not become transient; platform message included in sanitized `detail` |
| Any of the retryable rows **on `createIssue`** | original category, wrapped | **no** | `IndeterminateCreateError`, `attempts: 1` — the create guard is per-operation-class, not per-signal |

## 3. Retry schedule (R4)

- Budget: `maxRetries` (frozen config, default **5**) *additional* attempts after the first
  ⇒ ≤ 6 requests for non-create classes. Exhausted ⇒ terminal `TrackerError` of the final
  signal's category with `attempts` recorded.
- Delay for attempt k (0-based): `computed = min(baseDelayMs · 2^k, maxDelayMs)`
  (`baseDelayMs` 250, `maxDelayMs` 15 000 — 007-local defaults, data-model §1);
  **equal jitter**: `delay = computed/2 + rng() · computed/2` — `rng` injected
  (deterministic in tests, Principle IV/VI).
- Execution through injected `sleep(ms)` — production real timer, tests a fake sleeper that
  records waits without wall-clock cost.
- **Create guard**: the request site's mandatory `retryClass` parameter — `createIssue`
  path passes `"never"`; there is no code path in which a create issues a second request.
  Post-dispatch failure ⇒ `IndeterminateCreateError` (reconciliation is 008's create-intent
  job — 002 R10; this feature never "fixes up" a create itself).
- Concurrency: per-client semaphore of `config.concurrency` (default 4) around the request
  site (R6 fan-out bound).

## 4. `Retry-After` honoring

Accepted forms: **delta-seconds** (`Retry-After: 30`) and **HTTP-date**
(`Retry-After: Fri, 31 Oct 2026 21:13:05 GMT`, evaluated against injected `clock.now()`).
When present on a 429/5xx the header value **replaces** the jittered delay, clamped to
`[0, maxDelayMs]` (a 4-hour hint is a configuration error, not an infinite hang; the clamp
is test-observed). Malformed/absent header ⇒ computed backoff stands. Unit-tested with the
fake clock + recorded 429 fixtures (never slept at real durations).

## 5. Credential pre-flight and sanitizer (R5)

1. Read at construction only: `deps.options.env[cfg.credentialEnvVarNames[token|apiKey]]`
   (selected by `credentialKind`, default `token`).
2. Unset **or empty** ⇒ throw `TrackerConfigError` before returning a port — `detail` names
   the env-var **name** and remediation; zero requests issued (constitution "before any
   request").
3. Set but not starting with `config.personalKeyPrefix` (default `lin_api_`) ⇒ non-fatal
   `TrackerDiagnostic { code: "credential-prefix-mismatch" }` naming the env-var name and
   the expected prefix constant only.
4. The value lives only inside `HttpRequest.accessToken` → `Authorization: Bearer <value>`.
   Every `TrackerError.detail` / diagnostic string passes a sanitizer that strips the held
   value; the recorded-fixture driver **redacts the Authorization header at record time** so
   no fixture can ever contain a credential ("Hermetic pipelines": "secrets … MUST never be
   exposed in logs or annotations").
5. Security-tier proof: tests plant a unique sentinel as the env value and assert the
   sentinel appears in **zero** test-captured diagnostics/errors/fixture files across all
   failure scenarios of §2 (SC gate: 0 leaks).

## 6. Screening posture (frozen invariant, cited)

The port **transmits what it is given** — engine-side `Security_Screener` runs before the
port (constitution I; spec Assumption: "Screening of attachment payload content is enforced
by callers (008)"). 007 adds zero screening and zero screening bypasses; the adapter MUST
NOT re-emit transmitted payloads in error details beyond what §5 sanitization permits.

## Test obligations (mapped in quickstart)

- Schedule property: seeded rng ⇒ identical delay sequence across runs; k-th delay within
  `[computed/2, computed]`; clamp at `maxDelayMs`.
- `Retry-After` forms: seconds, HTTP-date (fake clock), malformed, clamped — each observed
  through the recorded fake sleeper.
- Classification matrix rows 1–7 against scripted transports; retry budget exhaustion
  (`attempts = maxRetries + 1`) and `maxRetries: 0` override honored ("up to the
  configurable maximum").
- Create guard: scripted 429/5xx/network on `issueCreate` ⇒ `attempts: 1`, no second
  request recorded, `IndeterminateCreateError` shape.
- Pre-flight: unset/empty for both names → construction throws naming the env-var name;
  sentinel non-leak scan across every failure path.
