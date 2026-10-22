/**
 * Configuration model types (frozen contract — contracts/configuration.md).
 * ResolvedConfig: complete, post-merge, post-defaults. ConfigOverrides: deep-partial twin.
 * Credential *values* are NEVER config — only env-var NAMES are (constitution).
 * Groups per data-model.md §17.
 */
import type { FrameworkId } from "../domain/task.js";
import type { ProjectByPathEntry, TeamIdentity } from "../domain/routing.js";
import type { ConflictResolutionMap } from "../domain/checkpoint.js";
import type { Clock } from "../state/clock.js";

/** Deep-partial twin of ResolvedConfig; arrays replace wholesale, so they stay whole here. */
export type DeepPartial<T> = T extends readonly (infer _U)[]
  ? T
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

export interface ScoringWeights {
  readonly durableUuid: number;
  readonly issueRefExact: number;
  readonly titleExact: number;
  readonly titleTokenOverlap: number;
  readonly featureNameMatch: number;
  readonly filePathProximity: number;
  readonly samePhase: number;
  readonly kindMatch: number;
}

export interface ConfidenceFloors {
  /** Band floor for "medium". */
  readonly medium: number;
  /** Band floor for "low" (plausible). */
  readonly plausible: number;
}

export interface CredentialEnvVarNames {
  readonly token: string;
  readonly apiKey: string;
}

export interface WebSurfaceConfig {
  readonly accessControlMode: "private" | "public";
  readonly realtimeSse: boolean;
  /** 15 s default. */
  readonly pollIntervalSeconds: number;
  /** 10 s default. */
  readonly cacheTtlSeconds: number;
  /** toolId-derived env-var NAME. */
  readonly authEnvVarName: string;
}

export interface McpSurfaceConfig {
  /** Gated mutating MCP tools ship disabled (constitution I surface posture). */
  readonly mutatingToolsEnabled: boolean;
  readonly transport: "stdio" | "http";
  /** toolId-derived env-var NAME. */
  readonly authEnvVarName: string;
}

export interface WorkerConfig {
  /** Claim/reclaim thresholds per 001 R13 (behavior 010). */
  readonly claimTimeoutSeconds: number;
  readonly maxConcurrentRuns: number;
}

/** Complete, post-merge, post-defaults configuration. */
export interface ResolvedConfig {
  // ── Tool identity (every derivable value independently overridable — 001 R17.9) ──
  readonly toolId: string;
  /** Uppercased, non-alnum-stripped toolId; derives tool-owned env-var names. */
  readonly envVarPrefix: string;
  /** CLI bin name; defaults to toolId. */
  readonly binName: string;
  /** Default config-file name; `${toolId}.json`. */
  readonly configFileName: string;
  /** Application segment of the platform-default state directory; defaults to toolId. */
  readonly stateDirAppSegment: string;

  // ── Discovery (generic defaults — never routing values) ──
  readonly frameworkAdapters: readonly FrameworkId[];
  /** Basename glob/pattern list. */
  readonly taskFilePatterns: readonly string[];
  readonly specsBaseDirectories: readonly string[];
  readonly skipDirectories: readonly string[];
  /** Configured sibling spec docs; absent siblings omitted without error. */
  readonly siblingDocuments: readonly string[];

  // ── Grammar (regex sources, overridable) ──
  readonly headingIdGrammar: string;
  readonly phasePattern: string;
  readonly summaryPattern: string;
  readonly rollupPattern: string;
  readonly flatChecklistMarkers: readonly string[];
  readonly tabWidth: number;

  // ── Routing (CONSUMER-REQUIRED — no defaults exist; validation-required, FR-007) ──
  readonly teams: Readonly<Record<string, TeamIdentity>>;
  readonly projectByPath: readonly ProjectByPathEntry[];
  readonly defaultTeamKey: string;
  readonly defaultProject: string;

  // ── Matching ──
  readonly scoringWeights: ScoringWeights;
  readonly confidenceFloors: ConfidenceFloors;
  readonly minimumMatchMargin: number;

  // ── Tracker ──
  readonly pageSize: number;
  readonly maxRetries: number;
  readonly concurrency: number;
  /** Personal key PREFIX constant (diagnostics shape); never a token value. */
  readonly personalKeyPrefix: string;
  readonly credentialEnvVarNames: CredentialEnvVarNames;
  readonly completedStateTypes: readonly string[];
  readonly ignoredStateTypes: readonly string[];

  // ── Attachment (URL scheme templates; placeholders {baseHost} {toolId} {uuid} {page}) ──
  readonly attachmentUrlTemplate: string;
  readonly continuationUrlTemplate: string;
  /** Benign placeholder host — release-scan guarantee (zero org identifiers). */
  readonly attachmentBaseHost: string;
  /** `__<toolId>` — must avoid Linear reserved keys title|messages|attributes. */
  readonly metadataNamespaceKey: string;
  /** `<toolId> sync state`. */
  readonly syncAttachmentTitle: string;
  readonly syncAttachmentSubtitle?: string;
  readonly syncAttachmentIconUrl?: string;
  /** Rollover threshold (default 50). */
  readonly historyLogMaxEntries: number;
  /** Optional size rollover threshold. */
  readonly historyLogMaxBytes?: number;

  // ── Sync semantics ──
  /** Default "SYNC"; merged value used for exact-match gates, never compared to a constant (001 R17.7). */
  readonly confirmationKey: string;
  readonly bootstrapConflictMap: ConflictResolutionMap;
  readonly syncConflictMap: ConflictResolutionMap;
  readonly descriptionNormalizationProfile: string;
  readonly titleRules: readonly string[];
  readonly titleStripPrefixes: readonly string[];

  // ── Run state ──
  /** No default — platform default computed from canonical repo root (state/paths.ts). */
  readonly stateDirectory?: string;
  readonly auditManifestEnabled: boolean;
  readonly auditManifestEncryptionEnabled: boolean;
  readonly manifestExpiryDays: number;
  readonly staleLockTakeoverSeconds: number;
  /** Env-var NAME holding the manifest key (never the key itself). */
  readonly manifestKeyEnvVarName: string;
  /** Logical key id handed to the KeyProvider. */
  readonly manifestKeyId: string;

  // ── Surfaces ──
  readonly managedGitHooks: readonly string[];
  /** Per-framework default supplied by adapters (003); absent until framework selects it. */
  readonly agentHooksDirectory?: string;
  readonly worker: WorkerConfig;
  readonly web: WebSurfaceConfig;
  readonly mcp: McpSurfaceConfig;
}

/** Deep-partial input for file + programmatic sources. */
export type ConfigOverrides = DeepPartial<ResolvedConfig>;

/** Exactly three file failure categories (research R4). */
export type ConfigFailureCategory = "missing" | "unreadable" | "invalid-json";

/** Thrown by loadConfig: names the file path and the failure category (FR-006). */
export class ConfigFileError extends Error {
  override readonly name = "ConfigFileError";
  readonly category: ConfigFailureCategory;
  readonly configFilePath: string;
  /** Parse/OS diagnostic, sanitized. */
  readonly detail?: string;
  constructor(category: ConfigFailureCategory, configFilePath: string, detail?: string) {
    super(`configuration file '${configFilePath}' failed: ${category}${detail ? ` (${detail})` : ""}`);
    this.category = category;
    this.configFilePath = configFilePath;
    this.detail = detail;
  }
}

/** Thrown by validateWorkspaceIdentity: EVERY missing/empty required value, named (FR-007). */
export class MissingIdentityError extends Error {
  override readonly name = "MissingIdentityError";
  readonly missing: readonly string[];
  constructor(missing: readonly string[]) {
    super(`missing required workspace identities: ${missing.join(", ")}`);
    this.missing = missing;
  }
}

export interface LoadConfigOptions {
  /** Programmatic layer (highest precedence). */
  readonly overrides?: ConfigOverrides;
  /** Resolved config-file path (defaults + overrides only when absent). */
  readonly configFile?: string;
  /** Environment view for NAME-based lookups; values are never stored into ResolvedConfig. */
  readonly env?: Record<string, string | undefined>;
  /** Injected (R16) — used for derived values only. */
  readonly clock?: Clock;
}
