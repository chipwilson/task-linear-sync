/**
 * T040 — `action.yml` shape contract (contracts/action.md §1–§5).
 *
 * A purpose-built minimal YAML reader (no YAML dependency) parses the
 * committed file: exact top-level strings, the EXACT thirteen inputs with
 * their EXACT defaults, the EXACT six outputs, `runs.using: composite`,
 * bash steps, the `test -f` build guard, and the `dist/ci/main.js` entry.
 * No input may be named like a credential (§2: credentials are `env:`-only).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const pkgRoot = fileURLToPath(new URL("../../../", import.meta.url));
const actionText = readFileSync(join(pkgRoot, "action.yml"), "utf8");

// ── minimal YAML reader (indentation-only subset: maps, lists, scalars, blocks)

interface YamlNode {
  readonly map: Record<string, YamlNode | null>;
  readonly list?: YamlNode[];
  readonly scalar?: string;
}

function stripComment(line: string): string {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (c === '"' && !inSingle) inDouble = !inDouble;
    else if (c === "#" && !inSingle && !inDouble && (i === 0 || /\s/.test(line[i - 1] ?? ""))) {
      return line.slice(0, i);
    }
  }
  return line;
}

function unquote(value: string): string {
  const v = value.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  return v;
}

function scalar(text: string): YamlNode {
  return { map: {}, scalar: unquote(text) };
}

interface Line {
  readonly indent: number;
  readonly text: string;
}

function parseBlock(lines: Line[], start: number, indent: number): { node: YamlNode; next: number } {
  // List?
  if (lines[start] !== undefined && lines[start].indent === indent && lines[start].text.startsWith("- ")) {
    const items: YamlNode[] = [];
    let i = start;
    while (i < lines.length && lines[i].indent === indent && lines[i].text.startsWith("- ")) {
      const inline = lines[i].text.slice(2);
      const eq = inline.indexOf(":");
      const child: YamlNode = { map: {} };
      if (eq >= 0) {
        const key = inline.slice(0, eq).trim();
        const rest = inline.slice(eq + 1).trim();
        const nested: Line[] = [];
        i += 1;
        while (i < lines.length && lines[i].indent > indent) {
          nested.push(lines[i]);
          i += 1;
        }
        if (rest === "" || rest === "|" || rest === ">-") {
          if (rest === "") {
            const sub = parseBlock(nested, 0, nested[0]?.indent ?? 0);
            child.map[key] = sub.node;
          } else {
            child.map[key] = scalar(joinBlock(nested, rest));
          }
        } else {
          child.map[key] = scalar(unquote(rest));
          const sub = parseBlock(nested, 0, nested[0]?.indent ?? 0);
          for (const [k, v] of Object.entries(sub.node.map)) child.map[k] = v;
        }
      } else {
        child.map["="] = scalar(inline);
        i += 1;
      }
      items.push(child);
    }
    return { node: { map: {}, list: items }, next: i };
  }
  // Map.
  const map: Record<string, YamlNode | null> = {};
  let i = start;
  while (i < lines.length && lines[i].indent === indent && !lines[i].text.startsWith("- ")) {
    const { text } = lines[i];
    const eq = text.indexOf(":");
    if (eq < 0) {
      i += 1;
      continue;
    }
    const key = text.slice(0, eq).trim();
    const rest = text.slice(eq + 1).trim();
    i += 1;
    if (rest === "|" || rest === ">-") {
      const nested: Line[] = [];
      while (i < lines.length && lines[i].indent > indent) {
        nested.push(lines[i]);
        i += 1;
      }
      map[key] = scalar(joinBlock(nested, rest));
      continue;
    }
    if (rest !== "") {
      map[key] = scalar(rest);
      continue;
    }
    if (i < lines.length && lines[i].indent > indent) {
      const sub = parseBlock(lines, i, lines[i].indent);
      map[key] = sub.node;
      i = sub.next;
    } else {
      map[key] = null;
    }
  }
  return { node: { map }, next: i };
}

function joinBlock(nested: Line[], style: string): string {
  const text = style === "|-" || style === "|"
    ? nested.map((l) => l.text).join("\n")
    : nested.map((l) => l.text.trim()).filter((t) => t !== "").join(" ");
  return text.trim();
}

function parseYaml(text: string): YamlNode {
  const lines: Line[] = [];
  for (const raw of actionText.split("\n")) {
    const stripped = stripComment(raw);
    if (stripped.trim() === "") continue;
    lines.push({ indent: stripped.length - stripped.trimStart().length, text: stripped.trimStart().replace(/\s+$/, "") });
  }
  void text;
  return parseBlock(lines, 0, 0).node;
}

const doc = parseYaml(actionText);

const scalarOf = (node: YamlNode | null): string | null => node?.scalar ?? null;

test("action-shape: exact top-level identity strings", () => {
  assert.equal(scalarOf(doc.map["name"]), "task-linear-sync CI enforcement");
  assert.equal(scalarOf(doc.map["author"]), "task-linear-sync contributors");
  const description = scalarOf(doc.map["description"]) ?? "";
  assert.match(description, /read-only task-linear-sync\s+check\/plan commands/);
  assert.match(description, /three configurable violation conditions/);
  assert.match(description, /Zero tracker mutations, zero repository\s+writes, no apply or mutate mode\./);
});

test("action-shape: EXACTLY the thirteen inputs with EXACT defaults", () => {
  const inputs = doc.map["inputs"];
  assert.ok(inputs && typeof inputs === "object");
  const expected: Readonly<Record<string, string>> = {
    workspace: "${{ github.workspace }}",
    config: "",
    command: "check",
    report: "",
    "cli-entry": "",
    "fail-on-unmapped": "true",
    "unmapped-threshold": "0",
    "fail-on-conflicts": "true",
    "fail-on-drift": "true",
    "drift-threshold": "0",
    "protected-branches": "",
    branch: "",
    "auto-build": "true",
  };
  assert.deepEqual(Object.keys(inputs.map).sort(), Object.keys(expected).sort());
  for (const [name, def] of Object.entries(expected)) {
    const entry: YamlNode | null = inputs.map[name];
    assert.ok(entry && typeof entry === "object" && entry.map["default"] !== undefined, `input ${name} needs a default`);
    assert.equal(scalarOf(entry.map["default"]), def, `input ${name} default`);
  }
});

test("action-shape: EXACTLY the six outputs, all wired to the enforce step", () => {
  const outputs = doc.map["outputs"];
  assert.ok(outputs && typeof outputs === "object");
  assert.deepEqual(Object.keys(outputs.map).sort(), [
    "conflict-count",
    "drift-count",
    "report-json",
    "status",
    "summary",
    "unmapped-count",
  ]);
  for (const name of Object.keys(outputs.map)) {
    const entry = outputs.map[name];
    const value = entry && typeof entry === "object" ? scalarOf(entry.map["value"] ?? null) ?? "" : "";
    assert.match(value, new RegExp(`steps\\.enforce\\.outputs\\.${name.replace(/[-]/g, "-")}`));
  }
});

test("action-shape: composite run with two bash steps, guard + entry", () => {
  const runs = doc.map["runs"];
  assert.ok(runs && typeof runs === "object");
  assert.equal(scalarOf(runs.map["using"]), "composite");
  assert.equal(actionText.includes("node20"), false);
  assert.equal(actionText.includes("docker"), false);
  const steps = runs.map["steps"];
  if (!steps || typeof steps === "string" || !Array.isArray(steps.list)) {
    assert.fail("runs.steps must be a two-item list");
  }
  assert.equal(steps.list.length, 2);
  for (const step of steps.list) {
    assert.equal(scalarOf(step.map["shell"]), "bash");
  }
  const guard = steps.list[0];
  assert.equal((scalarOf(guard.map["run"]) ?? "").includes('test -f "$ACTION_ROOT/dist/ci/main.js"'), true);
  assert.equal((scalarOf(guard.map["run"]) ?? "").includes("npm ci"), true);
  assert.equal((scalarOf(guard.map["run"]) ?? "").includes("npm run build"), true);
  assert.equal(scalarOf(guard.map["env"])?.includes ?? undefined, undefined); // env is a map, not text
  const enforce = steps.list[1];
  assert.equal(scalarOf(enforce.map["id"]), "enforce");
  const run = scalarOf(enforce.map["run"]) ?? "";
  assert.equal(run.includes('node "$ACTION_ROOT/dist/ci/main.js"'), true);
  assert.equal(run.includes("--workspace"), true);
  assert.equal(run.includes("--apply"), false, "no mutate vocabulary in the action");
});

test("action-shape: no input is named like a credential (§2 — env-only credentials)", () => {
  const inputs = doc.map["inputs"];
  assert.ok(inputs && typeof inputs === "object");
  for (const name of Object.keys(inputs.map)) {
    assert.equal(/token|secret|key|credential|password/i.test(name), false, `credential-shaped input: ${name}`);
  }
  assert.match(actionText, /\$\{\{ inputs\.[a-z-]+ \}\}/);
});
