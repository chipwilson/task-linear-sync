/**
 * T022 — the port factory (contracts/tracker-adapter.md): `createLinearPort` assembles the
 * frozen `LinearPort` from the operation modules over the single request site. The credential
 * pre-flight runs BEFORE the port is returned ("MUST be rejected with a naming diagnostic
 * before any request" — constitution): unset/empty ⇒ `TrackerConfigError`, zero requests
 * issued. All 007-local knobs default from `TrackerClientOptions`; the frozen `ResolvedConfig`
 * supplies pageSize/maxRetries/concurrency/credential env-var names/personalKeyPrefix and the
 * URL-scheme templates (derived here for `chain.ts` consumers — 002's types, never reshaped).
 */
import type { ResolvedConfig } from "../config/schema.js";
import type {
  AttachmentMetadata,
  CreateIssueInput,
  IssueScope,
  IssueUpdatePatch,
  LinearPort,
} from "../ports/linear-port.js";
import type { AttachmentUrlConfig } from "../urls/attachment-url.js";
import { createSanitizer } from "./errors.js";
import { preflightCredentials } from "./credentials.js";
import { createSemaphore } from "./resilience.js";
import { DiscoveryCache } from "./graphql/mapping.js";
import { createRequestExecutor, type TrackerContext } from "./internal/request.js";
import { resolveTrackerOptions, type TrackerClientOptions } from "./options.js";
import { discoverMetadataImpl, listIssuesImpl } from "./operations/inventory.js";
import { archiveIssueImpl, createIssueImpl, getIssueImpl, updateIssueImpl } from "./operations/mutations.js";
import {
  findIssuesByAttachmentUrlImpl,
  getAttachmentByUrlImpl,
  listAttachmentsImpl,
  updateAttachmentImpl,
  upsertAttachmentByUrlImpl,
} from "./operations/attachments.js";

export interface CreateLinearPortDeps {
  /** Frozen 002 resolved configuration (imported, never reshaped). */
  readonly config: ResolvedConfig;
  /** Default: derived from `config` (base host / toolId / templates). */
  readonly urlConfig?: AttachmentUrlConfig;
  readonly options?: TrackerClientOptions;
}

/** ResolvedConfig → the frozen URL-scheme config shape (`chain.ts` / 008 / 011 consumers). */
export function attachmentUrlConfigFrom(
  config: Pick<ResolvedConfig, "attachmentBaseHost" | "toolId" | "attachmentUrlTemplate" | "continuationUrlTemplate">,
): AttachmentUrlConfig {
  return {
    attachmentBaseHost: config.attachmentBaseHost,
    toolId: config.toolId,
    attachmentUrlTemplate: config.attachmentUrlTemplate,
    continuationUrlTemplate: config.continuationUrlTemplate,
  };
}

export function createLinearPort(deps: CreateLinearPortDeps): LinearPort {
  const config = deps.config;
  const options = resolveTrackerOptions(deps.options);
  const urlConfig = deps.urlConfig ?? attachmentUrlConfigFrom(config);
  // Pre-flight BEFORE returning — throws `TrackerConfigError` naming the env-var NAME only.
  const credentials = preflightCredentials({
    config,
    env: options.env,
    credentialKind: options.credentialKind,
    diagnostics: options.diagnostics,
  });
  const sanitize = createSanitizer([credentials.value]);
  const ctx: TrackerContext = {
    config,
    options,
    credentials,
    urlConfig,
    sanitize,
    diagnostics: options.diagnostics,
    exec: createRequestExecutor({
      config,
      options,
      transport: options.transport,
      credentials,
      sanitize,
      semaphore: createSemaphore(config.concurrency),
    }),
    discovery: new DiscoveryCache(),
    clock: options.clock,
  };

  return {
    listIssues: (scope: IssueScope) => listIssuesImpl(ctx, scope),
    discoverMetadata: (teamKeys: readonly string[]) => discoverMetadataImpl(ctx, teamKeys),
    getIssue: (id: string) => getIssueImpl(ctx, id),
    createIssue: (input: CreateIssueInput) => createIssueImpl(ctx, input),
    updateIssue: (id: string, patch: IssueUpdatePatch) => updateIssueImpl(ctx, id, patch),
    archiveIssue: (id: string) => archiveIssueImpl(ctx, id),
    findIssuesByAttachmentUrl: (attachmentUrl: string) => findIssuesByAttachmentUrlImpl(ctx, attachmentUrl),
    upsertAttachmentByUrl: (input: {
      readonly issueId: string;
      readonly url: string;
      readonly title: string;
      readonly subtitle?: string;
      readonly iconUrl?: string;
      readonly metadata: AttachmentMetadata;
    }) => upsertAttachmentByUrlImpl(ctx, input),
    updateAttachment: (id: string, metadata: AttachmentMetadata) => updateAttachmentImpl(ctx, id, metadata),
    getAttachmentByUrl: (url: string) => getAttachmentByUrlImpl(ctx, url),
    listAttachments: (issueId: string, cursor?: string | null) => listAttachmentsImpl(ctx, issueId, cursor),
  } satisfies LinearPort;
}
