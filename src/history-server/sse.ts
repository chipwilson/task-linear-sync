/**
 * SSE writer (T020; FR-005, contracts/http-surface.md §3/§5).
 *
 * Headers flush immediately, the first `event: history` frame carries the
 * already-loaded view, and each `refreshSeconds` tick (measured on the
 * INJECTED clock, fired by a real timer) re-reads via the cache-backed
 * loader: a changed serialized view ships a new frame, an unchanged tick
 * ships only a `: ping` comment. Upstream failure emits `event: error` and
 * closes. The writer stops the moment the socket closes — no further port
 * reads, no leaked timers.
 */

import type { ServerResponse } from "node:http";
import { ERROR_ENVELOPES, HistoryRequestError } from "./errors.js";
import { SECURITY_HEADERS, errorAsSseFrame, historyFrame, viewAsJson } from "./render.js";
import type { HistoryClock, HistoryPageView } from "./types.js";

export interface SseStreamOptions {
  readonly res: ServerResponse;
  readonly taskUuid: string;
  readonly refreshSeconds: number;
  readonly clock: HistoryClock;
  /** View already rendered for this connection (immediate first frame). */
  readonly initialView: HistoryPageView;
  /** Re-read used on each refresh tick (cache-backed in the wired app). */
  readonly loadView: (taskUuid: string) => Promise<HistoryPageView>;
}

export interface SseStreamHandle {
  /** Resolves with the first `event: history` frame written. */
  readonly firstFrame: Promise<string>;
  /** Resolves when the stream stops (client close or upstream failure). */
  readonly done: Promise<void>;
}

/**
 * "Changed" compares HISTORY content, not reconstruction bookkeeping:
 * `generatedAt` moves with the clock, so equality is decided on the view
 * with that display field normalized away.
 */
function stableForCompare(view: HistoryPageView): string {
  return viewAsJson({ ...view, generatedAt: "" });
}

export function startSseStream(opts: SseStreamOptions): SseStreamHandle {
  const { res, taskUuid, refreshSeconds, clock, initialView, loadView } = opts;
  const refreshMs = refreshSeconds * 1000;

  let closed = false;
  let resolveDone!: () => void;
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });

  const close = (): void => {
    if (closed) return;
    closed = true;
    clearInterval(timer);
    res.end();
    resolveDone();
  };
  const failSafeClose = (): void => {
    try {
      close();
    } catch {
      /* socket already gone — the stream is stopped either way */
    }
  };

  let lastSerialized = stableForCompare(initialView);
  let lastReadIso = clock.now().toISOString();

  const firstFrame = historyFrame(lastSerialized);
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    "Content-Type": "text/event-stream",
    Connection: "keep-alive",
  });
  res.write(firstFrame);

  const timer = setInterval(() => {
    if (closed) return;
    if (clock.elapsed(lastReadIso) < refreshMs) return; // injected-clock gate
    lastReadIso = clock.now().toISOString();
    void loadView(taskUuid).then(
      (view) => {
        if (closed) return;
        if (stableForCompare(view) !== lastSerialized) {
          lastSerialized = stableForCompare(view);
          res.write(historyFrame(viewAsJson(view)));
        } else {
          res.write(": ping\n\n");
        }
      },
      (error: unknown) => {
        if (closed) return;
        const envelope =
          error instanceof HistoryRequestError
            ? error.envelope
            : ERROR_ENVELOPES.TRACKER_UNAVAILABLE;
        try {
          res.write(errorAsSseFrame(envelope));
        } catch {
          /* fall through to close */
        }
        failSafeClose();
      },
    );
  }, refreshMs);
  timer.unref?.(); // a live stream must never hold the event loop open

  res.once("close", failSafeClose);
  res.once("error", failSafeClose);

  return { firstFrame: Promise.resolve(firstFrame), done };
}
