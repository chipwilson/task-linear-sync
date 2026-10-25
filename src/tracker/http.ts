/**
 * Transport seam (research R3; data-model.md §2). `HttpTransport` is the one injectable door
 * to the platform; `fetchTransport()` is the ONLY code in the whole package that touches
 * global `fetch` — and even it is reached exclusively through `internal/request.ts`, the one
 * request site (constitution V: "All Linear access MUST flow through the injectable
 * Linear_Port"). Nothing here ever logs (R3). Network/abort errors propagate uncaught-but-
 * typed for the resilience classifier (R4).
 */

export interface HttpRequest {
  /** GraphQL body { query, operationName, variables }. */
  readonly json: unknown;
  /** Opaque bearer value; never logged, never echoed back (R5 sanitizer). */
  readonly accessToken: string;
  /** Per-request timeout; enforced via AbortSignal. */
  readonly timeoutMs: number;
}

export interface HttpResponse {
  readonly status: number;
  /** Lower-cased header keys. */
  readonly headers: Readonly<Record<string, string>>;
  /** Parsed JSON body, or `{ __rawText }` when the body is not JSON. */
  readonly body: unknown;
}

export interface HttpTransport {
  /** Network/timeout failures THROW (classified by resilience.classifyFailure, R4). */
  postJson(req: HttpRequest): Promise<HttpResponse>;
}

/** Minimal structural fetch binding (global fetch satisfies it; tests inject stubs). */
export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
  },
) => Promise<{
  status: number;
  headers: { forEach: (cb: (value: string, key: string) => void) => void };
  text(): Promise<string>;
}>;

/**
 * Built-in-fetch production binding for the GraphQL endpoint `apiUrl`. POST JSON with
 * `Authorization: Bearer`, content negotiation headers, and an AbortSignal per-request
 * timeout. Never logs anything, never touches the token beyond the header (R3/R5).
 */
export function fetchTransport(apiUrl: string, fetchImpl?: FetchLike): HttpTransport {
  const send: FetchLike =
    fetchImpl ??
    ((url, init) =>
      (globalThis.fetch as unknown as FetchLike)(url, init));
  return {
    async postJson(req: HttpRequest): Promise<HttpResponse> {
      const res = await send(apiUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          authorization: `Bearer ${req.accessToken}`,
        },
        body: JSON.stringify(req.json),
        signal: AbortSignal.timeout(req.timeoutMs),
      });
      const headers: Record<string, string> = {};
      res.headers.forEach((value, key) => {
        headers[key.toLowerCase()] = value;
      });
      const text = await res.text();
      let body: unknown;
      try {
        body = JSON.parse(text) as unknown;
      } catch {
        body = { __rawText: text };
      }
      return { status: res.status, headers, body };
    },
  };
}
