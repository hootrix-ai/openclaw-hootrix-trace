#!/usr/bin/env node
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, cpSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeDevEntryShim } from "./ensure-dist-shim.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");

// Clean and create dist directory
if (existsSync(distDir)) {
  execSync("rm -rf dist", { cwd: rootDir, stdio: "inherit" });
}
mkdirSync(distDir, { recursive: true });

// Run TypeScript compiler
console.log("Building TypeScript...");
execSync("npx tsc -p tsconfig.build.json", { cwd: rootDir, stdio: "inherit" });

// Copy source files for openclaw runtime loading
console.log("Copying source files...");
const filesToCopy = [
  "index.ts",
  "src/cli.ts",
  "src/configure.ts",
  "src/device-auth.ts",
  "src/service.ts",
  "src/service/constants.ts",
  "src/service/helpers.ts",
  "src/service/payload-sanitizer.ts",
  "src/service/media.ts",
  "src/service/attachment-uploader.ts",
  "src/service/trace-ndjson-log.ts",
  "src/service/hooks/gateway.ts",
  "src/service/hooks/llm.ts",
  "src/service/hooks/tool.ts",
  "src/service/hooks/subagent.ts",
  "src/trace-logger.ts",
  "src/types.ts",
];

for (const file of filesToCopy) {
  const srcPath = path.join(rootDir, file);
  const destPath = path.join(distDir, file);
  if (existsSync(srcPath)) {
    const destDir = path.dirname(destPath);
    if (!existsSync(destDir)) {
      mkdirSync(destDir, { recursive: true });
    }
    cpSync(srcPath, destPath);
  }
}

// Ambient types for openclaw peer dependency (dist .ts files are outside root tsconfig include)
const openclawSdkTypes = "src/openclaw-plugin-sdk.d.ts";
cpSync(path.join(rootDir, openclawSdkTypes), path.join(distDir, openclawSdkTypes));

writeFileSync(
  path.join(distDir, "tsconfig.json"),
  JSON.stringify(
    {
      extends: "../tsconfig.json",
      include: ["./**/*.ts", "./src/openclaw-plugin-sdk.d.ts"],
    },
    null,
    2,
  ) + "\n",
);

// OpenClaw load.paths prefers dist/index.js — shim forwards to repo-root TypeScript for dev reload.
writeDevEntryShim();
console.log("Wrote dist/index.js dev entry shim (loads ../index.ts on Gateway restart)");

console.log("Build complete!");
