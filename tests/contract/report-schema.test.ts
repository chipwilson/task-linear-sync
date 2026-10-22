/**
 * T012 — report-schema contract test. Validates report fixtures against
 * contracts/plan-report.schema.json (draft 2020-12, additionalProperties:false throughout)
 * with a minimal dependency-free validator, and runs the schema-scan test asserting no
 * property admits raw task-body / issue-description free text
 * (contracts/plan-artifact.md § Test obligations).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const pkgRoot = fileURLToPath(new URL("../../../", import.meta.url));
const schema = JSON.parse(
  readFileSync(new URL("specs/002-core-domain-contracts/contracts/plan-report.schema.json", `file://${pkgRoot}`), "utf8"),
) as JsonSchema;

interface JsonSchema {
  type?: string | string[];
  const?: unknown;
  enum?: unknown[];
  pattern?: string;
  format?: string;
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  minItems?: number;
  maxItems?: number;
  minimum?: number;
  maxLength?: number;
  $ref?: string;
  [key: string]: unknown;
}

const DATE_TIME = /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/;

/** Minimal draft-2020-12 subset validator: type/const/enum/pattern/format/required/
 *  additionalProperties/properties/items/min|maxItems/minimum/maxLength/$ref. */
function validate(value: unknown, s: JsonSchema, root: JsonSchema, path: string, errors: string[]): void {
  if (s.$ref) {
    const m = /^#\/\$defs\/(.+)$/.exec(s.$ref);
    assert.ok(m, `unsupported $ref: ${s.$ref}`);
    const target = (root as { $defs?: Record<string, JsonSchema> }).$defs?.[m[1]];
    assert.ok(target, `unresolved $ref: ${s.$ref}`);
    validate(value, target, root, path, errors);
    return;
  }
  if (s.const !== undefined && value !== s.const) errors.push(`${path}: must equal ${JSON.stringify(s.const)}`);
  if (s.enum && !s.enum.includes(value)) errors.push(`${path}: must be one of ${JSON.stringify(s.enum)}`);

  const types = s.type === undefined ? undefined : Array.isArray(s.type) ? s.type : [s.type];
  if (types) {
    const rawType = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
    // JSON Schema "integer" accepts any finite number with zero fractional part.
    const actual = rawType === "number" && Number.isInteger(value as number) ? "integer" : rawType;
    const ok = types.includes(actual) || (actual === "integer" && types.includes("number"));
    if (!ok) {
      errors.push(`${path}: expected type ${types.join("|")}, got ${rawType}`);
      return;
    }
  }
  if (typeof value === "string") {
    if (s.pattern && !new RegExp(s.pattern).test(value)) errors.push(`${path}: fails pattern ${s.pattern}`);
    if (s.format === "date-time" && !DATE_TIME.test(value)) errors.push(`${path}: not date-time`);
    if (s.maxLength !== undefined && value.length > s.maxLength) errors.push(`${path}: exceeds maxLength`);
  }
  if (typeof value === "number" && s.minimum !== undefined && value < s.minimum) {
    errors.push(`${path}: below minimum ${s.minimum}`);
  }
  if (Array.isArray(value)) {
    if (s.minItems !== undefined && value.length < s.minItems) errors.push(`${path}: fewer than ${s.minItems} items`);
    if (s.maxItems !== undefined && value.length > s.maxItems) errors.push(`${path}: more than ${s.maxItems} items`);
    if (s.items) value.forEach((v, i) => validate(v, s.items as JsonSchema, root, `${path}[${i}]`, errors));
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    for (const key of s.required ?? []) {
      if (!(key in obj)) errors.push(`${path}: missing required '${key}'`);
    }
    const props = s.properties ?? {};
    for (const [key, v] of Object.entries(obj)) {
      if (props[key]) validate(v, props[key], root, `${path}.${key}`, errors);
      else if (s.additionalProperties === false) errors.push(`${path}: additional property '${key}' not allowed`);
      else if (typeof s.additionalProperties === "object") validate(v, s.additionalProperties, root, `${path}.${key}`, errors);
    }
  }
}

function expectValid(fixturePath: string): unknown {
  const value = JSON.parse(
    readFileSync(new URL(fixturePath, `file://${pkgRoot}`), "utf8"),
  ) as unknown;
  const errors: string[] = [];
  validate(value, schema, schema, "$", errors);
  assert.deepEqual(errors, [], `expected schema conformance:\n${errors.join("\n")}`);
  return value;
}

function expectInvalid(fixturePath: string, ...mustMention: string[]): string[] {
  const value = JSON.parse(readFileSync(new URL(fixturePath, `file://${pkgRoot}`), "utf8")) as unknown;
  const errors: string[] = [];
  validate(value, schema, schema, "$", errors);
  assert.ok(errors.length > 0, `expected schema violations in ${fixturePath}`);
  for (const needle of mustMention) {
    assert.ok(
      errors.some((e) => e.includes(needle)),
      `expected an error mentioning '${needle}', got:\n${errors.join("\n")}`,
    );
  }
  return errors;
}

test("valid report fixture conforms to plan-report.schema.json", () => {
  expectValid("tests/fixtures/reports/report-valid.json");
});

test("raw description field is structurally rejected (additionalProperties:false)", () => {
  expectInvalid("tests/fixtures/reports/report-invalid-raw-description.json", "description");
});

test("missing required fields and bad patterns are rejected", () => {
  const errors = expectInvalid("tests/fixtures/reports/report-invalid-missing-fields.json");
  assert.ok(errors.some((e) => e.includes("missing required")));
  assert.ok(errors.some((e) => e.includes("pattern")));
});

test("schema scan: no property admits raw body/description/content free text", () => {
  // Per plan-artifact.md: no property named like `body|description|content` may exist
  // unless it is hash/summary-bearing (`*ContentHash`, `expected*`, `description*` under
  // a `Hash`-suffixed name).
  const offenders: string[] = [];
  const walk = (node: unknown, path: string): void => {
    if (Array.isArray(node)) return node.forEach((v, i) => walk(v, `${path}[${i}]`));
    if (node === null || typeof node !== "object") return;
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      if (key === "properties" && child && typeof child === "object") {
        for (const propName of Object.keys(child as Record<string, unknown>)) {
          const lower = propName.toLowerCase();
          const namesRawText = /(^|.*)(body|description|content)(\b|$)/.test(lower) &&
            !lower.endsWith("hash") && !lower.startsWith("expected");
          if (namesRawText) offenders.push(`${path}.properties.${propName}`);
        }
      }
      walk(child, `${path}.${key}`);
    }
  };
  walk(schema, "$");
  assert.deepEqual(offenders, [], `raw-text-bearing properties found: ${offenders.join(", ")}`);
});

test("assertions block shape is fixed (guarantee + status enum pass|fail, closed object)", () => {
  const assertions = schema.properties?.["securityAssertions"] as JsonSchema | undefined;
  assert.ok(assertions, "securityAssertions present at root");
  assert.equal(assertions.type, "array");
  assert.ok((assertions.minItems as number) >= 1, "at least one discrete assertion");
  const items = assertions.items as JsonSchema;
  assert.deepEqual(items.required, ["guarantee", "status"]);
  assert.equal(items.additionalProperties, false);
  assert.deepEqual(items.properties?.["status"]?.enum, ["pass", "fail"]);
});
