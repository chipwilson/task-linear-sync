/**
 * Public surface of `task-linear-sync/history-server` (feature 011).
 *
 * Deliberately narrow (contracts/component-api.md §1): the factory, the
 * settings resolver + types, and the construction-error taxonomy. No port
 * constructors, no internals.
 */

export {
  createSyncHistoryServer,
  type SyncHistoryServerApp,
  type SyncHistoryServerDeps,
} from "./create.js";
export {
  resolveHistoryServerConfig,
  type ResolvedHistoryServerSettings,
} from "./options.js";
export {
  ERROR_ENVELOPES,
  HistoryRequestError,
  HistoryServerConfigError,
  type ErrorEnvelope,
  type HistoryErrorCode,
} from "./errors.js";
export type { HistoryClock, HistoryEventView, HistoryPageView } from "./types.js";
export { parseHistoryRoute, type HistoryRouteOutcome } from "./routes.js";
