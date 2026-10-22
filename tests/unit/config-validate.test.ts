/**
 * T028 [US1] — required-identity validation unit tests (research R5, FR-007, SC-002).
 * validateWorkspaceIdentity collects ALL missing/empty required values before failing and
 * names each one — never fail-fast-on-first-error.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { validateWorkspaceIdentity, MissingIdentityError, loadConfig } from "task-linear-sync/config";
import type { ResolvedConfig } from "task-linear-sync/config";

const BASE: ResolvedConfig = loadConfig({});

/** Shallow-mutable view used only to CONSTRUCT test fixtures. */
type Mutable<T> = { -readonly [K in keyof T]: T[K] };

function withConfig(patch: (c: Mutable<ResolvedConfig>) => unknown): ResolvedConfig {
  const draft = structuredClone(BASE) as unknown as Mutable<ResolvedConfig>;
  patch(draft);
  return draft as unknown as ResolvedConfig;
}

function missingOf(c: ResolvedConfig): readonly string[] | null {
  try {
    validateWorkspaceIdentity(c);
    return null;
  } catch (e) {
    assert.ok(e instanceof MissingIdentityError, `expected MissingIdentityError, got ${String(e)}`);
    return e.missing;
  }
}

const validTeam = {
  projects: ["proj-alpha"],
  workflowStates: { done: "Done", backlog: "Backlog", completedTypes: ["completed"] },
};

test("required identities — fully specified workspace validates clean", () => {
  const ok = withConfig((c) => {
    c.teams = { acme: validTeam };
    c.projectByPath = [{ prefix: "specs/", teamKey: "acme", project: "proj-alpha" }];
    c.defaultTeamKey = "acme";
    c.defaultProject = "proj-alpha";
    return c;
  });
  assert.equal(missingOf(ok), null);
});

test("required identities — built-in defaults alone abort — identity has NO defaults (constitution III)", () => {
  const missing = missingOf(BASE);
  assert.ok(missing, "defaults alone must not validate");
  assert.ok(missing.includes("teams"));
  assert.ok(missing.includes("defaultTeamKey"));
  assert.ok(missing.includes("defaultProject"));
});

test("required identities — ABORT NAMES EVERY missing value simultaneously (SC-002, no fail-fast-on-first)", () => {
  const c = withConfig((cfg) => {
    cfg.teams = {
      acme: { projects: [], workflowStates: {} }, // empty projects + empty workflowStates
      blue: { projects: ["sky"], workflowStates: { done: "Done" } }, // OK
    };
    cfg.projectByPath = [
      { prefix: "a", teamKey: "acme", project: "p" },
      { prefix: "b", teamKey: "", project: "" }, // BOTH required fields absent (empty strings count as absent)
    ];
    cfg.defaultTeamKey = " "; // whitespace-only counts as absent
    cfg.defaultProject = "";
    return cfg;
  });
  const missing = missingOf(c);
  assert.ok(missing);
  assert.ok(missing.includes("teams[acme].projects"), `missing=${JSON.stringify(missing)}`);
  assert.ok(missing.some((m) => m.startsWith("teams[acme].workflowStates")), "no workflow-state identity");
  assert.ok(
    missing.some((m) => /projectByPath\[\d+\]\.teamKey/.test(m)),
    "empty teamKey named",
  );
  assert.ok(
    missing.some((m) => /projectByPath\[\d+\]\.project/.test(m)),
    "empty project named",
  );
  assert.ok(missing.includes("defaultTeamKey"));
  assert.ok(missing.includes("defaultProject"));
  // The healthy entries must NOT be named.
  assert.equal(
    missing.some((m) => m.startsWith("teams[blue]")),
    false,
  );
});

test("required identities — empty arrays and empty strings count as absent (001 R17.5)", () => {
  const c = withConfig((cfg) => {
    cfg.teams = { acme: { projects: ["  "].map((s) => s.trim()), workflowStates: {} }, zeta: { projects: [], workflowStates: { done: "" } } };
    cfg.projectByPath = [];
    cfg.defaultTeamKey = "acme";
    cfg.defaultProject = "p";
    return cfg;
  });
  const missing = missingOf(c);
  assert.ok(missing);
  assert.ok(missing.includes("teams[acme].projects"));
  assert.ok(missing.some((m) => m.startsWith("teams[zeta].workflowStates")));
});

test("required identities — at least ONE team required; per team >=1 project identity and >=1 workflow-state identity", () => {
  const c = withConfig((cfg) => {
    cfg.teams = {};
    cfg.projectByPath = [{ prefix: "specs/", teamKey: "acme", project: "alpha" }];
    cfg.defaultTeamKey = "acme";
    cfg.defaultProject = "alpha";
    return cfg;
  });
  assert.deepEqual(missingOf(c), ["teams"]);
});

test("required identities — ProjectByPath entries must carry BOTH teamKey and project (project-only unsupported shape)", () => {
  const c = withConfig((cfg) => {
    cfg.teams = { acme: validTeam };
    cfg.projectByPath = [{ prefix: "a", teamKey: "acme", project: "p1" }, { prefix: "b", teamKey: "acme", project: "" }, { prefix: "c", teamKey: "", project: "p3" }];
    cfg.defaultTeamKey = "acme";
    cfg.defaultProject = "p1";
    return cfg;
  });
  const missing = missingOf(c);
  assert.ok(missing);
  assert.ok(missing.includes("projectByPath[1].project"));
  assert.ok(missing.includes("projectByPath[2].teamKey"));
});
