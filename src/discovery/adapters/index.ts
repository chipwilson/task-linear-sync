/**
 * Built-in adapter table (defaults layer, FR-007; contracts/framework-adapter.md built-in
 * table; T031). `builtInAdapters` is the frozen `FrameworkId → FrameworkAdapter` record 004
 * consumes (its `generic` entry is the 004 fixture adapter) and the surface snapshot gates
 * its keys against the five frozen literals. Rows are declared in fixed marker-precedence
 * display order; selection ranking lives in `../registry.ts`, never here.
 */
import type { FrameworkId } from "../../domain/task.js";
import type { FrameworkAdapter } from "../adapter.js";
import { deepFreeze } from "../conventions.js";
import { bmadAdapter, bmadConventions } from "./bmad.js";
import { genericAdapter, genericConventions } from "./generic.js";
import { kiroAdapter, kiroConventions } from "./kiro.js";
import { openSpecAdapter, openSpecConventions } from "./open-spec.js";
import { specKitAdapter, specKitConventions } from "./spec-kit.js";
import type { ResolvedConventions } from "../conventions.js";

export const builtInAdapters: Readonly<Record<FrameworkId, FrameworkAdapter>> = deepFreeze({
  kiro: kiroAdapter,
  "spec-kit": specKitAdapter,
  "open-spec": openSpecAdapter,
  bmad: bmadAdapter,
  generic: genericAdapter,
});

/** Conventions rows the registry consumes (defaults layer; per-run merge happens there). */
export const builtInAdapterRows: readonly { readonly id: FrameworkId; readonly conventions: ResolvedConventions }[] = deepFreeze([
  { id: "kiro", conventions: kiroConventions },
  { id: "spec-kit", conventions: specKitConventions },
  { id: "open-spec", conventions: openSpecConventions },
  { id: "bmad", conventions: bmadConventions },
  { id: "generic", conventions: genericConventions },
]);
