/**
 * T037 [US2] — real mutation operations replacing the T023 shell (contracts/tracker-adapter.md
 * rows 3–6): `getIssue` maps the `issue(id)` node (GraphQL null / HTTP 404 ⇒ `null`);
 * `createIssue` resolves `teamKey → teamId` (+ project identity → project id) through the R10
 * discovery cache BEFORE dispatch — unknown identities are `TrackerConfigError`s "so it is not
 * indeterminate" — and runs the ONLY `retryClass: "never"` path: exactly one request; any
 * post-dispatch retryable failure surfaces as `IndeterminateCreateError` ("a failed create is
 * recorded as indeterminate and reconciled, not replayed"). `updateIssue` passes the partial
 * patch through (resolving `stateTypeId` names to state ids where discovery knows them);
 * `archiveIssue` maps `success: false` + `userError` to a deterministic `graphql` error.
 */
import type { CreateIssueInput, IssueUpdatePatch, IssueView } from "../../ports/linear-port.js";
import { TrackerConfigError, TrackerError } from "../errors.js";
import { asRecord, mapIssueNode, payloadUserError, type TeamDiscoveryRecord } from "../graphql/mapping.js";
import { ensureTeam } from "../internal/discovery.js";
import type { TrackerContext } from "../internal/request.js";

/**
 * `stateTypeId → stateId` name mapping: an identity the warmed cache recognizes (platform id,
 * else a state TYPE name on any discovered team) resolves to the state id; anything else is
 * forwarded verbatim as an opaque platform id.
 */
function resolveStateIdentity(ctx: TrackerContext, typeOrId: string): string {
  for (const team of ctx.discovery.records()) {
    const direct = team.workflowStates.find((s) => s.id === typeOrId);
    if (direct) return direct.id;
  }
  for (const team of ctx.discovery.records()) {
    const byType = team.workflowStates.find((s) => s.type === typeOrId);
    if (byType) return byType.id;
  }
  return typeOrId;
}

function mutationUserError(data: Record<string, unknown>, key: string, ctx: TrackerContext): void {
  const userError = payloadUserError(asRecord(data[key]));
  if (userError !== "") {
    // Deterministic platform rejection — a user-input error, never indeterminate, never retried.
    throw new TrackerError({ category: "graphql", retryable: false, attempts: 1, detail: ctx.sanitize(`${key}: ${userError}`) });
  }
}

export async function getIssueImpl(ctx: TrackerContext, id: string): Promise<IssueView | null> {
  return ctx.exec.exec("issue", { id }, (d) => (d["issue"] == null ? null : mapIssueNode(d["issue"])), {
    retryClass: "non-create",
    notFoundMeansNull: true,
  });
}

export async function createIssueImpl(ctx: TrackerContext, input: CreateIssueInput): Promise<IssueView> {
  const team: TeamDiscoveryRecord = await ensureTeam(ctx, input.teamKey);
  const projectId = ctx.discovery.resolveProjectId(input.teamKey, input.projectId);
  const variables: Record<string, unknown> = {
    teamId: team.teamId,
    projectId,
    title: input.title,
    description: input.description,
  };
  if (input.stateType !== undefined) {
    const state = team.workflowStates.find((s) => s.type === input.stateType || s.id === input.stateType);
    if (!state) {
      throw new TrackerConfigError(
        `state type '${input.stateType}' for team '${input.teamKey}' was not resolved by discovery — unknown workflow state`,
      );
    }
    variables["stateId"] = state.id;
  }
  if (input.parentId !== undefined) variables["parentId"] = input.parentId;
  return ctx.exec.exec(
    "issueCreate",
    variables,
    (d) => {
      mutationUserError(d, "issueCreate", ctx);
      const issue = asRecord(d["issueCreate"])?.["issue"];
      if (issue == null) {
        throw new TrackerError({
          category: "create-indeterminate",
          retryable: false,
          attempts: 1,
          detail: "issueCreate returned neither an issue nor a userError — outcome indeterminate, recorded, not replayed",
        });
      }
      return mapIssueNode(issue);
    },
    { retryClass: "never" },
  );
}

export async function updateIssueImpl(ctx: TrackerContext, id: string, patch: IssueUpdatePatch): Promise<IssueView> {
  const variables: Record<string, unknown> = { id };
  if (patch.title !== undefined) variables["title"] = patch.title;
  if (patch.description !== undefined) variables["description"] = patch.description;
  if (patch.stateTypeId !== undefined) variables["stateId"] = resolveStateIdentity(ctx, patch.stateTypeId);
  return ctx.exec.exec(
    "issueUpdate",
    variables,
    (d) => {
      mutationUserError(d, "issueUpdate", ctx);
      const issue = asRecord(d["issueUpdate"])?.["issue"];
      if (issue == null) {
        throw new TrackerError({
          category: "not-found",
          retryable: false,
          attempts: 1,
          detail: ctx.sanitize(`issueUpdate returned no issue for '${id}'`),
        });
      }
      return mapIssueNode(issue);
    },
    { retryClass: "non-create" },
  );
}

export async function archiveIssueImpl(ctx: TrackerContext, id: string): Promise<void> {
  await ctx.exec.exec(
    "issueArchive",
    { id },
    (d) => {
      mutationUserError(d, "issueArchive", ctx);
      return null;
    },
    { retryClass: "non-create" },
  );
}
