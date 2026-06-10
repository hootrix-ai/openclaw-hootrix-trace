#!/usr/bin/env node
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

try {
  require.resolve("hootrix");
} catch {
  console.error(
    [
      "",
      "[openclaw-hootrix-trace] Cannot resolve dependency \"hootrix\".",
      "",
      "From the monorepo root, run:",
      "  pnpm install",
      "",
      "Then build the plugin:",
      "  pnpm --filter @hootrix/openclaw-hootrix-trace run build",
      "",
      "If you use npm only inside plugins/openclaw-hootrix-trace, ensure sdks/typescript is built first:",
      "  cd sdks/typescript && npm install && npm run build",
      "  cd ../../plugins/openclaw-hootrix-trace && npm install",
      "",
    ].join("\n"),
  );
  process.exit(1);
}
