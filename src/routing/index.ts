/**
 * `src/routing` module barrel (005-owned). Public subpath export registration (`./routing`)
 * is a Wave-3 integration concern (plan.md § Structure Decision / research R3): Wave-2 tests
 * import this barrel's compiled output by relative path under `build/`, and consumers reach
 * routing results through the composed engine using only the frozen 002 routing shapes.
 */
export { resolveRouting } from "./resolve.js";
export type { RoutingConfigSlice } from "./types.js";
