/**
 * T034 (transport half) — the stdio adapter (jsonrpc-stdio.md §5): framer ↔ dispatcher
 * over injected process streams. Bytes in, single-line frames out — stdout carries
 * protocol ONLY (diagnostics take the errorSink), responses are written as complete
 * lines, one `write` per message, in arrival order. A handler rejection becomes
 * `-32603`; the server never throws into the stream and never crashes the host on a
 * bad line.
 */

import process from "node:process";

import {
  createLineFramer,
} from "./framing.js";
import {
  errorReply,
  MSG_PARSE_ERROR,
  RPC_ERROR_CODES,
  serializeMessage,
  type Dispatcher,
} from "./jsonrpc.js";



export interface StdioOverrides {
  readonly readable?: NodeJS.ReadableStream;
  readonly writable?: NodeJS.WritableStream;
  readonly errorSink?: NodeJS.WritableStream;
}

export interface StdioSession {
  close(): void;
}

export function serveStdio(dispatcher: Dispatcher, overrides: StdioOverrides = {}): StdioSession {
  const readable = overrides.readable ?? process.stdin;
  const writable = overrides.writable ?? process.stdout;
  const framer = createLineFramer();

  const failFrame = serializeMessage(errorReply(null, RPC_ERROR_CODES.PARSE_ERROR, MSG_PARSE_ERROR));
  const writeLine = (frame: string): void => {
    writable.write(`${frame}\n`);
  };

  // Arrival-order dispatch with an in-flight promise chain (§5 concurrency rule):
  // responses land in request order even when a lane is slower than its successor.
  let queue: Promise<void> = Promise.resolve();

  function handleLine(line: string): void {
    queue = queue.then(async () => {
      let raw: unknown;
      try {
        raw = JSON.parse(line);
      } catch {
        writeLine(failFrame); // undecidable whether a notification — §1.3 answers -32700
        return;
      }
      const reply = await dispatcher.handleMessage(raw);
      if (reply !== null) writeLine(serializeMessage(reply));
    });
  }

  const onData = (chunk: Buffer | string): void => {
    for (const item of framer.feed(chunk)) {
      if (typeof item === "string") handleLine(item);
      else writeLine(failFrame); // oversize: answered -32700, dropped, connection continues
    }
  };
  const onEnd = (): void => {
    for (const item of framer.end()) {
      // §1.4: a non-empty tail decodes once as the final message; then the session ends.
      if (typeof item === "string") handleLine(item);
      else writeLine(failFrame);
    }
  };

  readable.on("data", onData);
  readable.on("end", onEnd);

  return {
    close(): void {
      readable.off("data", onData);
      readable.off("end", onEnd);
    },
  };
}
