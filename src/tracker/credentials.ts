/**
 * Credential pre-flight and diagnostics (research R5; contracts/resilience-and-credentials.md
 * §5 — constitution verbatim: "Credentials MUST be read only from configured
 * environment-variable names, MUST be rejected with a naming diagnostic before any request
 * when unset or empty, and MUST NEVER appear in diagnostics, logs, reports, web responses, or
 * MCP outputs."). Read happens at construction ONLY; the bundle value is referenced solely by
 * `HttpRequest.accessToken` and the sanitizer strip-list.
 */
import type { ResolvedConfig } from "../config/schema.js";
import { TrackerConfigError } from "./errors.js";

export interface CredentialBundle {
  readonly envVarName: string;
  readonly value: string;
}

/** Non-fatal pre-flight note. Message names the env-var NAME / config key — never a value. */
export interface TrackerDiagnostic {
  readonly code: "credential-prefix-mismatch" | "page-size-clamped";
  readonly message: string;
}

export interface CredentialPreflight {
  readonly config: ResolvedConfig;
  readonly env: Record<string, string | undefined>;
  readonly credentialKind: "token" | "apiKey";
  readonly diagnostics: (d: TrackerDiagnostic) => void;
}

/**
 * Construction-time read + validation. Unset OR empty ⇒ `TrackerConfigError` naming the
 * configured env-var name (zero requests issued — this runs before a port is returned).
 * Set-but-mismatched-prefix ⇒ non-fatal diagnostic naming the env-var name and the expected
 * `personalKeyPrefix` CONSTANT only. The value itself never enters any diagnostic or error.
 */
export function preflightCredentials(deps: CredentialPreflight): CredentialBundle {
  const envVarName = deps.config.credentialEnvVarNames[deps.credentialKind];
  const value = deps.env[envVarName];
  if (value === undefined || value === "") {
    throw new TrackerConfigError(
      `credential environment variable '${envVarName}' is unset or empty — set it to a valid platform credential before creating a tracker client (zero requests were issued)`,
    );
  }
  const prefix = deps.config.personalKeyPrefix;
  if (!value.startsWith(prefix)) {
    deps.diagnostics({
      code: "credential-prefix-mismatch",
      message: `value of '${envVarName}' does not start with the configured personal key prefix '${prefix}' — proceeding, but requests may be rejected`,
    });
  }
  return { envVarName, value };
}
