import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "openclaw/plugin-sdk/plugin-entry": path.resolve(
        __dirname,
        "test/stubs/plugin-entry.ts",
      ),
      "openclaw/plugin-sdk/diagnostic-runtime": path.resolve(
        __dirname,
        "test/stubs/diagnostic-runtime.ts",
      ),
      "openclaw/plugin-sdk/config-contracts": path.resolve(
        __dirname,
        "test/stubs/config-contracts.ts",
      ),
    },
  },
});
