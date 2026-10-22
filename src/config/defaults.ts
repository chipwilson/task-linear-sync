/**
 * Built-in defaults (frozen contract surface). RELEASE-SCAN TARGET: zero real
 * organization identifiers, team keys, tokens, or UUID values (constitution III;
 * enforced by tests/contract/defaults-scan.test.ts). Routing values NEVER default
 * (empty here — validation-required). Defaults summarized from 001 R17.4 via
 * data-model.md §17.
 */
import type { ResolvedConfig } from "./schema.js";

const DEFAULT_TOOL_ID = "task-linear-sync";

/** toolId → tool-owned env-var prefix: upper snake case. */
export function envVarPrefixFor(toolId: string): string {
  return toolId.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

/** Derivation table used by defaults construction AND re-derivation in load.ts (001 R17.9). */
export const DERIVATIONS: ReadonlyArray<{
  /** Dot-path into ResolvedConfig. */
  readonly path: string;
  readonly derive: (toolId: string) => string;
}> = [
  { path: "envVarPrefix", derive: envVarPrefixFor },
  { path: "binName", derive: (t) => t },
  { path: "configFileName", derive: (t) => `${t}.json` },
  { path: "stateDirAppSegment", derive: (t) => t },
  { path: "metadataNamespaceKey", derive: (t) => `__${t}` }, // avoids Linear reserved keys (leading __)
  { path: "syncAttachmentTitle", derive: (t) => `${t} sync state` },
  { path: "manifestKeyEnvVarName", derive: (t) => `${envVarPrefixFor(t)}_MANIFEST_KEY` },
  { path: "web.authEnvVarName", derive: (t) => `${envVarPrefixFor(t)}_WEB_TOKEN` },
  { path: "mcp.authEnvVarName", derive: (t) => `${envVarPrefixFor(t)}_MCP_TOKEN` },
];

export const builtInDefaults: ResolvedConfig = {
  // ── Tool identity (generic placeholder identity; every derivable value overridable) ──
  toolId: DEFAULT_TOOL_ID,
  envVarPrefix: envVarPrefixFor(DEFAULT_TOOL_ID),
  binName: DEFAULT_TOOL_ID,
  configFileName: `${DEFAULT_TOOL_ID}.json`,
  stateDirAppSegment: DEFAULT_TOOL_ID,

  // ── Discovery: generic framework directory names are discovery defaults, not routing defaults ──
  frameworkAdapters: ["bmad", "spec-kit", "open-spec", "kiro", "generic"],
  taskFilePatterns: ["tasks.md", "TASKS.md"],
  specsBaseDirectories: ["specs/", ".kiro/specs/", "openspec/", "bmad/"],
  skipDirectories: [".git", "node_modules", "dist", ".next", "coverage"],
  siblingDocuments: ["spec.md", "plan.md", "research.md"],

  // ── Grammar (001 R17.4; overridable regex sources; tab width 2) ──
  headingIdGrammar: "^\\s{0,3}#{1,6}\\s+(?:(?<id>[0-9]+(?:\\.[0-9]+)*|[A-Za-z][A-Za-z0-9-]*\\d*)[.:]?\\s+)?(?<title>.+)$",
  phasePattern: "^\\s{0,3}#{1,2}\\s+Phase\\s+[0-9]+[.:]?\\s*(?<phase>.*)$",
  summaryPattern: "^\\s{0,3}#{2,4}\\s+(?:Summary|Overview)\\b",
  rollupPattern: "\\b(?:parent|roll-?up)\\b",
  flatChecklistMarkers: ["- [ ]", "- [x]", "- [X]", "* [ ]", "* [x]", "* [X]"],
  tabWidth: 2,

  // ── Routing: CONSUMER-REQUIRED — empty placeholders that always fail validation (FR-007) ──
  teams: {},
  projectByPath: [],
  defaultTeamKey: "",
  defaultProject: "",

  // ── Matching (weights all >= 0) ──
  scoringWeights: {
    durableUuid: 1000,
    issueRefExact: 500,
    titleExact: 60,
    titleTokenOverlap: 30,
    featureNameMatch: 20,
    filePathProximity: 10,
    samePhase: 5,
    kindMatch: 2,
  },
  confidenceFloors: { medium: 50, plausible: 18 },
  minimumMatchMargin: 10,

  // ── Tracker ──
  pageSize: 100,
  maxRetries: 5,
  concurrency: 4,
  personalKeyPrefix: "lin_api_",
  credentialEnvVarNames: { token: "LINEAR_ACCESS_TOKEN", apiKey: "LINEAR_API_KEY" },
  completedStateTypes: ["completed"],
  ignoredStateTypes: ["canceled", "duplicate"],

  // ── Attachment (benign placeholder host only) ──
  attachmentUrlTemplate: "{baseHost}/{toolId}/{uuid}",
  continuationUrlTemplate: "{baseHost}/{toolId}/{uuid}/{page}",
  attachmentBaseHost: "https://sync.example.invalid",
  metadataNamespaceKey: `__${DEFAULT_TOOL_ID}`,
  syncAttachmentTitle: `${DEFAULT_TOOL_ID} sync state`,
  historyLogMaxEntries: 50,

  // ── Sync semantics (conflict maps per 001 R17.4 built-in defaults, data-model §7) ──
  confirmationKey: "SYNC",
  bootstrapConflictMap: {
    "linear-changed": "overwrite-linear",
    "spec-changed": "overwrite-linear",
    "both-changed": "overwrite-linear",
  },
  syncConflictMap: {
    "linear-changed": "overwrite-spec",
    "spec-changed": "overwrite-linear",
    "both-changed": "report-only",
  },
  descriptionNormalizationProfile: "standard",
  titleRules: [],
  titleStripPrefixes: [],

  // ── Run state (per constitution defaults; stateDirectory has NO default — platform default computed) ──
  auditManifestEnabled: true,
  auditManifestEncryptionEnabled: true,
  manifestExpiryDays: 30,
  staleLockTakeoverSeconds: 60,
  manifestKeyEnvVarName: `${envVarPrefixFor(DEFAULT_TOOL_ID)}_MANIFEST_KEY`,
  manifestKeyId: "primary",

  // ── Surfaces ──
  managedGitHooks: ["pre-push", "post-merge"],
  worker: { claimTimeoutSeconds: 300, maxConcurrentRuns: 1 },
  web: {
    accessControlMode: "private",
    realtimeSse: true,
    pollIntervalSeconds: 15,
    cacheTtlSeconds: 10,
    authEnvVarName: `${envVarPrefixFor(DEFAULT_TOOL_ID)}_WEB_TOKEN`,
  },
  mcp: {
    mutatingToolsEnabled: false,
    transport: "stdio",
    authEnvVarName: `${envVarPrefixFor(DEFAULT_TOOL_ID)}_MCP_TOKEN`,
  },
};
