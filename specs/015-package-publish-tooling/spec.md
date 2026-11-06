# Feature Specification: Package Publish Tooling

**Feature Branch**: `015-package-publish-tooling`

**Created**: 2026-11-06

**Status**: Draft

**Input**: User description: "package publish tooling" (`README.md` → Current Status → Next
steps). Companion to feature 014, which owns the preview→stable promotion of the 011/012
surfaces; this feature owns the release machinery the constitution mandates but nothing yet
enforces.

## Purpose and Scope

The constitution's release gate (Development Workflow, "Release gates") requires that a release
build the ESM output and declarations, publish every declared entry point, and pass a
distributed-defaults scan that publishes nothing on detection of real organization identifiers,
tokens, or UUIDs. Today no release machinery exists: no publish script, no release workflow, no
license file on disk, no changelog, no tags — and CI validates the repository, never the
publishable artifact. This feature makes a release a single, repeatable, gated action whose gate
fails closed.

**Owns**: the release pipeline and its dry-run; tarball content and consumer-shape verification;
single-source versioning; license/changelog/metadata completeness; the declared versioning
policy; provenance and secret handling for publishing.

**Consumes from 002–013**: the declared export map, the CLI binary, and the existing contract
suites (packaging, hygiene, defaults-scan, credential-sentinel) whose substance the release gate
reuses rather than rewrites.

**Deliverable packaging stays as defined by 013**: `action.yml` ships from the repository tag;
this feature only aligns tag/version consistency — authoring a separate action release channel
is out of scope.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A gated release publishes or publishes nothing (Priority: P1)

A maintainer triggers a release for a tagged version. The pipeline installs from the lockfile,
lints, type-checks, builds, runs the full suite, packs the tarball, and verifies the tarball as a
consumer would: every declared subpath import resolves with its type declarations, the CLI binary
runs, and the archive contains exactly the allow-listed files. A distributed-defaults scan over
the archive contents must find zero real organization identifiers, tokens, or UUIDs. Only then
does publishing happen, with registry provenance; any failure at any stage publishes nothing.

**Why this priority**: this is the constitution's release gate made real — without it every
publish is an unverified act, and the existing scan suites protect the repo but not the artifact.

**Independent Test**: Run the release in dry-run mode end-to-end on the current tree; then inject
each failure class (a UUID-like literal into a shipped file, a missing export target, a binary
that fails to start, a file outside the allow-list) and confirm the run halts before publishing
in every case.

**Acceptance Scenarios**:

1. **Given** a clean tree at a version tag, **When** the release runs, **Then** the stages
   execute in order — locked install → lint → typecheck → build → full test suite → pack →
   archive verification → defaults scan → publish — and publishing starts only after all
   prior stages pass.
2. **Given** a packed archive, **When** verification runs, **Then** it installs the tarball into
   an isolated environment (not the repository), imports every declared subpath entry point
   including the MCP and history-server subpaths, loads each type declaration, and executes the
   CLI binary's version command — all succeeding.
3. **Given** an archive containing a real-looking organization identifier, team key, token, or
   UUID in any shipped file, **When** the defaults scan runs, **Then** the release fails and
   nothing is published.
4. **Given** a stage failure of any kind, **When** the release ends, **Then** nothing was
   published and the failure names the stage.

---

### User Story 2 - The gate rehearses on every pull request (Priority: P1)

Because publishing itself only runs on release, the pipeline ships a dry-run mode that performs
every stage except the publish and runs hermetically — no real credentials, no registry writes —
on every pull request. A release that would fail can therefore never first fail at release time.

**Why this priority**: the constitution's hermetic-pipeline clause and merge-blocking workflow
apply to this tooling too; a gate that only fires at release is a gate that is untested.

**Independent Test**: Confirm the dry-run executes in CI on a pull request with no registry
credential present and reaches the final "would publish" verdict; break the build, the archive,
or the scan on a branch and confirm the PR turns red.

**Acceptance Scenarios**:

1. **Given** a pull request with no publishing secret configured, **When** CI runs the release
   dry-run, **Then** every stage except publish executes and the job reports the would-publish
   verdict.
2. **Given** any stage failure, **When** the dry-run job ends, **Then** the pull request is
   blocked (merge-blocking, like the existing validation workflow).
3. **Given** the dry-run output, **When** logs are inspected, **Then** they contain 0 secret
   values and 0 real organization identifiers.

---

### User Story 3 - One version, a changelog, and a matching tag (Priority: P2)

The package version has exactly one source of truth; every version string embedded in shipped
code or documentation is derived from it at build time and a contract test fails CI on any
drift. Each release appends a changelog entry summarizing user-visible changes, and the release
refuses to run when the changelog lacks an entry for the tagged version or the tag disagrees
with the package version.

**Why this priority**: today the server's self-reported version is a hand-maintained duplicate of
the package version and there is no changelog at all — small costs before the first release,
permanent correctness traps after it.

**Independent Test**: Bump the package version in a branch and confirm the derived embedded
version follows with no other edit, and that a stale embedded duplicate fails CI; remove the
changelog entry or mismatch the tag and confirm the release refuses.

**Acceptance Scenarios**:

1. **Given** a version bump touching only the single source, **When** the package is built,
   **Then** every embedded version in the shipped artifact equals it; injecting a differing
   duplicate fails a contract test.
2. **Given** a release for version X with no changelog entry for X, **When** the release runs,
   **Then** it fails at the archive-verification stage.
3. **Given** a tag whose version differs from the package version, **When** the release runs,
   **Then** it fails before any publish, naming both values.

---

### User Story 4 - The artifact is licensable, discoverable, and honest (Priority: P2)

The archive carries the license text the package manifest declares (MIT), includes a changelog,
declares registry publish settings (access, provenance), and contains no file outside the
declared allow-list. The versioning policy is documented: semver rules for the package, how the
per-surface stability declarations of feature 014 relate to the package version, and the
condition for the package itself reaching 1.0.0 (every public surface stable and dogfooding
complete).

**Why this priority**: publishing without the declared license file is a license violation on day
one; the policy text is what stops "stable-1.0" from becoming ambiguous once 014 promotes the
surfaces.

**Independent Test**: List the packed archive and diff against the allow-list; assert license and
changelog presence; read the versioning policy and check its stated surface-stability mapping
against the 014 declarations.

**Acceptance Scenarios**:

1. **Given** a packed archive, **When** its file list is compared to the manifest allow-list,
   **Then** it contains only allow-listed paths, including the license file matching the declared
   MIT license and the changelog.
2. **Given** the published metadata, **When** inspected, **Then** publish settings (access,
   provenance), engine constraint, and the zero-runtime-dependency posture all match what the
   contract suites already assert about the repository.
3. **Given** the versioning policy doc, **When** read, **Then** it states the 1.0.0 condition and
   the per-surface stability mapping, and it is linked from the README.

## Edge Cases

- **Dirty working tree or missing tag at release time**: the release refuses before building.
- **Provenance unavailable** (registry or runner cannot attest): the release fails closed —
  publishing without attestation requires an explicit, documented operator override, never a
  silent fallback.
- **Releasing an already-published version**: the registry rejects it; the pipeline reports this
  as a versioning mistake, not a partial publish, and publishes nothing.
- **Build output stale or partial** (incremental cache): the pipeline builds from clean so the
  archive never ships stale artifacts.
- **Publish interrupted mid-registry-call**: the pipeline reports the ambiguity explicitly so the
  operator reconciles by checking the registry rather than blindly retrying.
- **Lockfile drift**: install step uses the frozen lockfile only; a lockfile that cannot satisfy
  a clean install fails the release.
- **Changelog entry exists but the archive omits it**: caught by the same allow-list/content
  verification (US1 scenario 2 and US4 scenario 1 overlap by design).

## Requirements *(mandatory)*

- **FR-001**: The distributable archive MUST include the license file matching the license the
  package manifest declares and a changelog, and MUST contain no file outside the manifest's
  declared file allow-list (belt-and-braces exclusion config kept consistent with it).
- **FR-002**: Exactly one source of truth for the package version MUST exist; every version string
  embedded in shipped code or docs MUST be derived from it at build time, with a contract test
  that fails CI when any embedded version cannot be matched to the source.
- **FR-003**: A release MUST execute, in order and failing closed at any stage: locked clean
  install → lint → typecheck → clean build → full test suite → pack → archive verification →
  distributed-defaults scan → publish. Any stage failure MUST publish nothing.
- **FR-004**: Archive verification MUST consume only the packed artifact in an isolated consumer
  environment (never the repository tree): every declared export subpath MUST resolve to both its
  implementation and its generated type declaration, the CLI binary MUST run its version command,
  and the archive's file list MUST equal the allow-list.
- **FR-005**: The distributed-defaults scan MUST run over archive contents — shipped sources,
  docs, and examples — and MUST fail the release on detection of any real organization identifier,
  team key, token, or UUID value, reusing (not reauthoring) the scan logic already contract-tested
  for the repository.
- **FR-006**: Publishing MUST use registry provenance/attestation and the declared access and tag
  policy; publishing credentials MUST come only from the CI platform secret store, MUST never
  appear in logs or annotations, and unattested publishing MUST fail closed absent a documented
  operator override.
- **FR-007**: A release MUST be driven by a repository version tag that matches the package
  version; a mismatch or a missing tag MUST fail the release before any publishing.
- **FR-008**: Every release MUST have a changelog entry for its version summarizing user-visible
  changes; a missing entry MUST fail the release at verification time.
- **FR-009**: A dry-run mode MUST perform every release stage except publishing, run hermetically
  with no publishing credential present, and run merge-blocking on every pull request through the
  project's CI workflow.
- **FR-010**: A versioning policy MUST be documented — semantic versioning for the package, the
  mapping from per-surface stability declarations (feature 014) to package versions, and the
  stated condition for the package reaching 1.0.0 — updated under the documentation duty whenever
  the surface stability set changes.
- **FR-011**: The published artifact MUST carry the same posture the repository contract suites
  enforce: zero runtime dependencies (transport allowance unspent), the full declared export map,
  generated declarations per exported module, and the Node engine constraint.
- **FR-012**: Release tooling MUST add no runtime dependency to the published package; any
  release-time tooling stays a development dependency.

### Key Entities

- **Release Run**: one gated execution — trigger (tag), ordered stages, pass/fail per stage, and
  the publish verdict (published / refused-because-X / would-publish in dry-run).
- **Archive Manifest**: the allow-list-derived expected file list of the packed artifact, verified
  item-by-item against the actual archive.
- **Version Source**: the single manifest field from which all embedded versions derive.
- **Changelog Entry**: per-version user-visible change summary; a release precondition.
- **Versioning Policy**: the documented mapping of package semver to per-surface stability status
  and the 1.0.0 condition.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In a dry-run on the current tree, 100% of declared entry points (every export
  subpath and the CLI binary) resolve, load their type declarations, and run from the packed
  archive in an isolated environment — 0 shipping failures.
- **SC-002**: Each injected failure class (organization identifier/UUID in a shipped file, broken
  export target, non-running binary, off-allow-list file, missing changelog entry, tag mismatch)
  halts the release before publishing, in 6/6 demonstrated mutation checks, publishing nothing.
- **SC-003**: The dry-run gate executes on 100% of pull requests without any publishing
  credential and blocks merge on failure.
- **SC-004**: The first real release ships license + changelog with 0 files outside the
  allow-list, and exactly 1 embedded-version source (0 mismatched version strings found in the
  archive).
- **SC-005**: Release end-to-end duration stays within a documented budget so the gate is
  credible in review (measured via the dry-run CI leg).

## Assumptions

- The publishing target is the public npm registry with token-based, OIDC-provenanced publishing
  configured in the CI platform; the release trigger is a maintainer-initiated workflow run on a
  version tag, not automatic-on-merge.
- The versioning policy ships with the 0.x posture in place today; the 1.0.0 condition (all
  public surfaces stable per feature 014 plus real-workspace dogfooding complete) is recorded as
  policy text, not executed here.
- `action.yml` continues to be consumed from repository tags; this feature only enforces that the
  action and package versions cannot drift, without building a separate action distribution.
- Registry-side concerns (ownership, deprecation, 2FA ceremony) are platform configuration, outside
  this feature; the pipeline only consumes their outcomes (a rejected publish is reported, not
  retried).
- Releasing is still manual after this feature: the tooling automates the gate, not the decision.
