# Quickstart: Background Queue, Worker, and Hook Triggers (010)

**Date**: 2026-11-05 | **Feature**: `specs/010-background-queue-sync-hooks`
**Source**: [spec.md](./spec.md) · [plan.md](./plan.md) · [research.md](./research.md) ·
[data-model.md](./data-model.md) · [contracts/](./contracts/README.md)

This document is the executable verification plan: every user story, every
functional requirement (FR-001…FR-009) and every success criterion
(SC-001…SC-003) maps to a concrete check, and §8 is the traceability matrix
that [tasks.md](./tasks.md) cross-references (every automated counterpart test
name appears there too). Story titles are the spec.md titles verbatim.

## Two verification lanes (why there are two)

The 007 port is the only route to a task source, and this environment has no
live tracker. The established 008/009 e2e precedent therefore splits:

- **Spawned-CLI lane** (bash below): the real compiled CLI in a sandbox —
  proves queue mechanics, hook firing, exit codes, files, notifications,
  agent scaffolds. Engine-driven drains in this lane deterministically take
  the *degraded* path (credential/connectivity error → `failed` marker,
  report, notification, repository untouched) — which is itself the spec's
  degradation check (edge case "worker starts while credentials are absent",
  SC-003).
- **In-process lane** (`tests/e2e/*.test.ts` via `tests/helpers/queue-harness.ts`
  + the 007 fake port from `tests/helpers/engine-harness.ts`): success paths of
  engine-driven drains — applied outcomes, gate settings honoured end-to-end,
  LOCK_HELD deferral — with the same queue code under an injected clock and a
  faked worker spawn.

---

## 0. Prerequisites & sandbox harness

- Node.js 20.x, `npm ci && npm run build` (spawned lanes need
  `dist/queue/worker-entry.js`). Zero network.

```bash
REPO="$PWD"; CLI="$REPO/dist/cli/main.js"
SANDBOX="$(mktemp -d)"; trap 'rm -rf "$SANDBOX"' EXIT
mkdir -p "$SANDBOX/home" "$SANDBOX/state" "$SANDBOX/repo"
export HOME="$SANDBOX/home" XDG_STATE_HOME="$SANDBOX/state"

git init -q "$SANDBOX/repo"
printf 'id: sync-ws\n' > "$SANDBOX/repo/tasks.yaml"
cat > "$SANDBOX/repo/task-linear-sync.json" <<'JSON'
{
  "workspaceId": "ws-quickstart",
  "taskFile": "tasks.yaml",
  "stateDirectory": "STATE_DIR",
  "linearProjectId": "proj-1",
  "queue": { "workerDelaySeconds": 2 }
}
JSON
sed -i "s|STATE_DIR|$SANDBOX/state/tls|" "$SANDBOX/repo/task-linear-sync.json"
cd "$SANDBOX/repo"

git -C "$SANDBOX/repo" -c user.email=t@invalid -c user.name=t commit -q --allow-empty -m seed
git init -q --bare "$SANDBOX/remote.git"
git -C "$SANDBOX/repo" remote add origin "$SANDBOX/remote.git"   # local file remote: real push, zero network
```

Notes: `stateDirectory` (frozen key) is used **verbatim** (frozen resolution
order), so `pending-job.json`, `queue-lock.json`, `last-run.json` and
`reports/` sit directly under `$SANDBOX/state/tls/`; `queue` is the additive
group of [queue-protocol.md §4](./contracts/queue-protocol.md). The
environment exports no tracker credential, so every engine-driven drain below
degrades — expected, asserted, and notified.

## 2. US1 — Non-blocking enqueue and drain (P1) — spawned-CLI lane

```bash
# 2.1 manual enqueue (FR-001, FR-007): returns immediately, NEVER contacts the tracker
time node "$CLI" enqueue                      # exit 0; outcome "enqueued" + jobId on stdout
jq -r '.jobId, .mode, .retryCount' "$SANDBOX/state/tls/pending-job.json"   # id, "sync", 0

# 2.2 merge guarantee: enqueue again (different mode) — single slot, stable identity (FR-001, FR-004)
node "$CLI" enqueue --mode bootstrap
jq -r '.mode' "$SANDBOX/state/tls/pending-job.json"                          # "bootstrap" — latest mode wins
# (automated counterpart asserts jobId/enqueuedAt preserved and retryCount reset)

# 2.3 SC-001 timing — the whole hook fire timed (real push to the local bare remote):
node "$CLI" install-hooks                     # exit 0; outcome "installed" — the frozen hook set minus unsupported names
START=$(date +%s%N)
git push -q origin HEAD 2>"$SANDBOX/push.err"; RC=$?
ELAPSED_MS=$(( ($(date +%s%N) - START) / 1000000 ))
test $RC -eq 0 && test $ELAPSED_MS -lt 500    # push proceeds exactly as before the hook existed
cat "$SANDBOX/push.err"                       # prior run + enqueued lines — stderr only, never stdout
jq -r '.mode' "$SANDBOX/state/tls/pending-job.json"                          # merged to "sync" (post-merge trigger)

# 2.4 background drain + terminal state (degraded offline = spec's own edge case):
sleep 4                                       # > workerDelaySeconds (2 s)
jq -r '.outcome' "$SANDBOX/state/tls/last-run.json"     # "failed" — degraded offline; marker stays fresh (FR-005)
ls "$SANDBOX/state/tls/reports/"                         # machine report written per completion (FR-005)
ls "$SANDBOX/state/tls/" | grep -c '^pending-job.json$' || true   # 0 after a terminal apply (data-model §2)

# 2.5 notification (FR-005): with the §7 sink exported, exactly one record per finished run
export TASK_LINEAR_SYNC_TEST_NOTIFY="$SANDBOX/notifications.log"
node "$CLI" worker --once                     # exit 0; outcome "stopped" (drained or deferred this pass)
cat "$TASK_LINEAR_SYNC_TEST_NOTIFY"           # ≥1 line, title = workspace id, body = outcome + counts

# 2.6 shell entry sanity (FR-008): the enqueue path is stable, shell-invocable, exit 0
node "$CLI" enqueue --mode sync; test $? -eq 0
```

| Check | Traces |
| --- | --- |
| enqueue ≤ 500 ms, tracker untouched, exit 0 (manual AND hook-fired) | FR-001, FR-007, SC-001 |
| one job per trigger, merged identity; delayed fallback drain fires | FR-001 (incl. R6 fallback) |
| marker + report + one notification per finished run, degraded included | FR-005, FR-008 |
| retry bound + terminal notification | FR-004 (in-process lane §6) |
| `install-agent-hook` scaffolds + managed hooks change zero foreign bytes | FR-006, FR-009 (US3 §3 lane) |

## 3. US3 — Managed hook installation and scaffolds (P3) — spawned-CLI lane

```bash
# 3.1 install + idempotency (FR-006): second install touches no extra bytes, one block
node "$CLI" install-hooks
cmp "$SANDBOX/hook.snapshot" .git/hooks/pre-push 2>/dev/null || { cp .git/hooks/pre-push "$SANDBOX/hook.snapshot"; node "$CLI" install-hooks; cmp "$SANDBOX/hook.snapshot" .git/hooks/pre-push; }

# 3.2 byte-preservation (SC-003): strip the managed range, remaining bytes equal the pre-install text
#     (automated counterpart: byte-level scan in tests/integration/queue-hooks-install.test.ts)

# 3.3 the fire test — direct hook invocation (fresh repos merge --ff-only without running post-merge,
#     so the harness calls the hook it installed, with the cwd/env git provides):
./.git/hooks/post-merge 2>"$SANDBOX/hook.err"; test $? -eq 0   # exit 0 even mid-degradation
cat "$SANDBOX/hook.err"                        # prior run outcome + summary (marker is fresh — §2.4)
node "$CLI" enqueue                            # a second fire coalesces onto the same jobId (SC-001)

# 3.4 agent scaffold (FR-009): framework dir + never-overwrite
node "$CLI" install-agent-hook --framework kiro        # exit 0, outcome "installed"
cat .kiro/hooks/task-linear-sync-sync.json     # 003 template + additive "post-file-save" + taskFilePatterns
node "$CLI" install-agent-hook --framework kiro        # suffix -2 — existing file byte-unchanged

# 3.5 degraded posture (US3 + edge case): credentials absent → hook still exits 0 AND enqueues
env -u LINEAR_API_KEY ./.git/hooks/post-merge; test $? -eq 0
```

| Check | Traces |
| --- | --- |
| hooks install idempotently; zero bytes changed outside markers | FR-006, SC-003 |
| hook fire: prior run printed, always exit 0, enqueue happens (incl. degraded) | FR-007, SC-001 |
| scaffold = 003 template + additive event/pattern fields; never overwrites | FR-009 |

## 4. Degradation & reports (cross-cutting US1) — spawned-CLI lane

```bash
# 4.1 credentials cleared: queued apply degrades LOUDLY — never silent success
env -u LINEAR_API_KEY bash -c 'node "$CLI" enqueue && node "$CLI" worker --once'
jq -r '.outcome, .error.code' "$SANDBOX/state/tls/last-run.json"   # "failed" + a sanitized code (never a credential)

# 4.2 the marker's notificationSuppressed reflects DELIVERY truth after §7 wiring (research R8):
grep -o '"notificationSuppressed":[a-z]*' "$SANDBOX/state/tls/last-run.json"
#   sink present → false; reconfigure {"queue":{"notificationsEnabled":false}} + re-fire → true
```

| Check | Traces |
| --- | --- |
| degraded run: failed marker + report + notification, repo untouched | FR-005, SC-003, spec edge |
| suppression truth, notifications toggle honoured | FR-005 |

## 5. Exit-code contract (009 map — inherited unchanged)

| Command (sandbox) | Expect |
| --- | --- |
| `node "$CLI" enqueue` | exit 0, `QueueOutcome{ status:"enqueued", detail: jobId }` |
| `node "$CLI" enqueue --mode bootstrap` | exit 0; job's `mode` is `"bootstrap"` (FR-004 half) |
| `node "$CLI" enqueue` with invalid `queue.workerDelaySeconds: 0` | exit 4 (refused), ALL bad fields in ONE `detail` line (frozen validation posture) |
| `node "$CLI" worker --once` | exit 0, `status:"stopped"` — per-drain truth lives in reports/marker, not the frozen status set |
| `node "$CLI" worker` (no flag) | foreground loop until SIGINT/SIGTERM, then exit 0 `stopped` (test harness sends the signal) |
| `node "$CLI" install-hooks` / `install-agent-hook [--framework kiro]` | exit 0 `installed`; unsupported hook name configured → exit 4, ZERO bytes written |
| `node "$CLI" last-run` | exit 0 + frozen `RunPresentation` — served by the FROZEN 009 lane; FR-007's hook block invokes exactly this command |
| queue command with frozen-identity missing | exit 3 (frozen config posture, unchanged) |
| `verify-hooks` | exit 2 — 009's map extended by NOTHING (research R12) |

## 6. In-process lane (success paths)

```bash
npm test            # whole matrix; per-file names below — no npm test:* scripts exist
# targeted lanes (node --test):
npx tsx --test tests/unit/queue-config.test.ts tests/unit/pending-job.test.ts \
  tests/unit/queue-lock.test.ts tests/unit/enqueue.test.ts tests/unit/drain.test.ts \
  tests/unit/drain-retry.test.ts tests/unit/worker.test.ts tests/unit/queue-reports.test.ts \
  tests/unit/notify.test.ts tests/unit/git-hooks.test.ts tests/unit/agent-hooks.test.ts \
  tests/unit/queue-surface.test.ts
npx tsx --test tests/integration/queue-enqueue-drain.test.ts tests/integration/queue-modes.test.ts \
  tests/integration/queue-storm.test.ts tests/integration/queue-lock-timeout.test.ts \
  tests/integration/queue-hooks-install.test.ts tests/integration/queue-hook-fire.test.ts
npx tsx --test tests/e2e/queue-background-sync.test.ts
```

These mirror the 002/007/008 precedent exactly: injected `FakeClock`, scripted
fake port, `holdRunLock` for the LOCK_HELD deferral path (apply refused → job
kept WITHOUT retryCount — research R7), mode-application assertions
(enqueue `--mode bootstrap` → marker `.mode == "bootstrap"` — FR-004), and the
retry-limit terminal path (retryCount ≥ maxRetries → terminal `failed` marker +
one notification — FR-004, US1 scenario 4).

## 7. Notification harness seam

`TASK_LINEAR_SYNC_TEST_NOTIFY=<file>` — when set, the Notifier appends
`{"ts":…,"title":…,"body":…}` JSON lines to that file instead of spawning the
platform tool (env passes through the detached spawn, research R6/R8).
Production posture otherwise unchanged: osascript → notify-send → powershell →
suppressed (logged, never fails the run — FR-005 "best effort"). Automated
counterpart: `tests/unit/notify.test.ts` injects the seam (Principle VI).

## 8. Coverage matrix (quickstart ↔ FR/SC)

Canonical ids per spec.md lines 129-196; story rows: US1 = §2/§4/§6,
US2 = §5/§6, US3 = §3.

| Requirement | Quickstart check | Automated tests |
| --- | --- | --- |
| FR-001 | §2.1-2.3 enqueue ≤ 500 ms + merge + fallback | `unit/enqueue` (+500 ms budget guard), `integration/queue-enqueue-drain`, `unit/pending-job` (merge) |
| FR-002 | §5 refusal lines + §6 lock-timeout lane + §3.3 fire-during-drain posture | `unit/queue-lock`, `unit/queue-config`, `integration/queue-lock-timeout`, `e2e/queue-background-sync` (run-lock) |
| FR-003 | §6 claim/heartbeat/reclaim scenarios | `unit/drain` (atomic claim + reclaim @300 s virtual), `unit/queue-lock` (pid liveness) |
| FR-004 | §2.2 mode merge + §6 mode application + retry limit | `integration/queue-modes`, `unit/drain` (retryCount), `e2e/queue-background-sync` (RETRY_LIMIT terminal) |
| FR-005 | §2.4/§4 marker+report+notification incl. degraded | `unit/queue-reports`, `unit/notify`, `integration/queue-enqueue-drain`, `e2e/queue-background-sync` |
| FR-006 | §3.1-3.2 install/idempotent/byte-scan + bad-name §5 | `unit/git-hooks`, `unit/agent-hooks`, `integration/queue-hooks-install` (byte-level) |
| FR-007 | §3.3/§3.5 fire + always exit 0 + degraded enqueue | `integration/queue-hook-fire`, `integration/queue-enqueue-drain` |
| FR-008 | §2.6 shell-invocable enqueue, exit 0 | `integration/queue-enqueue-drain`, `integration/queue-storm` (100 × exit 0) |
| FR-009 | §3.4 scaffold + suffix + patterns honoured | `unit/agent-hooks`, `integration/queue-hooks-install`, `e2e/queue-background-sync` |
| SC-001 | §2.3 < 500 ms + §3.3 repeated fires | `integration/queue-enqueue-drain` (timing guard), `integration/queue-storm` (≤1 pending) |
| SC-002 | §2.2/§6 single live claim + reclaim | `integration/queue-storm` (grep exactly one `claim:`), `unit/queue-lock` |
| SC-003 | §3.2 byte-scan + §4 degraded-loudly | `integration/queue-hooks-install` (intact user bytes), `contract/queue-hygiene.mjs` (frozen-path zero-delta) |

### 8.1 Matrix log — recorded SC-001 / SC-002 measurements (2026-11-06)

Run on this workspace against a fresh `dist/` build with the CLI on `PATH` (temp-`HOME`
sandbox, no network — the pre-flight gate ends the background pass in `skipped`):

- **SC-001** — 100 × `task-linear-sync queue enqueue` (the `integration/queue-storm`
  storm, plus a wall-clock probe): all 100 processes exited **0** in 4.7 s total,
  average **46.9 ms** and max **66 ms** per enqueue — ~10× under the 500 ms ceiling
  (the enqueue path makes no network calls).
- **SC-002** — the same 100-enqueue storm yielded **≤1 pending job** (single-slot
  dedup, `integration/queue-storm`); with a worker active, exactly **one** `claim:`
  exists at any moment (the storm test greps exactly one live claim; the reclaim lane
  covers the dead-worker case), and every git-hook run in
  `integration/queue-hook-fire` exited **0** (100%), including the degraded
  (credential-less) one, while consecutive fires still produced **one** pending job.

## 9. Cleanup & troubleshooting

```bash
# 9.1 sandbox teardown — the EXIT trap owns it; the harness never touches the repo itself:
git worktree remove "$SANDBOX/repo" 2>/dev/null || true   # only if you used a worktree instead of mktemp
rm -rf "$SANDBOX"
#     automated counterpart for harness teardown: tests/helpers/queue-cleanup.ts
#     (removeGitMetadata + removeQueueArtifacts, wired into makeQueueHarness().dispose())
# 9.2 state residue lives OUTSIDE the repository (stateDirectory) — rm -rf "$SANDBOX/state/tls";
#     managed hook blocks: splice out via uninstall (marker-bounded, byte-honest)
```

- `pending-job.json` never drains → `queue-lock.json` held by a live worker
  (`jq .pid` + `kill -0`); a dead holder self-reclaims (research R4).
- Notification absent in the spawned lane → export the §7 sink BEFORE `install`
  /`worker` — the sink env must reach the detached child.
- Hook silent → verify `hookScriptPrefix` matches the installed script name.
