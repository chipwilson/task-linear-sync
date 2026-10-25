/**
 * T049 [P] — compile-only negative-type assertions (quickstart "Gate sanity"). Compiled by
 * `npm run typecheck` (and `compile:tests`), never executed (the runner only picks up
 * `*.test.js`). Proves:
 *   1. `LinearPort`-typed bindings accept BOTH the real adapter and the fake (structural
 *      conformance — the parity harness rests on exactly this);
 *   2. no port method signature grew a retry/timeout/options knob (frozen invariant 2 — the
 *      retry posture lives in configuration, never per-call);
 *   3. the chain/identity machinery accepts ANY `LinearPort`, not the concrete adapter type.
 */
import type { ResolvedConfig } from "task-linear-sync/config";
import {
  attachmentUrlConfigFrom,
  createLinearPort,
  enumerateAttachmentChain,
  issueCarriesTaskIdentity,
  resolveIssueByTaskIdentity,
  type AttachmentMetadata,
  type CreateIssueInput,
  type IssueScope,
  type IssueUpdatePatch,
  type LinearPort,
} from "task-linear-sync/tracker";
import { createFakeLinearPort } from "task-linear-sync/tracker/testing";

// ── helpers ───────────────────────────────────────────────────────────────────────
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;

// ── 1. both bindings structurally satisfy the frozen port ─────────────────────────
const realAdapter: LinearPort = createLinearPort({ config: {} as ResolvedConfig });
const fakeBinding: LinearPort = createFakeLinearPort();
void realAdapter;
void fakeBinding;

// ── 2. exact parameter tuples — no hidden "options" third parameter anywhere ──────
type _ListIssues = Assert<Exact<Parameters<LinearPort["listIssues"]>, [IssueScope]>>;
type _Discover = Assert<Exact<Parameters<LinearPort["discoverMetadata"]>, [readonly string[]]>>;
type _GetIssue = Assert<Exact<Parameters<LinearPort["getIssue"]>, [string]>>;
type _CreateIssue = Assert<Exact<Parameters<LinearPort["createIssue"]>, [CreateIssueInput]>>;
type _UpdateIssue = Assert<Exact<Parameters<LinearPort["updateIssue"]>, [string, IssueUpdatePatch]>>;
type _ArchiveIssue = Assert<Exact<Parameters<LinearPort["archiveIssue"]>, [string]>>;
type _FindIssues = Assert<Exact<Parameters<LinearPort["findIssuesByAttachmentUrl"]>, [string]>>;
type _UpdateAttachment = Assert<Exact<Parameters<LinearPort["updateAttachment"]>, [string, AttachmentMetadata]>>;
type _GetAttachment = Assert<Exact<Parameters<LinearPort["getAttachmentByUrl"]>, [string]>>;
type _ListAttachments = Assert<Exact<Parameters<LinearPort["listAttachments"]>, [string, (string | null)?]>>;
void 0 as unknown as [
  _ListIssues, _Discover, _GetIssue, _CreateIssue, _UpdateIssue,
  _ArchiveIssue, _FindIssues, _UpdateAttachment, _GetAttachment, _ListAttachments,
];

// A per-call retry/timeout knob is COMPILE-ERROR — the frozen port offers none (invariant 2).
// @ts-expect-error getIssue takes an id only — no options bag exists
void realAdapter.getIssue("id", { retry: true });
// @ts-expect-error createIssue takes the input only — an unknown "retries" key is rejected
void realAdapter.createIssue({ teamKey: "t", projectId: "p", title: "x", description: "d", retries: 3 });
// @ts-expect-error the update patch is closed — stateTypeId is the frozen vocabulary, a raw per-call stateId is not
void realAdapter.updateIssue("id", { title: "x", stateId: "st-1" });
// @ts-expect-error listAttachments takes an opaque cursor string, not an offset or options object
void fakeBinding.listAttachments("issue", 10);
// @ts-expect-error discoverMetadata takes team keys only — no timeout override exists
void fakeBinding.discoverMetadata(["acme-team"], { timeoutMs: 1 });

// ── 3. chain/identity machinery accepts ANY LinearPort (never a concrete type) ─────
// The parameter types ARE port-shaped (Pick<> / LinearPort), so ANY implementation — fake,
// real, or hand-rolled stub — satisfies them; a concrete-only parameter would trip the
// assignments below at compile time.
const urlConfig = attachmentUrlConfigFrom({
  attachmentBaseHost: "https://sync.example.invalid",
  toolId: "task-linear-sync",
  attachmentUrlTemplate: "{baseHost}/{toolId}/{uuid}",
  continuationUrlTemplate: "{baseHost}/{toolId}/{uuid}/{page}",
});
const ANY_UUID = "00000000-0000-4000-8000-000000000001";

async function acceptAnyPort(r: LinearPort, f: LinearPort): Promise<void> {
  await enumerateAttachmentChain(r, urlConfig, ANY_UUID);
  await enumerateAttachmentChain(f, urlConfig, ANY_UUID, { orphanProbeLimit: 4 });
  await resolveIssueByTaskIdentity(r, urlConfig, ANY_UUID);
  await resolveIssueByTaskIdentity(f, urlConfig, ANY_UUID);
  await issueCarriesTaskIdentity(r, urlConfig, "issue-id", ANY_UUID);
  await issueCarriesTaskIdentity(f, urlConfig, "issue-id", ANY_UUID);
}
void acceptAnyPort;
