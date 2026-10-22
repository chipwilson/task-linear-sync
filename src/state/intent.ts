/**
 * Create-intent store (research R10, FR-004). The hard rule: writeCreateIntentBeforeAttempt
 * persists `status: "pending"` durably (atomic write) and resolves ONLY after the rename
 * completes — the caller may not attempt the create before that (crash-window guarantee).
 * Records are keyed by intentId and indexed by taskUuid for 008's reconciliation queries.
 */
import { readdirSync } from "node:fs";

import type { CreateIntent, CreateIntentStatus } from "../domain/run-records.js";
import type { StateStore } from "./paths.js";

export type { CreateIntent, CreateIntentStatus } from "../domain/run-records.js";

const intentRel = (intentId: string): string => `intents/${intentId}.json`;

/** Persist `status: "pending"` BEFORE the attempt; resolves only after the atomic rename. */
export async function writeCreateIntentBeforeAttempt(
  store: StateStore,
  i: Omit<CreateIntent, "status" | "createdAt" | "updatedAt">,
): Promise<CreateIntent> {
  const now = store.clock.now().toISOString();
  const record: CreateIntent = { ...i, status: "pending", createdAt: now, updatedAt: now };
  await store.writeJson(intentRel(record.intentId), record); // resolves post-rename (atomicWriteJson)
  return record;
}

/** Status transitions are read-modify-atomic-write (updatedAt stamped by the injected clock). */
export async function updateCreateIntentStatus(
  store: StateStore,
  intentId: string,
  status: CreateIntentStatus,
): Promise<void> {
  const existing = await store.readJson<CreateIntent>(intentRel(intentId));
  if (existing === null) {
    throw new Error(`create intent '${intentId}' not found — cannot transition to '${status}'`);
  }
  const updated: CreateIntent = { ...existing, status, updatedAt: store.clock.now().toISOString() };
  await store.writeJson(intentRel(intentId), updated);
}

/** taskUuid index scan for 008's reconciliation (oldest first, intentId tie-break). */
export async function listIntentsByTask(store: StateStore, taskUuid: string): Promise<CreateIntent[]> {
  let names: string[];
  try {
    names = readdirSync(store.paths.intents);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
  const out: CreateIntent[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const rec = await store.readJson<CreateIntent>(`intents/${name}`);
    if (rec !== null && rec.taskUuid === taskUuid) out.push(rec);
  }
  out.sort((a, b) => (a.createdAt === b.createdAt ? a.intentId.localeCompare(b.intentId) : a.createdAt.localeCompare(b.createdAt)));
  return out;
}
