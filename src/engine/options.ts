/**
 * `EngineOptions` wiring bag (contracts/engine-pipeline.md surface block; research R9/
 * R12/R13; plan.md module map "options.ts — EngineOptions (keyProvider, screener override,
 * profile registry)").
 * T008 (Phase 2, foundational) — fully implemented here: the option types, the built-in
 * env-var key source, and default resolution. `create.ts` composes them (T012/T026/T045).
 *
 * Semantics (contract-verbatim):
 * - `keyProvider` — manifest/step-journal key source (frozen `KeyProvider`,
 *   `src/state/manifest.ts`). Default: env-var NAME from config (`manifestKeyEnvVarName`,
 *   logical id `manifestKeyId`). Returning `null` ⇒ key unavailable ⇒ the engine ABORTS
 *   (frozen `ManifestKeyUnavailableError` posture — no manifest I/O beyond the lookup).
 * - `normalizationProfiles` — registry extension; the built-in `"default"` profile is
 *   always present (resolve through `normalize.ts`, T009).
 * - `journalingEnabled` — journaling override; default `true`. `false` (or config
 *   `auditManifestEnabled: false`) ⇒ applies proceed unjournaled and `rollbackRun`
 *   refuses `MANIFEST_UNJOURNALED` (frozen posture).
 * - `screener` — ruleset/screening override (research R12; plan.md module map; task T006
 *   names `EngineOptions.screener`); defaults to `EngineDependencies.screener`.
 */
import type { ResolvedConfig } from "../config/schema.js";
import type { KeyProvider } from "../state/manifest.js";
import type { EngineDependencies, SecurityScreener } from "../ports/engine.js";

/**
 * Description-normalization profile member (contracts/engine-pipeline.md type block).
 * Idempotent and round-trip-equating: `normalize(mirror(render(x))) === normalize(x)`
 * (research R3/R5) — formatting-only drift must normalize to identical text (SC-002).
 */
export type DescriptionNormalizer = (text: string) => string;

/** Injectable wiring bag for `createSyncEngine` (all fields optional; defaults below). */
export interface EngineOptions {
  /**
   * Manifest/step-journal key source; default: env-var name from config
   * (`manifestKeyEnvVarName` + `manifestKeyId` — see {@link envVarKeyProvider}).
   * Returning null ⇒ key unavailable ⇒ abort.
   */
  readonly keyProvider?: KeyProvider;
  /** Normalization-profile registry extension; built-in "default" always present. */
  readonly normalizationProfiles?: Readonly<Record<string, DescriptionNormalizer>>;
  /**
   * Journaling override: false ⇒ applies proceed unjournaled, rollback refuses
   * (frozen MANIFEST_UNJOURNALED posture). Default true — additionally ANDed with
   * config `auditManifestEnabled` (research R9: config-disabled ⇒ neither artifact exists).
   */
  readonly journalingEnabled?: boolean;
  /**
   * Security-screening override (research R12). When absent, the engine screens with
   * `EngineDependencies.screener` (frozen required dependency).
   */
  readonly screener?: SecurityScreener;
}

/** `EngineOptions` after default resolution — the shape every pipeline module consumes. */
export interface ResolvedEngineOptions {
  /** Effective key source (never absent — defaults to {@link envVarKeyProvider}). */
  readonly keyProvider: KeyProvider;
  /** Programmatic profile extensions; the built-in `"default"` is merged by `normalize.ts`. */
  readonly normalizationProfiles: Readonly<Record<string, DescriptionNormalizer>>;
  /**
   * Effective journaling flag: `(journalingEnabled ?? true) && config.auditManifestEnabled`
   * (research R9; contracts/journal-rollback.md §1).
   */
  readonly journalingEnabled: boolean;
  /** Screening override as given; default resolution via {@link resolveScreener}. */
  readonly screener: SecurityScreener | undefined;
}

/** Accepted env encodings for the manifest key value: 64-char hex or 32-byte base64. */
const HEX_KEY_RE = /^(?:[0-9a-f]{2}){32}$/i;
const BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/][AQgw]==|[A-Za-z0-9+/]{2}[AEIMQUYcgkosw048]=|[A-Za-z0-9+/]{3}[A-Za-z0-9+/])$/;

function decodeKeyMaterial(raw: string): Uint8Array | null {
  const value = raw.trim();
  if (HEX_KEY_RE.test(value)) {
    return new Uint8Array(Buffer.from(value, "hex"));
  }
  if (BASE64_RE.test(value)) {
    const bytes = new Uint8Array(Buffer.from(value, "base64"));
    return bytes.length === 32 ? bytes : null;
  }
  return null; // not 32-byte key material ⇒ treated as key unavailable (abort posture)
}

/**
 * Built-in default `KeyProvider` (contracts/engine-pipeline.md): reads the key value from
 * the env var NAMED by `config.manifestKeyEnvVarName` — values are never stored into
 * config (constitution). The logical `keyId` passed by `sealManifest`/`openManifest` is
 * `config.manifestKeyId` (or the id recorded in an envelope sealed earlier with it); this
 * single-name source serves it — any keyId is answered with the configured key.
 * Missing/blank/mis-encoded value ⇒ `null` ⇒ key unavailable ⇒ the engine aborts
 * (frozen `ManifestKeyUnavailableError` posture in `src/state/manifest.ts`).
 * Accepted value encodings: 64-char hex, or base64 decoding to exactly 32 bytes.
 */
export function envVarKeyProvider(
  config: ResolvedConfig,
  env: NodeJS.ProcessEnv = process.env,
): KeyProvider {
  return {
    async getKey(_keyId: string): Promise<Uint8Array | null> {
      const raw = env[config.manifestKeyEnvVarName];
      if (raw === undefined || raw.trim().length === 0) return null;
      return decodeKeyMaterial(raw);
    },
  };
}

/**
 * Resolve the option defaults exactly once per composed engine (T012 skeleton; T026/T045
 * thread the result into `buildSyncPlan`/`applySyncPlan`/`rollbackRun`).
 */
export function resolveEngineOptions(
  options: EngineOptions | undefined,
  config: ResolvedConfig,
): ResolvedEngineOptions {
  return {
    keyProvider: options?.keyProvider ?? envVarKeyProvider(config),
    normalizationProfiles: options?.normalizationProfiles ?? {},
    journalingEnabled: (options?.journalingEnabled ?? true) && config.auditManifestEnabled,
    screener: options?.screener,
  };
}

/**
 * Effective screener for the run (research R12): `EngineOptions.screener` overrides the
 * frozen required `EngineDependencies.screener` when present.
 */
export function resolveScreener(
  deps: Pick<EngineDependencies, "screener">,
  options: Pick<ResolvedEngineOptions, "screener">,
): SecurityScreener {
  return options.screener ?? deps.screener;
}
