/**
 * THE ONE request site (research R3/R12; constitution V: "All Linear access MUST flow through
 * the injectable Linear_Port so no component bypasses the port's retry, rate-limit, and
 * diagnostic posture"). Composes: credentials → withRetry (mandatory retryClass) → transport
 * → GraphQL-envelope check → error mapping. Nothing else in `src/**` may hold a fetch or
 * transport reference (scan-enforced by tests/contract/tracker-no-direct-access.test.ts).
 * Records `attempts` / `waitedMs` on outcomes; every outgoing credential is confined to the
 * Authorization header and every emitted `detail` passes the R5 sanitizer.
 */
import type { ResolvedConfig } from "../../config/schema.js";
import type { Clock } from "../../state/clock.js";
import type { AttachmentUrlConfig } from "../../urls/attachment-url.js";
import type { CredentialBundle, TrackerDiagnostic } from "../credentials.js";
import { isNotImplemented, TrackerError, type Sanitizer } from "../errors.js";
import type { HttpTransport, HttpResponse } from "../http.js";
import { classifyFailure, withRetry, type RetryClass, type RetryOutcome, type Semaphore } from "../resilience.js";
import type { ResolvedTrackerOptions } from "../options.js";
import { GRAPHQL_DOCUMENTS, type GraphQLOperationName } from "../graphql/documents.js";
import { envelopeData, graphQlErrorMessages } from "../graphql/mapping.js";
import type { DiscoveryCache } from "../graphql/mapping.js";

/** Everything the operation modules need — assembled once by `createLinearPort`. */
export interface TrackerContext {
  readonly config: ResolvedConfig;
  readonly options: ResolvedTrackerOptions;
  readonly credentials: CredentialBundle;
  readonly urlConfig: AttachmentUrlConfig;
  readonly sanitize: Sanitizer;
  readonly diagnostics: (d: TrackerDiagnostic) => void;
  readonly exec: RequestExecutor;
  readonly discovery: DiscoveryCache;
  readonly clock: Clock;
}

export interface ExecOptions {
  /** Mandatory per-operation retry permission (frozen invariant 2 — no other knob exists). */
  readonly retryClass: RetryClass;
  /** HTTP 404 maps to a `null` success (frozen getIssue/getAttachmentByUrl null semantics). */
  readonly notFoundMeansNull?: boolean;
}

export interface ExecDetailed<T> {
  readonly value: T;
  readonly outcome: RetryOutcome;
}

export interface RequestExecutor {
  /** Run `op`; `mapData` interprets a successful envelope's `data`. Null maps 404 → null. */
  exec<T>(
    op: GraphQLOperationName,
    variables: Record<string, unknown>,
    mapData: (data: Record<string, unknown>) => T,
    opts: ExecOptions,
  ): Promise<T>;
  /** Same, exposing the { attempts, waitedMs } outcome (T019 outcome recording). */
  execDetailed<T>(
    op: GraphQLOperationName,
    variables: Record<string, unknown>,
    mapData: (data: Record<string, unknown>) => T,
    opts: ExecOptions,
  ): Promise<ExecDetailed<T>>;
}

export interface RequestExecutorDeps {
  readonly config: ResolvedConfig;
  readonly options: ResolvedTrackerOptions;
  readonly transport: HttpTransport;
  readonly credentials: CredentialBundle;
  readonly sanitize: Sanitizer;
  readonly semaphore: Semaphore;
}

function truncate(text: string, max = 240): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

/** Sanitized, op-tagged detail for an HTTP non-2xx response. */
function httpDetail(op: GraphQLOperationName, response: HttpResponse, sanitize: Sanitizer, envVarName: string): string {
  const status = response.status;
  if (status === 401 || status === 403) {
    // Auth rows name the env-var NAME only (resilience contract §2 row 4) — never a value.
    return sanitize(`${op}: auth rejected (HTTP ${status}) — verify the credential configured in environment variable '${envVarName}'`);
  }
  const raw = (response.body as { __rawText?: unknown } | null)?.__rawText;
  const suffix = typeof raw === "string" && raw.trim() !== "" ? `: ${truncate(raw.trim())}` : "";
  return sanitize(`${op}: HTTP ${status}${suffix}`);
}

export function createRequestExecutor(deps: RequestExecutorDeps): RequestExecutor {
  const { config, options, transport, credentials, sanitize, semaphore } = deps;

  async function execDetailed<T>(
    op: GraphQLOperationName,
    variables: Record<string, unknown>,
    mapData: (data: Record<string, unknown>) => T,
    opts: ExecOptions,
  ): Promise<ExecDetailed<T>> {
    const doc = GRAPHQL_DOCUMENTS[op];
    const attempt = async () => {
      const release = await semaphore.acquire();
      let response: HttpResponse;
      try {
        response = await transport.postJson({
          json: { query: doc.source, operationName: op, variables },
          accessToken: credentials.value,
          timeoutMs: options.timeoutMs,
        });
      } catch (error) {
        // Control-flow sentinels pass through untouched: the T023/T021 parity skip signal and a
        // loud FixtureMiss must never be retried, reclassified, or wrapped as create-indeterminate.
        if (isNotImplemented(error) || (error instanceof Error && error.name === "FixtureMiss")) throw error;
        const cls = classifyFailure({ kind: "network", error });
        return {
          ok: false as const,
          failure: { category: cls.category, retryable: cls.retryable, detail: sanitize(`${op}: ${cls.detail}`) },
        };
      } finally {
        release();
      }
      if (response.status >= 200 && response.status < 300) {
        const messages = graphQlErrorMessages(response.body);
        if (messages.length > 0) {
          // HTTP 200 + GraphQL errors[]: user-input errors do not become transient (row 7).
          const cls = classifyFailure({ kind: "graphql", detail: truncate(messages.join("; ")) });
          return { ok: false as const, failure: { ...cls, detail: sanitize(`${op}: ${cls.detail}`) } };
        }
        return { ok: true as const, value: mapData(envelopeData(response.body)) };
      }
      const cls = classifyFailure({ kind: "http", status: response.status, detail: httpDetail(op, response, sanitize, credentials.envVarName) });
      return {
        ok: false as const,
        failure: { category: cls.category, retryable: cls.retryable, httpStatus: cls.httpStatus, detail: cls.detail },
        retryAfterHeader: response.headers["retry-after"] ?? null,
      };
    };

    try {
      return await withRetry(attempt, {
        retryClass: opts.retryClass,
        maxRetries: config.maxRetries,
        baseMs: options.baseDelayMs,
        maxDelayMs: options.maxDelayMs,
        rng: options.rng,
        sleep: options.sleep,
        clock: options.clock,
      });
    } catch (error) {
      if (opts.notFoundMeansNull && error instanceof TrackerError && error.category === "not-found") {
        return { value: null as unknown as T, outcome: { attempts: error.attempts, waitedMs: 0 } };
      }
      throw error;
    }
  }

  return {
    async exec(op, variables, mapData, opts) {
      const result = await execDetailed(op, variables, mapData, opts);
      return result.value;
    },
    execDetailed,
  };
}
