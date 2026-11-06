/**
 * 013-ci-enforcement-layer CLI-invoker seam (T032; research R3,
 * wrapper-api.md §2). Stub surface — spawn wiring lands with T032.
 *
 * The ONLY module in `src/ci/` allowed to import `node:child_process`
 * (hygiene invariant 3). Command set is CLOSED (`check` | `plan`): the argv
 * builder has no mutate/apply mode by construction (SC-002).
 */

export interface CliRequest {
  readonly command: "check" | "plan";
  readonly workspace: string;
  readonly configFile?: string;
  readonly cliEntry?: string | null;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

export interface CliResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export type CliInvoker = (request: CliRequest) => Promise<CliResult>;

/**
 * Build the spawn invoker (R3): entry resolution order explicit -> action-root
 * `dist/cli/main.js` -> workspace `dist/cli/main.js` -> workspace
 * `node_modules/task-linear-sync/dist/cli/main.js` (miss ⇒ `CiCliFailureError`
 * naming every candidate); argv `[entry, command, workspace, "--config"?]`,
 * NO shell; exits 0/8 proceed, anything else ⇒ `CiCliFailureError`.
 */
export function createSpawnCliInvoker(): CliInvoker {
  throw new Error("T032: not implemented");
}
