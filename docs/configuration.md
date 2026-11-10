# Configuration model

`loadConfig()` resolves the complete configuration in a fixed precedence order
(constitution III):

```
built-in defaults  →  JSON config file  →  programmatic overrides
```

- **Objects merge recursively**; keys absent from higher layers are retained.
- **Arrays and scalars replace wholesale** — never concatenated or element-merged.
- `null` is a value (it replaces); `undefined` means "absent" (ignored).
- Output is `ResolvedConfig`: complete and post-defaults, with a deep-partial twin
  (`ConfigOverrides`) as input. `canonicalizeConfig()` serializes it deterministically
  (sorted keys) so identical inputs are byte-identical across runs (SC-001).

## Failure categories (config file)

Exactly three categories abort loading, always naming **file path + category**, and **no
partial configuration from that file is ever applied** (FR-006, SC-002):

| Category | Condition |
| --- | --- |
| `missing` | path is set but does not resolve to a file |
| `unreadable` | stat succeeds but reading throws |
| `invalid-json` | read succeeds but parsing fails or the root is not an object |

## Consumer-required workspace identities (no defaults — ever)

Identity values intentionally have **no defaults** (constitution III).
`validateWorkspaceIdentity()` runs once over the fully merged config and throws
`MissingIdentityError` naming **every** missing/empty value simultaneously (SC-002) —
empty strings and empty arrays count as absent:

- `teams` — ≥ 1 team key; per team: ≥ 1 project identity (`teams[<key>].projects`) and
  ≥ 1 workflow-state identity (`teams[<key>].workflowStates`: backlog/todo/inProgress/done)
- `projectByPath[n].teamKey` and `projectByPath[n].project` — both required per entry
  (project-only shapes are unsupported)
- `defaultTeamKey`, `defaultProject` — non-empty

Example file (`task-linear-sync.json`) using placeholder identifiers only:

```json
{
  "attachmentBaseHost": "https://sync.example.invalid",
  "teams": {
    "acme": {
      "projects": ["proj-alpha"],
      "workflowStates": { "backlog": "Backlog", "done": "Done", "completedTypes": ["completed"], "ignoredTypes": ["canceled", "duplicate"] }
    }
  },
  "projectByPath": [{ "prefix": "specs/", "teamKey": "acme", "project": "proj-alpha" }],
  "defaultTeamKey": "acme",
  "defaultProject": "proj-alpha"
}
```

## Credentials are never configuration

Only environment-variable **names** are configuration
(`credentialEnvVarNames.token` = `LINEAR_ACCESS_TOKEN`, `…apiKey` = `LINEAR_API_KEY`);
values are read at use time by later features and never enter `ResolvedConfig`.
A release-scan contract test (`tests/contract/defaults-scan.test.ts`) proves the shipped
defaults carry no token-shaped, UUID-shaped, email, or non-`example.invalid` host values.

## toolId derivations (001 R17.9)

Setting `toolId` re-derives every dependent default — each value independently
overridable (an explicit `metadataNamespaceKey`, for instance, always wins):

| Derived key | Formula |
| --- | --- |
| `envVarPrefix` | upper-snake-case `toolId` |
| `binName`, `stateDirAppSegment` | `toolId` |
| `configFileName` | `<toolId>.json` |
| `metadataNamespaceKey` | `__<toolId>` (avoids Linear reserved keys) |
| `syncAttachmentTitle` | `<toolId> sync state` |
| `manifestKeyEnvVarName` | `<PREFIX>_MANIFEST_KEY` |
| `web.authEnvVarName` / `mcp.authEnvVarName` | `<PREFIX>_WEB_TOKEN` / `<PREFIX>_MCP_TOKEN` |

## Per-adapter discovery overrides (programmatic layer)

The highest discovery layer (`DiscoveryOverrides.adapters.<id>`) overrides one built-in
row without touching the config file. Arrays and scalars **replace wholesale** (002 merge
semantics) — a programmatic `taskFilePatterns` is the complete new list, never a union:

```ts
import { discoverTaskFiles } from "task-linear-sync/discovery";

await discoverTaskFiles({
  repositoryRoot: repo,
  config,
  overrides: {
    adapters: {
      "spec-superpower": {
        // move the plans root (detection.pathPrefixes defaults to baseDirectories),
        baseDirectories: ["plans/superpowers/"],
        detection: { pathPrefixes: ["plans/superpowers/"] },
        // or widen the filename convention from dated plans to every plan file
        // (array replace: the dated basename glob no longer applies):
        taskFilePatterns: ["*.md"],
      },
    },
  },
});
```

With `taskFilePatterns: ["*.md"]` the plans-root gate stays — files above
`baseDirectories` remain unclaimed (feature 018, research R8). Precedence and
selection overrides (`overrides.precedence`, `overrides.selection`) short-circuit
detection entirely; see [framework-adapters.md](./framework-adapters.md).

## State directory placement

Unless `stateDirectory` is configured (used verbatim after canonicalization), the default
is `<platform-base>/<stateDirAppSegment>/<sha16(canonical repo root)>` — platform base =
`$XDG_STATE_HOME` or `~/.local/state` (Linux), `~/Library/Application Support` (macOS),
`%APPDATA%` (Windows). A resolved path inside or equal to the repository root **aborts**
with `StatePlacementError`; there is no in-tree fallback (SC-003). Directories are created
`0700`, every state file written via temp-file + rename at `0600`.

Full per-key tables: `specs/002-core-domain-contracts/data-model.md` §17;
defaults source: `src/config/defaults.ts` (release-scan target).
