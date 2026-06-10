#!/usr/bin/env node
/**
 * OpenClaw resolves plugins.load.paths to dist/index.js (compiled output).
 * This shim re-exports repo-root TypeScript so Gateway restart loads latest src/
 * without running `pnpm build` after every edit.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEV_ENTRY_SHIM_MARKER = "@openclaw-dev-loader";

const SHIM_CONTENT = `// ${DEV_ENTRY_SHIM_MARKER} — re-exports repo-root TypeScript; edit src/ and restart Gateway (no rebuild).
export { default } from "../index.ts";
`;

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(rootDir, "dist");
const entryPath = path.join(distDir, "index.js");

export function writeDevEntryShim() {
  mkdirSync(distDir, { recursive: true });
  writeFileSync(entryPath, `${SHIM_CONTENT}\n`, "utf8");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  writeDevEntryShim();
  console.log(`Wrote dev entry shim: ${entryPath}`);
}
