/**
 * The optional `listen()` convenience (T010; data-model §8): a plain
 * `node:http` server in front of `app.handle`. Hosts that provide their own
 * HTTP front (serverless, proxy-terminated) never call this — the handler is
 * the deployable unit (SC-004).
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export interface ListenTarget {
  handle(req: IncomingMessage, res: ServerResponse): void;
}

export async function listenHistoryApp(
  app: ListenTarget,
  port: number,
  host: string,
): Promise<{ readonly port: number; close(): Promise<void> }> {
  const server = createServer((req, res) => app.handle(req, res));
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve());
  });
  const bound = server.address() as AddressInfo;
  return {
    port: bound.port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
