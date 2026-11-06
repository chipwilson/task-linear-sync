/**
 * T018 — the line framer (data-model §2; jsonrpc-stdio.md §1). Pure incremental
 * newline-delimited decoder: `feed` yields complete lines or the oversize sentinel;
 * at most one partial tail is retained. A line over `MAX_LINE_BYTES` is dropped with the
 * sentinel (the caller answers `-32700` and the connection continues — never a partial
 * parse, never a truncation-into-success). Zero timers, zero fs.
 */

/** jsonrpc-stdio.md §1.3: a complete line larger than 1 MiB is refused, not truncated. */
export const MAX_LINE_BYTES = 1024 * 1024;

export type FramedItem = string | { readonly oversize: true };

export interface LineFramer {
  /** Push bytes/text; returns the items completed by this chunk (possibly none). */
  feed(chunk: Buffer | string): FramedItem[];
  /** EOF: a non-empty tail decodes ONCE as a final line (oversize rules still apply). */
  end(): FramedItem[];
}

const NEWLINE = 0x0a;
const CARRIAGE = 0x0d;

export function createLineFramer(): LineFramer {
  let tail: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  // Past MAX_LINE_BYTES without a terminator: bytes are dropped (memory stays bounded)
  // and the eventual terminator (or EOF) reports the sentinel exactly once.
  let oversizePending = false;

  function emitLine(raw: Buffer, out: FramedItem[]): void {
    // §1.1: the \r belongs to the terminator — strip BEFORE the size rule (§1.3).
    const body = raw.length > 0 && raw[raw.length - 1] === CARRIAGE ? raw.subarray(0, raw.length - 1) : raw;
    if (body.byteLength === 0) return; // blank lines are ignored
    if (body.byteLength > MAX_LINE_BYTES) out.push({ oversize: true });
    else out.push(body.toString("utf8"));
  }

  function feed(chunk: Buffer | string): FramedItem[] {
    const incoming = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
    const out: FramedItem[] = [];
    if (oversizePending) {
      const end = incoming.indexOf(NEWLINE);
      if (end < 0) return out; // still inside the dropped oversize line
      oversizePending = false;
      out.push({ oversize: true });
      return out.concat(feed(incoming.subarray(end + 1)));
    }
    tail = tail.length === 0 ? incoming : Buffer.concat([tail, incoming]);
    for (;;) {
      const end = tail.indexOf(NEWLINE);
      if (end < 0) break;
      const line = tail.subarray(0, end);
      tail = tail.subarray(end + 1);
      emitLine(line, out);
    }
    // §1.3 with bounded memory: once the partial tail can no longer be a legal line,
    // drop it and let the terminator report the sentinel once.
    const carried = tail.length > 0 && tail[tail.length - 1] === CARRIAGE ? tail.length - 1 : tail.byteLength;
    if (carried > MAX_LINE_BYTES) {
      tail = Buffer.alloc(0);
      oversizePending = true;
    }
    return out;
  }

  function end(): FramedItem[] {
    const out: FramedItem[] = [];
    if (oversizePending) {
      oversizePending = false;
      out.push({ oversize: true });
      return out;
    }
    if (tail.byteLength > 0) {
      const final = tail;
      tail = Buffer.alloc(0);
      emitLine(final, out);
    }
    return out;
  }

  return { feed, end };
}
