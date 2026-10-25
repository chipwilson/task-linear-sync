/**
 * T042 [P] — the document allow-list contract (R12; contracts/tracker-adapter.md structural
 * invariant 3; quickstart US2 row 1). FR-004 ("implementations MUST NOT search issue
 * descriptions for identity") is enforced STRUCTURALLY: the exported operation set must equal
 * the enumerated allow-list, no search operation may exist, and `description` may never appear
 * in a filter position — it is data carried in views and mutation inputs, never a predicate.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { GRAPHQL_DOCUMENTS, GRAPHQL_OPERATION_NAMES, type GraphQLOperationName } from "task-linear-sync/tracker";

const ALLOW_LIST: readonly string[] = [
  "issues",
  "issue",
  "teamMetadata",
  "issueCreate",
  "issueUpdate",
  "issueArchive",
  "attachmentsForURL",
  "attachmentCreate",
  "attachmentUpdate",
  "issueAttachments",
];

const allSources = (): string => GRAPHQL_OPERATION_NAMES.map((n) => GRAPHQL_DOCUMENTS[n as GraphQLOperationName].source).join("\n");

test("the exported operation set equals the enumerated allow-list (exactly, in order)", () => {
  assert.deepEqual(GRAPHQL_OPERATION_NAMES, ALLOW_LIST);
  assert.deepEqual(Object.keys(GRAPHQL_DOCUMENTS), ALLOW_LIST);
  for (const name of GRAPHQL_OPERATION_NAMES) {
    assert.equal(GRAPHQL_DOCUMENTS[name].operationName, name, `'${name}' document self-names correctly`);
  }
});

test("no search operation exists anywhere in the documents (FR-004, SC-003 substrate)", () => {
  for (const name of GRAPHQL_OPERATION_NAMES) {
    assert.ok(!/search/i.test(name), `'${name}' looks like a search operation`);
    assert.ok(!/search/i.test(GRAPHQL_DOCUMENTS[name].source), `'${name}' source mentions search`);
  }
});

test("`description` NEVER appears in a filter position — predicate forms are banned outright", () => {
  const sources = allSources();
  // No operator-predicate on description (eq/in/nin/contains/startsWith…), anywhere.
  assert.ok(!/description\s*[:=]\s*\{/.test(sources), "description carries a filter predicate object");
  assert.ok(!/\b(description|descriptionContains|descriptionEq)\s*:/.test(
    sources
      .split("\n")
      .filter((line) => line.includes("filter"))
      .join("\n"),
  ), "a filter line references description");
  // Every `filter:` block only ever partitions by team/project/state (R6 scoping).
  for (const line of sources.split("\n")) {
    if (!line.includes("filter:")) continue;
    const allowedKeys = ["team", "project", "state", "type", "key", "id", "in", "nin", "eq", "first", "after"];
    const tokens = (line.match(/[A-Za-z_][A-Za-z0-9_]*(?=\s*[:{])/g) ?? []).filter((t) => !allowedKeys.includes(t) && t !== "filter");
    assert.deepEqual(tokens, [], `unexpected filter keys on line: ${line.trim()}`);
  }
});

test("`description` appears ONLY as carried data (view selection) or written input (mutation variable)", () => {
  for (const line of allSources().split("\n")) {
    if (!line.includes("description")) continue;
    const isSelection = line.includes("id identifier title description");
    const isMutationVar = line.includes("$description: String") || line.includes("description: $description");
    assert.ok(isSelection || isMutationVar, `description in a disallowed position: ${line.trim()}`);
  }
});
