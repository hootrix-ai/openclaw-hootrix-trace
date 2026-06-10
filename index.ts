import {
  definePluginEntry,type OpenClawPluginApi,
} from "openclaw/plugin-sdk/plugin-entry";
import { registerOpikCli } from "./src/cli.js";
import { createOpikService, type OpikRuntimeService } from "./src/service.js";
import { parseOpikPluginConfig } from "./src/types.js";
import { createTraceLogger, traceDbg, type TraceLoggerConfig } from "./src/trace-logger.js";

export default definePluginEntry({
  id: "openclaw-hootrix-trace",
  name: "Hootrix",
  description: "Export LLM traces and spans to Hootrix for observability",
  register(api: OpenClawPluginApi) {
    const pluginConfig = parseOpikPluginConfig(api.pluginConfig);
    createTraceLogger({
      debug: pluginConfig.debug ?? false,
      logger: api.logger,
    });
    const service = createOpikService(api, pluginConfig) as OpikRuntimeService;
    service.registerHooks();
    api.registerService(service);
    api.registerCli(
      ({ program }) =>
        registerOpikCli({
          program,
          readConfig: () => api.runtime.config.current(),
          mutateConfigFile: (options) => api.runtime.config.mutateConfigFile(options),
        }),
      { commands: ["hootrix"] },
    );
  },
});
export { traceDbg } from "./src/trace-logger.js";
