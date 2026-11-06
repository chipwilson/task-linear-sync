# 012 test fixtures — placeholder-identifier conventions

Every literal under this folder follows the repo-wide placeholder rules (Principle III,
defaults-scan + credential-sentinel contracts):

- Repository/tool identifiers: `task-linear-sync` (the package's own id) and `example-*`
  placeholders only. No real org names, team keys, or tenant ids.
- Ids shaped like UUIDs or 64-hex digests are SYNTHETIC and obviously fake: all-zero or
  repeated-character forms (`00000000-0000-4000-8000-000000000000`, `a`×64). They are
  shape probes, never decision-bearing values.
- Token-shaped material uses the shared sentinel vocabulary from
  `tests/contract/mcp-credential-sentinel.test.ts` (`MCP-SENTINEL-*`), planted ONLY
  through the injected env seam — never persisted in a fixture file.
- Hostnames use reserved `.invalid` / `example.invalid`; ports are ephemeral (`0`) or
  documented test ports; nothing here encodes a reachable endpoint.
- Timestamps come from the fixed harness clock (ISO strings), never wall-clock values.

Worlds: the 012 harness reuses the 009 CLI worlds (`tests/fixtures/cli/worlds/*`) and the
008 engine worlds (`tests/fixtures/engine/worlds/*`) unchanged; this folder only adds the
settings seeds below.

## settings/

`settings/enabled-http.json` — programmatic `McpSettings` override seed used by the
harness when a test opts into the networked transport: enabling is expressed ONLY as the
`{ "enabled": true, "transport": "http" }` override pair passed through the
`settings` dependency, keeping fixtures free of credential material by construction.
