/**
 * T008 [foundational] — candidate projection unit tests
 * (contracts/candidate-projection.md rules 1–6): page-0-only identity via the frozen
 * `parseAttachmentUrl` + `parseSyncStatePayload` helpers under `metadataNamespaceKey`;
 * continuation pages never set identity; identity NEVER from description or other
 * metadata keys; malformed payloads ignored (never partially trusted); `issueKey`
 * passthrough for the `-(\d+)$` signal source; containers mapped as-is; output sorted
 * by `issueId` ascending.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { loadConfig } from "task-linear-sync/config";
import type { ResolvedConfig } from "task-linear-sync/config";
import { serializeSyncStatePayload } from "task-linear-sync/domain";
import type { SyncStatePayload } from "task-linear-sync/domain";
import type { AttachmentView, IssueView } from "task-linear-sync/ports";
import { projectCandidates } from "task-linear-sync/matching";

const config: ResolvedConfig = loadConfig({});
const NS = config.metadataNamespaceKey; // "__task-linear-sync"
const HOST = "https://sync.example.invalid";
const TOOL = config.toolId;
const canonicalUrl = (uuid: string): string => `${HOST}/${TOOL}/${uuid}`;
const continuationUrl = (uuid: string, page: number): string => `${HOST}/${TOOL}/${uuid}/${page}`;

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";

function payloadFor(taskUuid: string, frameworkMetadata?: Record<string, unknown>): string {
  const base: SyncStatePayload = {
    taskUuid,
    frameworkMetadata: (frameworkMetadata ?? {
      frameworkId: "spec-kit",
      filePath: "specs/demo-feature/tasks.md",
    }) as unknown as SyncStatePayload["frameworkMetadata"],
    descriptionContentHash: "0".repeat(64),
    cursors: { lastSyncAt: "2026-01-01T00:00:00.000Z" },
    history: [],
  };
  return serializeSyncStatePayload(base);
}

function issue(id: string, over: Partial<IssueView> = {}): IssueView {
  return {
    id,
    key: `ENG-${id.slice(2)}`,
    teamKey: "acme-team",
    projectId: "proj-alpha",
    title: `Issue ${id}`,
    description: "plain body",
    stateType: "todo",
    updatedAt: "2026-01-01T00:00:00.000Z",
    archived: false,
    ...over,
  };
}

function attachment(id: string, url: string, metadata: Record<string, string | number>): AttachmentView {
  return { id, url, title: "task-linear-sync sync state", metadata };
}

function durableAttachment(id: string, uuid: string, frameworkMetadata?: Record<string, unknown>): AttachmentView {
  return attachment(id, canonicalUrl(uuid), { [NS]: payloadFor(uuid, frameworkMetadata) });
}

test("matching-projection: page-0 canonical attachment + namespace payload sets durableTaskUuid and framework context", () => {
  const candidates = projectCandidates({
    issues: [issue("i-0001")],
    attachmentsByIssue: {
      "i-0001": [
        durableAttachment("att-1", UUID_A, {
          frameworkId: "kiro",
          featureName: "auth",
          filePath: "specs/demo-feature/tasks.md",
          localTaskId: "Task 2.1",
        }),
      ],
    },
    config,
  });
  assert.equal(candidates.length, 1);
  assert.deepEqual(candidates[0], {
    issueId: "i-0001",
    issueKey: "ENG-0001",
    teamKey: "acme-team",
    projectRef: "proj-alpha",
    title: "Issue i-0001",
    durableTaskUuid: UUID_A,
    frameworkId: "kiro",
    featureName: "auth",
    filePath: "specs/demo-feature/tasks.md",
    localTaskId: "Task 2.1",
  });
});

test("matching-projection: continuation-page attachments are history-only and never set identity", () => {
  const candidates = projectCandidates({
    issues: [issue("i-0002")],
    attachmentsByIssue: {
      "i-0002": [
        {
          id: "att-c1",
          url: continuationUrl(UUID_A, 1),
          title: "sync state (page 1)",
          metadata: { [NS]: payloadFor(UUID_A) },
        },
      ],
    },
    config,
  });
  assert.equal(candidates[0]?.durableTaskUuid, undefined);
  assert.equal(candidates[0]?.frameworkId, undefined);
  assert.equal(candidates[0]?.featureName, undefined);
});

test("matching-projection: identity never comes from description or foreign metadata keys", () => {
  const candidates = projectCandidates({
    issues: [issue("i-0003", { description: `legacy notes: taskUuid ${UUID_B} in plain text` })],
    attachmentsByIssue: {
      "i-0003": [
        attachment("att-x1", "https://files.example.invalid/doc.pdf", {
          [`__other-tool`]: payloadFor(UUID_B),
          "task-uuid": UUID_B,
        }),
      ],
    },
    config,
  });
  assert.equal(candidates[0]?.durableTaskUuid, undefined, "never description / never other metadata keys");
});

test("matching-projection: malformed payload under the namespace key ⇒ non-durable, never partially trusted", () => {
  const candidates = projectCandidates({
    issues: [issue("i-0004")],
    attachmentsByIssue: {
      "i-0004": [attachment("att-m1", canonicalUrl(UUID_A), { [NS]: "{not-json" })],
    },
    config,
  });
  assert.equal(candidates[0]?.durableTaskUuid, undefined);
  assert.equal(candidates[0]?.frameworkId, undefined, "context from a malformed payload is never used");
  assert.equal(candidates[0]?.filePath, undefined);
});

test("matching-projection: payload whose taskUuid is not a valid identity ⇒ non-durable", () => {
  const candidates = projectCandidates({
    issues: [issue("i-0005")],
    attachmentsByIssue: {
      "i-0005": [attachment("att-b1", canonicalUrl(UUID_A), { [NS]: payloadFor("not-a-uuid") })],
    },
    config,
  });
  assert.equal(candidates[0]?.durableTaskUuid, undefined);
  assert.equal(candidates[0]?.frameworkId, undefined);
});

test("matching-projection: non-string metadata value under the namespace key is ignored", () => {
  const candidates = projectCandidates({
    issues: [issue("i-0006")],
    attachmentsByIssue: { "i-0006": [attachment("att-n1", canonicalUrl(UUID_A), { [NS]: 42 })] },
    config,
  });
  assert.equal(candidates[0]?.durableTaskUuid, undefined);
});

test("matching-projection: canonical URL whose scheme does not parse is not identity", () => {
  const candidates = projectCandidates({
    issues: [issue("i-0007")],
    attachmentsByIssue: {
      "i-0007": [attachment("att-f1", "https://elsewhere.example.invalid/other/thing", { [NS]: payloadFor(UUID_A) })],
    },
    config,
  });
  assert.equal(candidates[0]?.durableTaskUuid, undefined);
});

test("matching-projection: containers map as-is from IssueView; issueKey passes through for the numeric-suffix signal", () => {
  const candidates = projectCandidates({
    issues: [issue("i-0008", { key: "ACME-123", teamKey: "glob-team", projectId: "proj-gamma" })],
    attachmentsByIssue: {},
    config,
  });
  assert.equal(candidates[0]?.teamKey, "glob-team");
  assert.equal(candidates[0]?.projectRef, "proj-gamma");
  assert.equal(candidates[0]?.issueKey, "ACME-123");
});

test("matching-projection: output sorted by issueId ascending regardless of input order (deterministic)", () => {
  const issues = [issue("i-3000"), issue("i-1000"), issue("i-2000")];
  const run = (): string[] =>
    projectCandidates({ issues, attachmentsByIssue: {}, config }).map((c) => c.issueId);
  assert.deepEqual(run(), ["i-1000", "i-2000", "i-3000"]);
  // Reversing the input array changes nothing.
  assert.deepEqual(
    projectCandidates({ issues: [...issues].reverse(), attachmentsByIssue: {}, config }).map((c) => c.issueId),
    ["i-1000", "i-2000", "i-3000"],
  );
});

test("matching-projection: attachment-list order does not change the deterministic projection", () => {
  const attachments = [
    durableAttachment("att-b", UUID_A),
    attachment("att-a", continuationUrl(UUID_B, 2), { [NS]: payloadFor(UUID_B) }),
    attachment("att-c", "https://files.example.invalid/x.pdf", {}),
  ];
  const run = (list: AttachmentView[]): string =>
    JSON.stringify(
      projectCandidates({ issues: [issue("i-0009")], attachmentsByIssue: { "i-0009": list }, config }),
    );
  assert.equal(run(attachments), run([...attachments].reverse()));
});

test("matching-projection: issue with no attachment entry still projects a non-durable candidate", () => {
  const candidates = projectCandidates({ issues: [issue("i-0010")], attachmentsByIssue: {}, config });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.durableTaskUuid, undefined);
});

test("matching-projection: durable payload without frameworkMetadata yields durable identity but unknown framework", () => {
  const stripped = JSON.stringify({
    taskUuid: UUID_A,
    descriptionContentHash: "0".repeat(64),
    cursors: { lastSyncAt: "2026-01-01T00:00:00.000Z" },
    history: [],
  });
  const candidates = projectCandidates({
    issues: [issue("i-0011")],
    attachmentsByIssue: { "i-0011": [attachment("att-11", canonicalUrl(UUID_A), { [NS]: stripped })] },
    config,
  });
  assert.equal(candidates[0]?.durableTaskUuid, UUID_A);
  assert.equal(candidates[0]?.frameworkId, undefined);
  assert.equal(candidates[0]?.featureName, undefined);
  assert.equal(candidates[0]?.filePath, undefined);
});

test("matching-projection: pure — zero port calls; performs no fetch ('matching never fetches')", () => {
  // The module consumes data only; there is nothing to inject. Purity posture: repeated
  // identical calls are byte-identical (no hidden state).
  const input = {
    issues: [issue("i-0012")],
    attachmentsByIssue: { "i-0012": [durableAttachment("att-12", UUID_A)] },
    config,
  };
  assert.deepEqual(projectCandidates(input), projectCandidates(input));
});
