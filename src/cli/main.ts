#!/usr/bin/env node
/**
 * T016 — thin bin shim (contracts/command-surface.md §3): the ONLY place that reads
 * `process.argv` or sets `process.exitCode`. Never `process.exit()` mid-stream, so
 * buffered stdout always flushes.
 */
import process from "node:process";
import { createProductionContext, runCli } from "./index.js";

const outcome = await runCli(process.argv.slice(2), createProductionContext());
process.exitCode = outcome.exitCode;
