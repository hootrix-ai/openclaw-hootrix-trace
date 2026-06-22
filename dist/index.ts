import {
  definePluginEntry,
  type OpenClawPluginApi,
} from "openclaw/plugin-sdk/plugin-entry";
import { registerHootrixCli } from "./src/cli.js";
import { createHootrixService, type HootrixRuntimeService } from "./src/service.js";
import { parseHootrixPluginConfig } from "./src/types.js";
import { HOOTRIX_PLUGIN_ID } from "./src/constants.js";
import { createTraceLogger, traceDbg, type TraceLoggerConfig } from "./src/trace-logger.js";

export default definePluginEntry({
  id: HOOTRIX_PLUGIN_ID,
  name: "Hootrix",
  description: "Export LLM traces and spans to hootrix for observability",
  register(api: OpenClawPluginApi) {
    const pluginConfig = parseHootrixPluginConfig(api.pluginConfig);
    // initialize log - use api.logger to ensure logs are output correctly by openclaw
    createTraceLogger({
      debug: pluginConfig.debug ?? false,
      logger: api.logger,
    });
    const service = createHootrixService(api, pluginConfig) as HootrixRuntimeService;
    service.registerHooks();
    api.registerService(service);
    api.registerCli(
      ({ program }) =>
        registerHootrixCli({
          program,
          readConfig: () => api.runtime.config.current(),
          mutateConfigFile: (options) => api.runtime.config.mutateConfigFile(options),
        }),
      { commands: ["hootrix"] },
    );
    traceDbg("plugin_lifecycle", { node: "register_complete" });
  },
});

export { traceDbg } from "./src/trace-logger.js";
