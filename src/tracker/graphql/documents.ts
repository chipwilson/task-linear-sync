/**
 * The COMPLETE GraphQL document set — the R12 allow-list (research R12; contracts/
 * tracker-adapter.md structural invariant 3). `documents.ts` is the ONLY module in the
 * package containing GraphQL text; the contract test `tests/contract/tracker-doc-allowlist`
 * asserts the exported operation set equals this exact enumeration and fails on any search
 * operation or any `description`-typed filter anywhere (FR-004: implementations "MUST NOT
 * search issue descriptions for identity" — description is DATA, selected for views, never a
 * filter predicate).
 */

export type GraphQLOperationName =
  | "issues"
  | "issue"
  | "teamMetadata"
  | "issueCreate"
  | "issueUpdate"
  | "issueArchive"
  | "attachmentsForURL"
  | "attachmentCreate"
  | "attachmentUpdate"
  | "issueAttachments";

export interface GraphQlDocument {
  readonly operationName: GraphQLOperationName;
  readonly source: string;
}

/** Shared selection set mirroring the frozen IssueView field mapping (data-model §10). */
const ISSUE_FIELDS =
  "id identifier title description updatedAt archivedAt team { key } project { id } state { type }";

const ATTACHMENT_FIELDS = "id url title subtitle metadata";

export const GRAPHQL_DOCUMENTS: Readonly<Record<GraphQLOperationName, GraphQlDocument>> = {
  // Per-team scoped, cursor-paginated listing (R6): filter is per team — team key eq, this
  // team's resolved project ids, and state types NOT in the ignored set. No description
  // predicate exists in any filter position.
  issues: {
    operationName: "issues",
    source: `query issues($first: Int!, $after: String, $teamKey: String!, $projectIds: [ID!]!, $ignoredStateTypes: [String!]!) {
  issues(first: $first, after: $after, filter: { team: { key: { eq: $teamKey } }, project: { id: { in: $projectIds } }, state: { type: { nin: $ignoredStateTypes } } }) {
    nodes { ${ISSUE_FIELDS} }
    pageInfo { hasNextPage endCursor }
  }
}`,
  },
  issue: {
    operationName: "issue",
    source: `query issue($id: ID!) {
  issue(id: $id) { ${ISSUE_FIELDS} }
}`,
  },
  // One query resolves identities for all requested teams (R10): key + projects + workflow
  // states; the platform team id is selected for the create path (cached, not exported).
  teamMetadata: {
    operationName: "teamMetadata",
    source: `query teamMetadata($teamKeys: [String!]!) {
  teams(filter: { key: { in: $teamKeys } }) {
    nodes {
      id
      key
      projects { nodes { id name } }
      states { nodes { id name type } }
    }
  }
}`,
  },
  issueCreate: {
    operationName: "issueCreate",
    source: `mutation issueCreate($input: IssueCreateInput!) {
  issueCreate(input: $input) { success userError issue { ${ISSUE_FIELDS} } }
}`,
  },
  issueUpdate: {
    operationName: "issueUpdate",
    source: `mutation issueUpdate($id: ID!, $input: IssueUpdateInput!) {
  issueUpdate(id: $id, input: $input) { success userError issue { ${ISSUE_FIELDS} } }
}`,
  },
  issueArchive: {
    operationName: "issueArchive",
    source: `mutation issueArchive($id: ID!) {
  issueArchive(id: $id) { success userError }
}`,
  },
  // The identity route (FR-004): addressed purely by attachment URL. Carries the owning
  // issue so URL queries map to IssueView[] carriers.
  attachmentsForURL: {
    operationName: "attachmentsForURL",
    source: `query attachmentsForURL($url: String!) {
  attachmentsForURL(url: $url) { ${ATTACHMENT_FIELDS} issue { ${ISSUE_FIELDS} } }
}`,
  },
  // Platform URL idempotency IS the frozen create-or-update semantic (R7): same (issue, url)
  // updates the original attachment in place — no client-side read-before-write.
  attachmentCreate: {
    operationName: "attachmentCreate",
    source: `mutation attachmentCreate($input: AttachmentCreateInput!) {
  attachmentCreate(input: $input) { success userError attachment { ${ATTACHMENT_FIELDS} } }
}`,
  },
  attachmentUpdate: {
    operationName: "attachmentUpdate",
    source: `mutation attachmentUpdate($id: ID!, $input: AttachmentUpdateInput!) {
  attachmentUpdate(id: $id, input: $input) { success userError attachment { ${ATTACHMENT_FIELDS} } }
}`,
  },
  issueAttachments: {
    operationName: "issueAttachments",
    source: `query issueAttachments($id: ID!, $first: Int!, $after: String) {
  issue(id: $id) {
    attachments(first: $first, after: $after) {
      nodes { ${ATTACHMENT_FIELDS} }
      pageInfo { hasNextPage endCursor }
    }
  }
}`,
  },
};

/** The enumerated allow-list (order = allow-list order asserted by the T042 contract test). */
export const GRAPHQL_OPERATION_NAMES: readonly GraphQLOperationName[] = [
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
