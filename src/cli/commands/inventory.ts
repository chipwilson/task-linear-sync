/**
 * T021 — `inventory` (research R7): read-only composition of 003 `discoverTaskFiles` +
 * the adapter registry + 004 `parseTaskFile` over the lane-guarded deps (allowed write
 * prefixes `[]` — enforced centrally by `runCli`). Deterministic ordering: discovery is
 * byte-wise sorted on repository-relative POSIX paths. Zero tracker calls, zero writes.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { FrameworkAdapter } from "../../discovery/index.js";
import { createAdapterRegistry, discoverTaskFiles } from "../../discovery/index.js";
import type { TaskFileAdapter } from "../../parsing/index.js";
import { parseTaskFile } from "../../parsing/index.js";
import type { CommandHandler } from "../index.js";

export const inventoryHandler: CommandHandler = async (run) => {
  const discovery = await discoverTaskFiles({
    repositoryRoot: run.repositoryRoot,
    config: run.config,
    // Inventory is a pure file listing — no git context needed (and no git side reads).
    gitContext: false,
  });
  const registry = createAdapterRegistry(run.config);
  const adapterById = new Map<string, FrameworkAdapter>(registry.enabledAdapters.map((a) => [a.id, a]));

  for (const file of discovery.files) {
    const adapter = adapterById.get(file.adapterId);
    if (adapter === undefined) {
      run.err.write(`skipped ${file.filePath}: discovery selected adapter '${file.adapterId} the registry does not carry`);
      continue;
    }
    const content = readFileSync(join(discovery.root, file.filePath), "utf8");
    const parsed = parseTaskFile(file.filePath, content, adapter as unknown as TaskFileAdapter, run.config);
    run.out.write(`${file.filePath}  framework=${file.adapterId}  tasks=${parsed.file.tasks.length}`);
  }
  for (const refusal of discovery.refusals) {
    run.err.write(`refused ${refusal.path}: ${refusal.reason}`);
  }
  for (const diagnostic of discovery.diagnostics) {
    run.err.write(`warning ${diagnostic.path}: ${diagnostic.condition}`);
  }
  return 0;
};
