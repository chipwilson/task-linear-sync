/**
 * Built-in defaults (frozen contract surface). RELEASE-SCAN TARGET: zero real
 * organization identifiers, team keys, tokens, or UUID values (constitution III;
 * enforced by tests/contract/defaults-scan.test.ts). Routing values NEVER default
 * (empty here — validation-required). Defaults summarized from 001 R17.4 via
 * data-model.md §17.
 *
 * 024 amendment A-024-0 (constitution v1.1.0 platform-default exception): the
 * workflow-state NAME tables below DO ship as built-in defaults — they are
 * Linear's own platform-generic default state names (zero org-specific literals)
 * and remain fully overridable through the existing per-team precedence. They
 * materialize per configured team through the load-time resolution pass
 * (`applyStateMappingDefaults` in load.ts), never as rows in `builtInDefaults.teams`
 * (team keys are dynamic).
 */
import type { ResolvedConfig } from "./schema.js";
import type { LaneName } from "../domain/routing.js";

const DEFAULT_TOOL_ID = "task-linear-sync";

/**
 * 024 C1.1 — the four workflow-state identity defaults: Linear's default team
 * workflow names (research R2). `canceled` has NO name identity (the
 * `ignoredStateTypes: ["canceled","duplicate"]` TYPE defaults already cover it).
 */
export const DEFAULT_WORKFLOW_STATE_NAMES: Readonly<Record<"backlog" | "todo" | "inProgress" | "done", string>> = {
  backlog: "Backlog",
  todo: "Todo",
  inProgress: "In Progress",
  done: "Done",
};

/**
 * 024 C1.1 — the default lane → workflow-state map (spec-kitty lanes, research R2).
 * Review-adjacent lanes collapse onto "In Progress" (the default workflow has no
 * review state); NO `blocked` entry — lanes without a sensible counterpart stay
 * on the `lane-state-unmapped` posture (FR-003).
 */
export const DEFAULT_LANE_STATE_MAP: Readonly<Partial<Record<LaneName, string>>> = {
  planned: "Backlog",
  claimed: "Todo",
  in_progress: "In Progress",
  for_review: "In Progress",
  in_review: "In Progress",
  approved: "In Progress",
  done: "Done",
  canceled: "Canceled",
};

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
  frameworkAdapters: ["bmad", "spec-kit", "open-spec", "kiro", "spec-superpower", "spec-kitty", "generic"],
  taskFilePatterns: ["tasks.md", "TASKS.md"],
  specsBaseDirectories: ["specs/", ".kiro/specs/", "openspec/", "bmad/"],
  skipDirectories: [".git", "node_modules", "dist", ".next", "coverage"],
  siblingDocuments: ["spec.md", "plan.md", "research.md"],

  // ── Grammar (001 R17.4; overridable regex sources; tab width 2) ──
  // 021 amendment A-021-2: the word-form id branch must contain a digit, so
  // `TASK-1`/`SYNC1`/`T001`-style ids still capture while an ordinary title such as
  // `# Implementation Plan` yields no id and keeps its full text (research R4.1/R6).
  // The branch is the previous `[A-Za-z][A-Za-z0-9-]*\d*` with the digit REQUIRED —
  // every former digit-bearing capture is preserved byte-identically; only digit-less
  // word ids drop out. The numeric/dotted-numeric branch and the catch-all title group
  // are unchanged — id-less headings remain heading tasks (corpus model, FR-009).
  headingIdGrammar: "^\\s{0,3}#{1,6}\\s+(?:(?<id>[0-9]+(?:\\.[0-9]+)*|[A-Za-z][A-Za-z0-9-]*\\d[A-Za-z0-9-]*)[.:]?\\s+)?(?<title>.+)$",
  phasePattern: "^\\s{0,3}#{1,2}\\s+Phase\\s+[0-9]+[.:]?\\s*(?<phase>.*)$",
  summaryPattern: "^\\s{0,3}#{2,4}\\s+(?:Summary|Overview)\\b",
  rollupPattern: "\\b(?:parent|roll-?up)\\b",
  flatChecklistMarkers: ["- [ ]", "- [x]", "- [X]", "* [ ]", "* [x]", "* [X]"],
  tabWidth: 2,
  // 020 amendment A-020-1 (Maintainer Ruling 2026-11-18): the intelligent default is a
  // flat board — only depth-1 tasks become issues; set 64 for effectively unlimited
  // (the pre-020 behavior). Benign integer: the release scan never sees a string leaf.
  maxTaskIssueDepth: 1,

  // ── Routing: CONSUMER-REQUIRED — empty placeholders that always fail validation (FR-007) ──
  teams: {},
  projectByPath: [],
  defaultTeamKey: "",
  defaultProject: "",
  // 024 A-024-1 (FR-001/FR-004): task state mapping is default-ON; the name/lane
  // tables above materialize per configured team at load time. `false` restores the
  // pre-024 untouched-state posture globally (per-team: workflowStates.mappingEnabled).
  stateMappingEnabled: true,

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
    // 014 amendment: defaults reproduce pre-amendment observable behavior (generous caps).
    maxCacheEntries: 500,
    maxConcurrentWalks: 8,
    maxConcurrentSseStreams: 16,
    secureCookies: false,
  },
  mcp: {
    mutatingToolsEnabled: false,
    transport: "stdio",
    authEnvVarName: `${envVarPrefixFor(DEFAULT_TOOL_ID)}_MCP_TOKEN`,
    planReferenceTtlSeconds: 3600,
    planReferenceMaxEntries: 1000,
  },
};
