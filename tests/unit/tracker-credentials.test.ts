/**
 * T007 [P] — credential unit tests (contracts/resilience-and-credentials.md §5, verbatim:
 * "Credentials MUST be read only from configured environment-variable names, MUST be rejected
 * with a naming diagnostic before any request when unset or empty, and MUST NEVER appear in
 * diagnostics, logs, reports, web responses, or MCP outputs.").
 * Unset AND empty ⇒ TrackerConfigError at construction with zero requests issued; the prefix
 * diagnostic names the env-var name + personalKeyPrefix constant only; the sanitizer strips a
 * planted sentinel from arbitrary strings.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { preflightCredentials, TrackerConfigError, createSanitizer, type CredentialBundle, type TrackerDiagnostic } from "task-linear-sync/tracker";
import { builtInDefaults } from "task-linear-sync/config";

const config = builtInDefaults; // credentialEnvVarNames: { token: LINEAR_ACCESS_TOKEN, apiKey: LINEAR_API_KEY }

function preflight(
  env: Record<string, string | undefined>,
  credentialKind: "token" | "apiKey" = "token",
): { bundle?: CredentialBundle; diagnostics: TrackerDiagnostic[]; error?: unknown } {
  const diagnostics: TrackerDiagnostic[] = [];
  try {
    const bundle = preflightCredentials({ config, env, credentialKind, diagnostics: (d) => diagnostics.push(d) });
    return { bundle, diagnostics };
  } catch (error) {
    return { diagnostics, error };
  }
}

test("credentials: unset ⇒ TrackerConfigError naming LINEAR_ACCESS_TOKEN before any request", () => {
  const { error, bundle } = preflight({});
  assert.ok(error instanceof TrackerConfigError);
  assert.match(error.detail, /LINEAR_ACCESS_TOKEN/);
  assert.equal(bundle, undefined, "no port constructed — zero requests issued");
});

test("credentials: empty string ⇒ same naming rejection", () => {
  const { error } = preflight({ LINEAR_ACCESS_TOKEN: "" });
  assert.ok(error instanceof TrackerConfigError);
  assert.match(error.detail, /LINEAR_ACCESS_TOKEN/);
});

test("credentials: apiKey kind selects the LINEAR_API_KEY name independently", () => {
  const ok = preflight({ LINEAR_API_KEY: "lin_api_placeholder" }, "apiKey");
  assert.equal(ok.error, undefined);
  assert.equal(ok.bundle?.envVarName, "LINEAR_API_KEY");
  const missing = preflight({ LINEAR_ACCESS_TOKEN: "lin_api_placeholder" }, "apiKey");
  assert.ok(missing.error instanceof TrackerConfigError);
  assert.match(missing.error!.detail, /LINEAR_API_KEY/);
});

test("credentials: the error detail names the env-var name and NEVER a planted sentinel value", () => {
  const sentinel = "SENTINEL-7ea1-leakcheck";
  // Pre-flight can only reject on unset/empty — assert no path exists that echoes a value:
  const rejection = preflight({ LINEAR_ACCESS_TOKEN: "" });
  assert.ok(rejection.error instanceof TrackerConfigError);
  assert.ok(!JSON.stringify(rejection.error.message).includes(sentinel));
  assert.ok(!rejection.error.detail.includes(sentinel));
  // Prefix-mismatch diagnostic must also never carry the value:
  const { diagnostics } = preflight({ LINEAR_ACCESS_TOKEN: sentinel });
  assert.equal(diagnostics.length, 1);
  assert.ok(!diagnostics[0].message.includes(sentinel), "diagnostic names the variable, not the value");
});

test("credentials: set but wrong prefix ⇒ non-fatal TrackerDiagnostic naming env-var name + personalKeyPrefix only", () => {
  const { error, bundle, diagnostics } = preflight({ LINEAR_ACCESS_TOKEN: "not-a-personal-key-shape" });
  assert.equal(error, undefined, "prefix mismatch is non-fatal");
  assert.equal(bundle?.envVarName, "LINEAR_ACCESS_TOKEN");
  assert.equal(bundle?.value, "not-a-personal-key-shape");
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "credential-prefix-mismatch");
  assert.match(diagnostics[0].message, /LINEAR_ACCESS_TOKEN/);
  assert.match(diagnostics[0].message, new RegExp(config.personalKeyPrefix));
});

test("credentials: well-shaped personal key ⇒ bundle with no diagnostic", () => {
  const { bundle, diagnostics, error } = preflight({ LINEAR_ACCESS_TOKEN: "lin_api_acmeplaceholder" });
  assert.equal(error, undefined);
  assert.equal(diagnostics.length, 0);
  assert.equal(bundle?.envVarName, "LINEAR_ACCESS_TOKEN");
});

test("credentials: sanitizer strips the held sentinel from arbitrary diagnostic strings", () => {
  const sentinel = "lin_api_SENTINEL-strip-me";
  const sanitize = createSanitizer([sentinel]);
  assert.equal(
    sanitize(`GraphQL error near token ${sentinel} in header Bearer ${sentinel}`),
    "GraphQL error near token [REDACTED] in header Bearer [REDACTED]",
  );
});
