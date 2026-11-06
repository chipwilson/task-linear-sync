/**
 * T017 — the JSON-RPC 2.0 layer (data-model §1; jsonrpc-stdio.md §2–§4). Message
 * union parse/serialize, request/notification discrimination, the handshake state
 * machine, and the method-table dispatcher. Transport-agnostic: stdio/http are thin
 * byte-boundary adapters over `createDispatcher`.
 *
 * Wire rules baked in here:
 *  - the CLOSED emitted-code set (nothing else ever leaves the module);
 *  - `error.message` values are compile-time constants or sanitized method tokens —
 *    never presented argument values (FR-005);
 *  - notifications NEVER receive a response;
 *  - tool-level refusals are RESULTS (`isError: true`), not protocol errors.
 */

export type RpcId = string | number;

export interface JsonRpcRequest {
  readonly kind: "request";
  readonly id: RpcId;
  readonly method: string;
  readonly params: unknown;
}

export interface JsonRpcNotification {
  readonly kind: "notification";
  readonly method: string;
  readonly params: unknown;
}

/** A syntactically invalid inbound message; `id` is echoed only when it was usable. */
export interface JsonRpcInvalid {
  readonly kind: "invalid";
  readonly code: number;
  readonly id: RpcId | null;
  readonly message: string;
}

export type JsonRpcInbound = JsonRpcRequest | JsonRpcNotification | JsonRpcInvalid;

export interface JsonRpcErrorObject {
  readonly code: number;
  readonly message: string;
}

export type JsonRpcReply =
  | { readonly jsonrpc: "2.0"; readonly id: RpcId | null; readonly result: unknown }
  | { readonly jsonrpc: "2.0"; readonly id: RpcId | null; readonly error: JsonRpcErrorObject };

/** The result shape of a tools/call — data-model §4. Refusals set isError, never throw. */
export interface ToolCallResult {
  readonly content: readonly [{ readonly type: "text"; readonly text: string }];
  readonly isError?: true;
}

export interface PublishedTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: unknown;
}

/** jsonrpc-stdio.md §4 — closed server-emitted set. */
export const RPC_ERROR_CODES = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  NOT_INITIALIZED: -32002,
} as const;

// Fixed error texts (§4: constants or method tokens only).
/** Fixed parse-error text (transport frames — never echoes presented input). */
export const MSG_PARSE_ERROR = "parse error";
/** Fixed invalid-request text (also the http transport's parse/array fault). */
export const MSG_INVALID_REQUEST = "invalid request";
const MSG_INVALID_PARAMS = "invalid params";
const MSG_INTERNAL = "internal error";
const MSG_NOT_INITIALIZED = "server not initialized";

/**
 * §2.1 — the supported MCP protocol versions; the newest is the fallback answer.
 * `2025-06-18` was added by 014 (assumption A02): that revision defines no stdio-layer
 * semantics this server does not already implement, so accepting it is a set-membership
 * change only.
 */
export const SUPPORTED_PROTOCOL_VERSIONS = ["2024-11-05", "2025-03-26", "2025-06-18"] as const;
export const DEFAULT_PROTOCOL_VERSION = "2025-06-18";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function usableId(value: unknown): RpcId | null {
  return typeof value === "string" || typeof value === "number" ? value : null;
}

/**
 * Parse an already-decoded JSON value (framing owns the bytes; oversized/invalid JSON
 * is answered by the transport with -32700). Structural faults land in `kind:"invalid"`.
 */
export function parseMessage(raw: unknown): JsonRpcInbound {
  if (!isPlainObject(raw)) return { kind: "invalid", code: RPC_ERROR_CODES.INVALID_REQUEST, id: null, message: MSG_INVALID_REQUEST };
  if (raw.jsonrpc !== "2.0") return { kind: "invalid", code: RPC_ERROR_CODES.INVALID_REQUEST, id: null, message: MSG_INVALID_REQUEST };

  const hasId = Object.hasOwn(raw, "id");
  const id = hasId ? usableId(raw.id) : null;
  if (hasId && id === null) {
    return { kind: "invalid", code: RPC_ERROR_CODES.INVALID_REQUEST, id: null, message: MSG_INVALID_REQUEST };
  }

  const method = raw.method;
  if (typeof method !== "string" || method.length === 0) {
    return { kind: "invalid", code: RPC_ERROR_CODES.INVALID_REQUEST, id, message: MSG_INVALID_REQUEST };
  }

  const params = raw.params;
  if (params !== undefined && !isPlainObject(params) && !Array.isArray(params)) {
    // §4: params of the wrong JSON type is an invalid PARAMS, not an invalid envelope.
    return { kind: "invalid", code: RPC_ERROR_CODES.INVALID_PARAMS, id, message: MSG_INVALID_PARAMS };
  }

  return hasId
    ? { kind: "request", id: id as RpcId, method, params }
    : { kind: "notification", method, params };
}

export function errorReply(id: RpcId | null, code: number, message: string): JsonRpcReply {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

export function resultReply(id: RpcId | null, result: unknown): JsonRpcReply {
  return { jsonrpc: "2.0", id, result };
}

/** Compact single-line serialization (§1.1: JSON.stringify escapes every raw newline). */
export function serializeMessage(message: JsonRpcReply): string {
  return JSON.stringify(message);
}

/** §4: a METHOD NOT FOUND message may name the token — sanitized and length-bounded. */
function safeMethodToken(method: string): string {
  return /^[A-Za-z][A-Za-z0-9/._-]{0,63}$/.test(method) ? method : "";
}

export type DispatchPhase = "uninitialized" | "initializing" | "ready";

export interface DispatcherDeps {
  readonly serverName: string;
  readonly serverVersion: string;
  /** Visibility-filtered listing (the SAME predicate the call gate uses — SC-003). */
  readonly listTools: () => readonly PublishedTool[];
  /** Tool core dispatch; every refusal is a returned isError result, never a throw. */
  readonly callTool: (name: string, args: unknown) => Promise<ToolCallResult>;
}

/** §2 handshake + method table. One dispatcher per connection (per-connection state). */
export function createDispatcher(deps: DispatcherDeps) {
  let phase: DispatchPhase = "uninitialized";

  function initialize(id: RpcId, params: unknown): JsonRpcReply {
    const requested = isPlainObject(params) ? params.protocolVersion : undefined;
    // 014 (quickstart Scenario 5): a PRESENT but non-string protocolVersion is a
    // params shape fault — answered without advancing the handshake so a corrected
    // retry can succeed. MISSING stays lenient (version-less clients get the default).
    if (requested !== undefined && typeof requested !== "string") {
      return errorReply(id, RPC_ERROR_CODES.INVALID_PARAMS, MSG_INVALID_PARAMS);
    }
    const protocolVersion =
      typeof requested === "string" && (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
        ? requested
        : DEFAULT_PROTOCOL_VERSION;
    phase = "initializing";
    return resultReply(id, {
      protocolVersion,
      capabilities: { tools: {} },
      serverInfo: { name: deps.serverName, version: deps.serverVersion },
    });
  }

  function toolsList(id: RpcId, params: unknown): JsonRpcReply {
    // §3: no pagination — any params (cursor included) is a shape fault.
    if (params !== undefined && !(isPlainObject(params) && Object.keys(params).length === 0)) {
      return errorReply(id, RPC_ERROR_CODES.INVALID_PARAMS, MSG_INVALID_PARAMS);
    }
    return resultReply(id, {
      tools: deps.listTools().map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema })),
    });
  }

  async function toolsCall(id: RpcId, params: unknown): Promise<JsonRpcReply> {
    // Structural faults of the ENVELOPE are -32602; argument-shape faults are tool
    // results (tool-definitions.md §2.1 boundary).
    if (!isPlainObject(params) || typeof params.name !== "string" || params.name.length === 0) {
      return errorReply(id, RPC_ERROR_CODES.INVALID_PARAMS, MSG_INVALID_PARAMS);
    }
    const args = params.arguments === undefined ? {} : params.arguments;
    if (!isPlainObject(args)) {
      return errorReply(id, RPC_ERROR_CODES.INVALID_PARAMS, MSG_INVALID_PARAMS);
    }
    return resultReply(id, await deps.callTool(params.name, args));
  }

  /** Transport-agnostic entry: accepts an already-parsed message (component-api §2). */
  async function handleMessage(raw: unknown): Promise<JsonRpcReply | null> {
    const parsed = parseMessage(raw);
    if (parsed.kind === "invalid") return errorReply(parsed.id, parsed.code, parsed.message);

    if (parsed.kind === "notification") {
      // Accepted no-ops; unknown notifications/* are dropped silently. A notification
      // NEVER receives a response — including before initialization.
      if (parsed.method === "notifications/initialized" && phase === "initializing") phase = "ready";
      return null;
    }

    const { id, method, params } = parsed;
    try {
      if (method === "initialize") {
        // Single handshake per connection (§2.3).
        if (phase !== "uninitialized") return errorReply(id, RPC_ERROR_CODES.INVALID_PARAMS, MSG_INVALID_PARAMS);
        if (params !== undefined && !isPlainObject(params)) return errorReply(id, RPC_ERROR_CODES.INVALID_PARAMS, MSG_INVALID_PARAMS);
        return initialize(id, params);
      }
      if (phase !== "ready") return errorReply(id, RPC_ERROR_CODES.NOT_INITIALIZED, MSG_NOT_INITIALIZED);
      switch (method) {
        case "ping":
          return resultReply(id, {});
        case "tools/list":
          return toolsList(id, params);
        case "tools/call":
          return await toolsCall(id, params);
        default: {
          const token = safeMethodToken(method);
          return errorReply(id, RPC_ERROR_CODES.METHOD_NOT_FOUND, token === "" ? "method not found" : `method '${token}' is not supported`);
        }
      }
    } catch {
      // §5: a handler rejection is a fixed envelope — never a wrapped exception message.
      return errorReply(id, RPC_ERROR_CODES.INTERNAL_ERROR, MSG_INTERNAL);
    }
  }

  return { handleMessage, phase: (): DispatchPhase => phase };
}

export type Dispatcher = ReturnType<typeof createDispatcher>;
