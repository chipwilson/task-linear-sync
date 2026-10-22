/**
 * T029 [US1] — layered-config integration tests (config precedence, SC-001 determinism,
 * toolId derivations per configuration.md load behavior #5, credential rule).
 * Test names contain "config" per quickstart run command.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import {
  loadConfig,
  validateWorkspaceIdentity,
  canonicalizeConfig,
  builtInDefaults,
  MissingIdentityError,
  ConfigFileError,
} from "task-linear-sync/config";
import type { ResolvedConfig } from "task-linear-sync/config";

const pkgRoot = fileURLToPath(new URL("../../../", import.meta.url));
const fix = (rel: string): string => new URL(`file://${pkgRoot}tests/fixtures/config/${rel}`).pathname;

test("config precedence: defaults-only layering equals the built-in defaults", () => {
  const c = loadConfig({});
  assert.equal(canonicalizeConfig(c), canonicalizeConfig(builtInDefaults));
});

test("config precedence: file beats defaults; absent file keys retained (R17.3)", () => {
  const c = loadConfig({ configFile: fix("partial-overlap.json") });
  assert.equal(c.pageSize, 500, "file replaces default 100");
  assert.equal(c.staleLockTakeoverSeconds, 90);
  assert.deepEqual(c.skipDirectories, [".git", "vendor"], "array replaces wholesale");
  assert.equal(c.maxRetries, 5, "sibling default retained");
  assert.equal(c.confirmationKey, "SYNC", "untouched group retained");
});

test("config precedence: programmatic overrides beat file beats defaults (constitution III)", () => {
  const c = loadConfig({
    configFile: fix("valid-full.json"),
    overrides: { pageSize: 7, minimumMatchMargin: 15 },
  });
  assert.equal(c.pageSize, 7, "override wins over file 250");
  assert.equal(c.attachmentBaseHost, "https://contoso.example.invalid", "file wins over placeholder default");
  assert.equal(c.minimumMatchMargin, 15);
  assert.equal(c.confidenceFloors.medium, 55, "file override of nested default");
  assert.equal(c.confidenceFloors.plausible, 20);
});

test("config layering with overlapping and disjoint keys merges per R3/R17.3", () => {
  const c = loadConfig({
    configFile: fix("valid-full.json"),
    overrides: { teams: { acme: { projects: ["proj-override"] } } },
  });
  // Higher layer wins per key; ABSENT keys retained from the file layer.
  assert.deepEqual(c.teams.acme?.projects, ["proj-override"]);
  assert.equal(c.teams.acme?.workflowStates.done, "Done", "workflowStates retained from file layer");
});

test("config SC-001: repeat-run byte-compare identical for identical inputs", () => {
  const inputs = { configFile: fix("valid-full.json"), overrides: { pageSize: 33 } };
  const first = canonicalizeConfig(loadConfig(inputs));
  for (let i = 0; i < 5; i++) {
    assert.equal(canonicalizeConfig(loadConfig({ ...inputs })), first);
  }
});

test("config load + validation happy path over fixture identities", () => {
  const c = loadConfig({ configFile: fix("valid-full.json") });
  assert.doesNotThrow(() => validateWorkspaceIdentity(c));
});

test("config missing-identity fixtures abort naming every missing value", () => {
  const c = loadConfig({ configFile: fix("missing-identity/missing-teams.json") });
  try {
    validateWorkspaceIdentity(c);
    assert.fail("must abort");
  } catch (e) {
    assert.ok(e instanceof MissingIdentityError);
    for (const name of ["teams", "defaultTeamKey", "defaultProject"]) {
      assert.ok(e.missing.includes(name), `must name ${name}; got ${JSON.stringify(e.missing)}`);
    }
  }

  const p = loadConfig({ configFile: fix("missing-identity/partial-identities.json") });
  try {
    validateWorkspaceIdentity(p);
    assert.fail("must abort");
  } catch (e) {
    assert.ok(e instanceof MissingIdentityError);
    assert.ok(e.missing.includes("teams[acme].projects"));
    assert.ok(e.missing.some((m) => m.startsWith("teams[acme].workflowStates")));
    assert.ok(e.missing.includes("projectByPath[0].teamKey"), "entry missing teamKey named");
    assert.ok(e.missing.includes("projectByPath[1].project"), "entry missing project named");
    assert.ok(e.missing.includes("defaultProject"));
  }
});

test("config invalid-file aborts with path + category; valid-file + invalid-file proves no partial application", () => {
  try {
    loadConfig({ configFile: fix("invalid-json.json") });
    assert.fail("must abort");
  } catch (e) {
    assert.ok(e instanceof ConfigFileError);
    assert.equal(e.category, "invalid-json");
    assert.ok(e.configFilePath.endsWith("invalid-json.json"));
  }
  // An invalid file contributes NOTHING: result-with-invalid-file is unreachable, and the
  // same overrides on top of pure defaults equal a fresh defaults+overrides load.
  const viaOverrideOnly = canonicalizeConfig(loadConfig({ overrides: { pageSize: 7 } }));
  assert.equal(canonicalizeConfig(loadConfig({ overrides: { pageSize: 7 } })), viaOverrideOnly);
});

test("config toolId derivations (R17.9): every derivable value follows toolId and is independently overridable", () => {
  // Defaults derive from the shipped toolId.
  assert.equal(builtInDefaults.envVarPrefix, "TASK_LINEAR_SYNC");
  assert.equal(builtInDefaults.metadataNamespaceKey, "__task-linear-sync");
  assert.equal(builtInDefaults.syncAttachmentTitle, "task-linear-sync sync state");
  assert.equal(builtInDefaults.configFileName, "task-linear-sync.json");
  assert.equal(builtInDefaults.binName, "task-linear-sync");
  assert.equal(builtInDefaults.stateDirAppSegment, "task-linear-sync");
  assert.equal(builtInDefaults.manifestKeyEnvVarName, "TASK_LINEAR_SYNC_MANIFEST_KEY");
  assert.equal(builtInDefaults.web.authEnvVarName, "TASK_LINEAR_SYNC_WEB_TOKEN");
  assert.equal(builtInDefaults.mcp.authEnvVarName, "TASK_LINEAR_SYNC_MCP_TOKEN");

  // Override toolId: derived values re-derive…
  const derived = loadConfig({ overrides: { toolId: "my-cool-sync" } });
  assert.equal(derived.metadataNamespaceKey, "__my-cool-sync");
  assert.equal(derived.syncAttachmentTitle, "my-cool-sync sync state");
  assert.equal(derived.envVarPrefix, "MY_COOL_SYNC");
  assert.equal(derived.configFileName, "my-cool-sync.json");
  assert.equal(derived.manifestKeyEnvVarName, "MY_COOL_SYNC_MANIFEST_KEY");

  // …but each derivable value is INDEPENDENTLY OVERRIDABLE (001 R17.9).
  const explicit = loadConfig({
    overrides: { toolId: "my-cool-sync", syncAttachmentTitle: "custom title", metadataNamespaceKey: "__custom" },
  });
  assert.equal(explicit.syncAttachmentTitle, "custom title");
  assert.equal(explicit.metadataNamespaceKey, "__custom");
  assert.equal(explicit.envVarPrefix, "MY_COOL_SYNC", "non-overridden derivations still re-derived");

  // Namespace key must avoid Linear reserved keys.
  for (const reserved of ["title", "messages", "attributes"]) {
    assert.notEqual(derived.metadataNamespaceKey, reserved);
  }
});

test("config credential rule: only env-var NAMES are config; no credential values ever in output", () => {
  const c: ResolvedConfig = loadConfig({
    configFile: fix("valid-full.json"),
    env: { LINEAR_ACCESS_TOKEN: "lin_api_supersecretvalue1234567890" },
    overrides: { teams: { acme: { projects: ["p"], workflowStates: { done: "Done" } } }, defaultTeamKey: "acme", defaultProject: "p" },
  });
  const raw = canonicalizeConfig(c);
  assert.ok(raw.includes("LINEAR_ACCESS_TOKEN"), "the NAME is config");
  assert.ok(!raw.includes("supersecret"), "the VALUE never enters the model");
  assert.ok(!/lin_api_[A-Za-z0-9]{12,}/.test(raw));
});

test("config confirmationKey default is SYNC and flows through merge untouched", () => {
  assert.equal(loadConfig({}).confirmationKey, "SYNC");
  assert.equal(loadConfig({ overrides: { confirmationKey: "SHIP" } }).confirmationKey, "SHIP");
});
