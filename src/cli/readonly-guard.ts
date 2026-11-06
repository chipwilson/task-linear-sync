/**
 * T013 — `ReadOnlyGuard` (FR-005, research R6, data-model §5). Explicit member-by-member
 * wrappers (no Proxy defaults): every mutating `LinearPort` member throws
 * `ReadOnlyViolationError` naming the attempted member; read members delegate unchanged.
 * State writes are refused outside `allowedWritePrefixes` (`["reports/","plans/"]` for
 * the plan/check lane, `[]` for inventory/discover-metadata). Refused attempts write
 * nothing — the run aborts.
 */
import type { EngineDependencies } from "../ports/engine.js";
import type { LinearPort } from "../ports/linear-port.js";
import type { StateStore } from "../state/paths.js";
import { ReadOnlyViolationError } from "./errors.js";

/** Mutating members of the frozen `LinearPort` surface (data-model §5). */
const MUTATING_PORT_MEMBERS = [
  "createIssue",
  "updateIssue",
  "archiveIssue",
  "upsertAttachmentByUrl",
  "updateAttachment",
] as const;

function refusePortMember(member: (typeof MUTATING_PORT_MEMBERS)[number]): never {
  throw new ReadOnlyViolationError(`attempted ${member} during read-only command`);
}

/** Wrap `deps.port`: read members delegate, mutating members throw on invocation. */
export function guardPort(port: LinearPort): LinearPort {
  const guarded: Record<string, unknown> = {
    listIssues: (scope: Parameters<LinearPort["listIssues"]>[0]) => port.listIssues(scope),
    discoverMetadata: (teamKeys: Parameters<LinearPort["discoverMetadata"]>[0]) =>
      port.discoverMetadata(teamKeys),
    getIssue: (id: string) => port.getIssue(id),
    findIssuesByAttachmentUrl: (url: string) => port.findIssuesByAttachmentUrl(url),
    getAttachmentByUrl: (url: string) => port.getAttachmentByUrl(url),
    listAttachments: (issueId: string, cursor?: string) => port.listAttachments(issueId, cursor),
  };
  for (const member of MUTATING_PORT_MEMBERS) {
    guarded[member] = () => refusePortMember(member);
  }
  return guarded as unknown as LinearPort;
}

/** Wrap `deps.state`: writes outside the allowed prefixes throw, naming the rel path. */
export function guardState(state: StateStore, allowedWritePrefixes: readonly string[]): StateStore {
  const check = (method: string, rel: string): void => {
    if (!allowedWritePrefixes.some((prefix) => rel.startsWith(prefix))) {
      throw new ReadOnlyViolationError(
        `attempted ${method}('${rel}') during read-only command`,
      );
    }
  };
  return {
    root: state.root,
    paths: state.paths,
    config: state.config,
    clock: state.clock,
    ensure: () => state.ensure(),
    readJson: <T>(rel: string) => state.readJson<T>(rel),
    writeJson: (rel: string, value: unknown): Promise<void> => {
      check("writeJson", rel);
      return state.writeJson(rel, value);
    },
    writeText: (rel: string, text: string): Promise<void> => {
      check("writeText", rel);
      return state.writeText(rel, text);
    },
  };
}

/**
 * Guard a full `EngineDependencies` bag (data-model §5): guarded `port` + `state`,
 * `clock`/`config`/`screener` passed through by identity.
 */
export function createReadOnlyGuard(
  deps: EngineDependencies,
  allowedWritePrefixes: readonly string[],
): EngineDependencies {
  return {
    port: guardPort(deps.port),
    state: guardState(deps.state, allowedWritePrefixes),
    config: deps.config,
    clock: deps.clock,
    screener: deps.screener,
  };
}
