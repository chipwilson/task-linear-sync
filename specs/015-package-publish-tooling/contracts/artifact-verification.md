# Contract: Artifact Verification (stage 7) + Defaults Scan (stage 8)

Verification consumes **only the packed tarball** in an isolated consumer environment
(FR-004); the scan runs over the archive's extracted contents (FR-005). FR-011 folds the
published-posture assertions into stage 7.

## 1. Packing (stage 6) and file-list reads

- `npm pack --json` in the repository root → exactly one `.tgz` (contract test uses the
  real pack on a fixture world; CI runs it for real).
- Actual file list read TWO ways — `npm pack --json` entries AND `tar -tzf` — which must
  agree (belt-and-braces against either reader lying, research R5).
- Expected list DERIVED from `package.json` `files` (`data-model.md §4`) — never a second
  hard-coded list. `files` after 015: `["dist", "README.md", "docs", "LICENSE",
  "CHANGELOG.md"]`.

## 2. Consumer environment (stage 7 — FR-004)

Built under `mkdtemp` in the OS temp dir; the repository tree is NOT on the module path:

| Check | Procedure | Failure |
|---|---|---|
| install | `npm init -y` → `npm install <tarball>`; hermetic by construction (zero runtime deps, offline) | `STAGE_FAILED:archive-verify` |
| every export subpath imports | for each key of the INSTALLED package's `exports` map, `import("<pkg>/<sub>")` executes the runtime entry — covers `.`, `./domain` … `./ci`, `./mcp`, `./history-server` (constitution Release gates: all declared entry points) | `EXPORT_UNRESOLVED:<subpath>` |
| every subpath has loadable declarations | generated `consumer-types.ts` imports all subpaths; the repository's own `tsc --noEmit` (NodeNext) against the installed package proves each `types` condition resolves | `TYPES_UNRESOLVED:<subpath>` |
| CLI binary runs | spawn `node_modules/.bin/task-linear-sync --version`; exit 0; stdout equals `task-linear-sync <version>` | `CLI_VERSION_MISMATCH` |
| version equality | `import("<pkg>/mcp").SERVER_VERSION === <version>` (embedded-version artifact check, FR-002/SC-004) | `STALE_VERSION_DERIVATION` |
| manifest allow-list | actual (both readers) === expected (derived) | `ARCHIVE_ALLOWLIST` |
| required members | `LICENSE` present with standard MIT text; `CHANGELOG.md` present containing `## [<version>]` | `LICENSE_MISSING` / `CHANGELOG_MISSING` |
| published posture (FR-011) | published `package.json`: `type: "module"`; `engines.node === ">=20.0.0"`; `dependencies` absent/empty (transport allowance unspent) or exactly the MCP-SDK allowance with `./mcp` scoping intact; every declared export subpath present with `types` FIRST; `license: "MIT"`; `bin` present | `POSTURE_DRIFT` |

## 3. Defaults scan over the archive (stage 8 — FR-005)

- Extract tarball to a temp dir (`tar -xzf`; platform tool).
- `scripts/lib/secret-scan.mjs` (extracted VERBATIM from the contract-tested
  `ci-defaults-scan` patterns — research R6): `BANNED` shape inventory, documented
  placeholder allowances, `scanText` / `scanFileTree`.
- BANNED set (unchanged from the repo scans): `lin_api_` token VALUES, PEM material,
  credential-header keys, fictional-org literals standing in for real tenants, email
  addresses, UUID-shaped identifiers, long hex digests. ALLOWED: documented placeholder
  shapes (single-repeat hex probes, the `ac000000-…` seed, RFC-2606 `example.*` /
  `localhost` mail hosts, and FICTIONAL-ORG example tenants inside `.md`/`.txt` prose —
  the repo's documentation convention for example tenants, `isProseAllowance`, scoped to
  that one pattern and those extensions; credentials/PEM/UUID/email/hex stay banned in
  every file kind). The shipped PEM-detector source assembles its marker at runtime so
  artifact bytes carry no literal.
- Coverage: EVERY archive member (shipped `dist` sources + maps, `docs/**`, examples,
  `README.md`, `CHANGELOG.md`, `package.json`). Any finding outside allowances →
  `REFUSED:DEFAULTS_SCAN:<count>`; publish unreached (constitution Release gates:
  "publishing nothing").
- The same module remains the repository-scan implementation (`ci-defaults-scan.test.ts`
  refactors to import it) — one pattern set, zero drift (single-source rule).

## 4. Reuse ledger (spec "Consumes from 002–013")

| Consumed | How stage 7/8 uses it |
|---|---|
| 002 export map + `package-surface` suite expectations | expected member set derived from the same `files`/`exports` fields the suite asserts about the repo |
| 009 CLI binary | `bin` execution + `--version` output check |
| packaging / hygiene / defaults-scan / credential-sentinel contract suites | their PATTERN sets and posture assertions are reused, not re-written (scan module extracted; workflow-shape tests extend the suites' vocabulary) |
| 013 `action.yml` | untouched; tag consistency is a preflight property, not an action change |

## 5. Contract-test placement

| Test file | Tier | Covers |
|---|---|---|
| `tests/contract/archive-verification.test.ts` | contract | allow-list derivation + both-readers + required members + posture assertions on a REAL `npm pack` (fast: no install leg) |
| `tests/e2e/release-dry-run.test.ts` | e2e | full `--dry-run` on the current tree: all stages pass, verdict `WOULD_PUBLISH` (SC-001) |
| `tests/contract/release-pipeline.test.ts` | contract | stage catalog equality, verdict machine, 6 mutation checks (§5 of release-pipeline.md), workflow-shape greps |
| `tests/contract/secret-scan.test.ts` | contract | scan module behavior on synthetic positives/negatives (the extracted patterns still catch every historically-banned shape) |
