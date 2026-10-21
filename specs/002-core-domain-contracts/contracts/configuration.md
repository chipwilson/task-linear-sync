# Contract: Configuration Model & Validation

Modules: `src/config/{schema,defaults,merge,load,validate}.ts`. **Fully implemented by this
feature** — this is a behavioral contract, not just types. Merge semantics and failure
categories per [../research.md](../research.md) R3–R5; complete key inventory per
[data-model.md](../data-model.md) § 17 (normative default list: 001 R17.4).

```ts
/** Complete, post-merge, post-defaults configuration. Deep-partial twin = ConfigOverrides. */
export interface ResolvedConfig { /* groups: tool identity, discovery, grammar, routing,
  matching, tracker, attachment, sync semantics, run state, surfaces — data-model § 17 */ }
export type ConfigOverrides = DeepPartial<ResolvedConfig>;

export type ConfigFailureCategory = "missing" | "unreadable" | "invalid-json";

export interface ConfigFileError {
  readonly category: ConfigFailureCategory;
  readonly configFilePath: string;
  readonly detail?: string;   // parse/OS diagnostic, sanitized
}

export interface MissingIdentityError {
  /** Every missing/empty required value, named — never fail-fast-on-first. */
  readonly missing: readonly string[]; // e.g. "teams[acme].projects", "defaultProject"
}

export interface LoadConfigOptions {
  readonly overrides?: ConfigOverrides;          // programmatic layer (highest precedence)
  readonly configFile?: string;                  // resolved config-file path (see below)
  readonly env?: Record<string, string | undefined>;
  readonly clock?: Clock;                        // injected (R16) — for derived values only
}

/** Layered load: built-in defaults -> JSON file -> programmatic overrides (constitution III). */
export function loadConfig(o: LoadConfigOptions): ResolvedConfig;   // throws ConfigFileError

/**
 * Initialization gate over the fully merged config (FR-007).
 * Required (no defaults exist): >=1 team; per team >=1 project identity and >=1 workflow
 * state identity; every ProjectByPath entry carries teamKey AND project; default team and
 * default project non-empty. Empty string / empty array count as absent (001 R17.5).
 */
export function validateWorkspaceIdentity(c: ResolvedConfig): void; // throws MissingIdentityError

/** Deterministic canonical serialization: sorted keys, stable scalar formatting. */
export function canonicalizeConfig(c: ResolvedConfig): string;      // SC-001 byte-identity

export const builtInDefaults: ResolvedConfig;  // release-scan target: zero org literals
```

## Load behavior (normative)

1. Category decision order (research R4): path set but stat-misses → `missing`; stat ok,
   read throws → `unreadable`; read ok but `JSON.parse` fails or root is not a JSON object
   → `invalid-json`. On any category: **abort, no partial configuration from that file is
   applied** (FR-006, SC-002). No file path configured → defaults + overrides only.
2. Deep merge (R3): plain objects merge recursively; higher-precedence same-key values
   replace; keys absent from higher sources retained (001 R17.3). Arrays and scalars replace
   wholesale. `undefined` = absent; `null` = a value that replaces.
3. Determinism: `canonicalizeConfig(loadConfig(inputs))` is byte-identical across runs for
   identical inputs (SC-001); proven by a property test over fixture layerings.
4. Credentials: only env-var **names** are configuration; values are never loaded into
   `ResolvedConfig` and never appear in canonicalized output or diagnostics (constitution).
5. `toolId` (default `task-linear-sync`) derives: state-dir app segment, env-var prefix and
   tool-owned env names, config-file default path, bin name, `metadataNamespaceKey`
   (`__<toolId>`, avoiding Linear reserved keys), attachment title (`<toolId> sync state`),
   URL-template `toolId` segment; each derivable value independently overridable (001 R17.9).
6. `confirmationKey` default `SYNC`; the merged value is used for exact-match gates and is
   never compared against a built-in constant (001 R17.7).

## Test obligations (mapped in quickstart)

- Precedence matrix fixtures (defaults-only / file-only / all-three, overlapping and
  disjoint keys), byte-identity repeat runs (SC-001).
- Every misconfiguration fixture aborts naming path + category (SC-002), including a valid
  file + invalid file precedence case proving no partial application.
- Missing-identity fixtures assert the error lists **all** missing names simultaneously
  (SC-002, FR-007).
- Contract scan: `builtInDefaults` contains no UUID/`lin_api_`/secret/email-shaped values;
  the only host-like value is the benign placeholder (`*.example.invalid` class).
