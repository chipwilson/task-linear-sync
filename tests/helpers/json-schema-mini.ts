/**
 * T028 — minimal draft-2020-12 validator (dependency-free), extracted as a NEW shared
 * helper for 009's report-contract tests: `type` / `const` / `enum` / `pattern` /
 * `format` / `required` / `additionalProperties` / `properties` / `items` /
 * `min|maxItems` / `minimum` / `maxLength` / `$ref` (`#/$defs/…`). Semantics match the
 * frozen 002 `tests/contract/report-schema.test.ts` validator member-for-member; that
 * file stays untouched (frozen — import-only reuse discipline).
 */

export interface JsonSchema {
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

/** Collect every violation of `schema` (a `$ref`-rooted document) against `value`. */
export function collectSchemaErrors(value: unknown, schema: JsonSchema): string[] {
  const errors: string[] = [];
  validate(value, schema, schema, "$", errors);
  return errors;
}

/** Throw with the full violation listing when `value` violates `schema`. */
export function assertSchemaValid(value: unknown, schema: JsonSchema, context = "value"): void {
  const errors = collectSchemaErrors(value, schema);
  if (errors.length > 0) {
    throw new Error(`expected schema conformance for ${context}:\n${errors.join("\n")}`);
  }
}

function validate(value: unknown, s: JsonSchema, root: JsonSchema, path: string, errors: string[]): void {
  if (s.$ref) {
    const m = /^#\/\$defs\/(.+)$/.exec(s.$ref);
    if (m === null) throw new Error(`unsupported $ref: ${s.$ref}`);
    const target = (root as { $defs?: Record<string, JsonSchema> }).$defs?.[m[1]];
    if (target === undefined) throw new Error(`unresolved $ref: ${s.$ref}`);
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
      else if (typeof s.additionalProperties === "object")
        validate(v, s.additionalProperties, root, `${path}.${key}`, errors);
    }
  }
}
