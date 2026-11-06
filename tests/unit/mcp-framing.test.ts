/**
 * T011 [P] — unit tests for the line framer (T018) (contracts/jsonrpc-stdio.md §1;
 * data-model §2). Pure decoder: feed bytes, get complete lines or the oversize sentinel.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { createLineFramer, MAX_LINE_BYTES, type FramedItem } from "../../src/mcp/framing.js";

function lines(items: FramedItem[]): Array<string | "OVERSIZE"> {
  return items.map((item) => (typeof item === "string" ? item : "OVERSIZE"));
}

test("splits on \\n and retains at most one partial tail across feeds", () => {
  const framer = createLineFramer();
  assert.deepEqual(lines(framer.feed('{"a":1}\n{"b"')), ['{"a":1}']);
  assert.deepEqual(lines(framer.feed(':2}\n')), ['{"b":2}']);
  assert.deepEqual(lines(framer.end()), []);
});

test("CRLF hosts: a trailing \\r before the terminator is stripped", () => {
  const framer = createLineFramer();
  assert.deepEqual(lines(framer.feed("one\r\ntwo\r\n")), ["one", "two"]);
});

test("blank lines are ignored", () => {
  const framer = createLineFramer();
  assert.deepEqual(lines(framer.feed("\n\nline\n\r\n\n")), ["line"]);
});

test("byte-wise chunk splitting across many feeds reassembles exactly", () => {
  const framer = createLineFramer();
  const payload = Buffer.from('{"m":"x"}\n{"m":"y"}\n', "utf8");
  const out: FramedItem[] = [];
  for (const byte of payload) out.push(...framer.feed(Buffer.from([byte])));
  assert.deepEqual(lines(out), ['{"m":"x"}', '{"m":"y"}']);
});

test(`a complete line over MAX_LINE_BYTES (${MAX_LINE_BYTES}) yields the oversize sentinel and is DROPPED`, () => {
  assert.equal(MAX_LINE_BYTES, 1024 * 1024, "1 MiB constant");
  const framer = createLineFramer();
  const oversize = `{"data":"${"x".repeat(MAX_LINE_BYTES)}"}`;
  assert.ok(Buffer.byteLength(oversize, "utf8") > MAX_LINE_BYTES);
  const out = framer.feed(`${oversize}\n`);
  assert.deepEqual(lines(out), ["OVERSIZE"]);
});

test("oversize drops the line and the connection CONTINUES — never a partial parse or truncation-into-success", () => {
  const framer = createLineFramer();
  const big = "z".repeat(MAX_LINE_BYTES + 10);
  assert.deepEqual(lines(framer.feed(`${big}\n`)), ["OVERSIZE"]);
  assert.deepEqual(lines(framer.feed('{"ok":true}\n')), ['{"ok":true}']);
  // A second oversize line still reports the sentinel (state is clean after each line).
  assert.deepEqual(lines(framer.feed(`${big}\n`)), ["OVERSIZE"]);
});

test("a huge PARTIAL line without a terminator stays bounded and reports oversize once terminated (or at end)", () => {
  const framer = createLineFramer();
  const first = framer.feed("q".repeat(MAX_LINE_BYTES * 2));
  assert.deepEqual(lines(first), [], "no sentinel before the line completes");
  assert.deepEqual(lines(framer.end()), ["OVERSIZE"], "EOF terminates the oversize tail once");
  assert.deepEqual(lines(framer.end()), [], "reported exactly once — end() is idempotent after drain");
});

test("stream end decodes a non-empty partial tail exactly once", () => {
  const framer = createLineFramer();
  assert.deepEqual(lines(framer.feed('{"tail":1}')), []);
  assert.deepEqual(lines(framer.end()), ['{"tail":1}']);
  assert.deepEqual(lines(framer.end()), []);
});

test("end with empty tail yields nothing", () => {
  const framer = createLineFramer();
  assert.deepEqual(lines(framer.feed("done\n")), ["done"]);
  assert.deepEqual(lines(framer.end()), []);
});

test("a line at exactly MAX_LINE_BYTES is NOT oversize (boundary is 'exceeding')", () => {
  const framer = createLineFramer();
  const exact = "a".repeat(MAX_LINE_BYTES);
  assert.deepEqual(lines(framer.feed(`${exact}\n`)), [exact]);
});

test("multibyte UTF-8 split across chunk boundaries reassembles correctly", () => {
  const framer = createLineFramer();
  const bytes = Buffer.from('{"t":"héllo wörld"}\n', "utf8");
  const mid = 10; // inside the é sequence
  assert.deepEqual(lines(framer.feed(bytes.subarray(0, mid))), []);
  assert.deepEqual(lines(framer.feed(bytes.subarray(mid))), ['{"t":"héllo wörld"}']);
});
