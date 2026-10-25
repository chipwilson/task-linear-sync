/**
 * T024 — the public `task-linear-sync/tracker` surface (contracts/tracker-adapter.md): the
 * port factory, the frozen port types it serves (imported from 002, never reshaped), the
 * error taxonomy 008/009/013 branch on, the resilience/credential helpers that back the
 * posture, and the chain/identity machinery usable over ANY `LinearPort`. Operation modules,
 * the request site, and the GraphQL documents stay package-internal (constitution V: the port
 * is the only route; the T044 scan enforces it).
 */

// ── The port (frozen 002 types re-exported for consumers; never reshaped here) ──
export { createLinearPort, attachmentUrlConfigFrom, type CreateLinearPortDeps } from "./client.js";
export type {
  AttachmentMetadata,
  AttachmentView,
  CreateIssueInput,
  IssueScope,
  IssueUpdatePatch,
  IssueView,
  LinearPort,
  Page,
  TeamMetadataCollections,
} from "../ports/linear-port.js";
export type { AttachmentUrlConfig, ParsedAttachmentUrl } from "../urls/attachment-url.js";

// ── Error taxonomy (R12) ──
export {
  TrackerError,
  TrackerConfigError,
  IndeterminateCreateError,
  isTrackerError,
  isNotImplemented,
  notImplemented,
  createSanitizer,
  type Sanitizer,
  type TrackerErrorCategory,
  type TrackerErrorFields,
} from "./errors.js";

// ── Resilience posture (R4) ──
export {
  classifyFailure,
  nextDelayMs,
  withRetry,
  createSemaphore,
  type AttemptOutcome,
  type ClassifiedFailure,
  type FailureSignal,
  type RetryClass,
  type RetryDeps,
  type RetryOutcome,
  type RetrySuccess,
  type ScheduleOptions,
  type Semaphore,
} from "./resilience.js";

// ── Credentials + diagnostics (R5) ──
export { preflightCredentials, type CredentialBundle, type CredentialPreflight, type TrackerDiagnostic } from "./credentials.js";

// ── 007-local wiring (R11) ──
export {
  resolveTrackerOptions,
  splitmixRng,
  DEFAULT_API_URL,
  DEFAULT_BASE_DELAY_MS,
  DEFAULT_MAX_DELAY_MS,
  DEFAULT_ORPHAN_PROBE_LIMIT,
  DEFAULT_RNG_SEED,
  DEFAULT_TIMEOUT_MS,
  type ResolvedTrackerOptions,
  type TrackerClientOptions,
} from "./options.js";

// ── Transport seam (R3): the injection door for recorded/hermetic drivers ──
export { fetchTransport, type HttpRequest, type HttpResponse, type HttpTransport, type FetchLike } from "./http.js";

// ── Scoping guard (R6) — shared belt-and-braces predicate ──
export { issueInScope, clampPageSize, buildIssuesFilterVariables, PLATFORM_CONNECTION_MAX } from "./scoping.js";

// ── Mapping helpers + discovery cache (R10), GraphQL allow-list surface (R12) ──
export {
  DiscoveryCache,
  mapAttachmentNode,
  mapIssueNode,
  mapIssueNodes,
  mapTeamNodeFull,
  type TeamDiscoveryRecord,
} from "./graphql/mapping.js";
export { GRAPHQL_DOCUMENTS, GRAPHQL_OPERATION_NAMES, type GraphQLOperationName } from "./graphql/documents.js";

// ── Chain enumeration (R8) ──
export { enumerateAttachmentChain, type AttachmentChainResult, type ChainOptions } from "./chain.js";
