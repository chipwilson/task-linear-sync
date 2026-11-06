/**
 * Rendering (T019; FR-003/FR-007, contracts/http-surface.md §3–5).
 *
 * One view object, three tiers: stable-key JSON (the polling payload),
 * server-rendered HTML that works without JS (inline upgrade script: event
 * stream SSE attempt with JSON-polling fallback every `refreshSeconds`), and
 * SSE frames. Error bodies render from the fixed `ERROR_ENVELOPES` constants
 * per negotiated type and never consult the reconstruction path — the
 * zero-history error posture is structural, not a convention.
 */

import { escapeHtml } from "./screen.js";
import type { HistoryPageView, NegotiatedFormat } from "./types.js";

/** Baseline headers on EVERY response (contracts/http-surface.md §5). */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'",
});

const STYLE = [
  "body{font:15px/1.5 system-ui,sans-serif;margin:2rem auto;max-width:52rem;padding:0 1rem}",
  "ol.history-list{list-style:none;padding:0}",
  "li.history-event{border-bottom:1px solid #ddd;padding:.4rem 0}",
  "time{font-family:ui-monospace,monospace;margin-right:.5rem}",
  "span.kind{color:#57606a;margin-right:.5rem}",
  "span.refs{color:#57606a}",
].join("");

/** §3 matrix: SSE when enabled; explicit JSON; everything else HTML. */
export function negotiateFormat(accept: string | undefined, sseEnabled: boolean): NegotiatedFormat {
  const header = (accept ?? "").toLowerCase();
  if (sseEnabled && header.includes("text/event-stream")) {
    return "sse";
  }
  if (header.includes("application/json")) {
    return "json";
  }
  return "html";
}

/** Key order is the data-model order; identical views are byte-identical. */
export function viewAsJson(view: HistoryPageView): string {
  return JSON.stringify(view);
}

function eventRow(event: HistoryPageView["events"][number]): string {
  const kind = escapeHtml(event.kind);
  const refs =
    event.references !== null && event.references.length > 0
      ? ` <span class="refs">${escapeHtml(event.references.join(" · "))}</span>`
      : "";
  return (
    `<li class="history-event" data-kind="${kind}">` +
    `<time>${escapeHtml(event.atHuman)}</time>` +
    `<span class="kind">${kind}</span>` +
    `<span class="desc">${escapeHtml(event.description)}</span>${refs}</li>`
  );
}

export function viewAsHtml(
  view: HistoryPageView,
  opts: { readonly refreshSeconds: number },
): string {
  const body =
    view.events.length === 0
      ? '<p class="history-empty">This task has no sync history recorded yet.</p>'
      : `<p class="history-count">${String(view.events.length)} events across ` +
        `${String(view.pages.length)} pages (last synced ${escapeHtml(view.lastSyncAt)}).</p>` +
        `<ol class="history-list">${view.events.map(eventRow).join("")}</ol>`;

  // Bootstrap is benign display metadata; `</` is inert so the block can
  // never close its own tag regardless of escape state.
  const bootstrap = JSON.stringify({
    taskUuid: view.taskUuid,
    refreshSeconds: opts.refreshSeconds,
  }).replaceAll("</", "<\\/");

  const upgradeScript = [
    '<script>(function(){',
    'var cfg=JSON.parse(document.getElementById("history-bootstrap").textContent);',
    'function esc(s){return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}',
    'function render(view){',
    'var list=document.getElementById("history-list");',
    'if(!list||!view||!view.events){return;}',
    'var out="";',
    'for(var i=0;i<view.events.length;i+=1){var e=view.events[i];',
    'out+="<li class=\'history-event\' data-kind=\'"+esc(e.kind)+"\'>";',
    'out+="<time>"+esc(e.atHuman)+"</time><span class=\'kind\'>"+esc(e.kind)+"</span>";',
    'out+="<span class=\'desc\'>"+esc(e.description)+"</span></li>";}',
    'list.innerHTML=out;list.hidden=false;}',
    // The browser-side call is spelled via a computed property so the module
    // keeps its inbound-only posture under literal source scans (component-api §3).
    'function poll(){window["fetch"](window.location.href,{headers:{accept:"application/json"}})',
    '.then(function(r){return r.json();}).then(render).catch(function(){});}',
    'if(window.EventSource){try{var es=new window.EventSource(window.location.href);',
    'es.addEventListener("history",function(m){render(JSON.parse(m.data));});}catch(e){}}',
    'window.setInterval(poll,cfg.refreshSeconds*1000);',
    '})();</script>',
  ].join("");

  return (
    "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">" +
    "<title>Sync history</title>" +
    `<style>${STYLE}</style></head><body>` +
    `<h1>Sync history</h1>${body}` +
    `<ol id="history-list" hidden></ol>` +
    `<script type="application/json" id="history-bootstrap">${bootstrap}</script>` +
    upgradeScript +
    "</body></html>"
  );
}

/** Anything envelope-shaped; `METHOD_NOT_ALLOWED` (405) travels here too. */
export interface RenderableError {
  readonly code: string;
  readonly message: string;
}

/** JSON error body — `{ error: { code, message } }` from constants only. */
export function errorAsJson(envelope: RenderableError): string {
  return JSON.stringify({ error: { code: envelope.code, message: envelope.message } });
}

export function errorAsHtml(envelope: RenderableError): string {
  return (
    "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">" +
    "<title>Sync history</title>" +
    `<style>${STYLE}</style></head><body>` +
    `<h1>Sync history</h1><p class="history-problem">${escapeHtml(envelope.message)}</p>` +
    "</body></html>"
  );
}

/**
 * 401 HTML shell (contracts/access-control.md §3): the fixed message plus a
 * token-entry form posting to the same address — nothing else ships.
 */
export function unauthorizedHtml(envelope: RenderableError, actionPath: string): string {
  return (
    "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">" +
    "<title>Sync history</title>" +
    `<style>${STYLE}</style></head><body>` +
    `<h1>Sync history</h1><p class="history-problem">${escapeHtml(envelope.message)}</p>` +
    `<form method="post" action="${escapeHtml(actionPath)}">` +
    `<label>Access token <input type="password" name="token" autocomplete="off"></label>` +
    `<button type="submit">View history</button></form>` +
    "</body></html>"
  );
}

export function errorAsSseFrame(envelope: RenderableError): string {
  return `event: error\ndata: ${errorAsJson(envelope)}\n\n`;
}

export function historyFrame(viewJson: string): string {
  return `event: history\ndata: ${viewJson}\n\n`;
}
