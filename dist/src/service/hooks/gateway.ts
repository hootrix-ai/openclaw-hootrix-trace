import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { Opik } from "hootrix";
import type { ActiveTrace } from "../../types.js";
import { traceDbg } from "../../trace-logger.js";

type GatewayHooksDeps = {
  api: OpenClawPluginApi;
  getClient: () => Opik | null;
  activeTraces: Map<string, ActiveTrace>;
  getProjectName: () => string;
  getTags: () => string[];
  warn: (message: string) => void;
  formatError: (err: unknown) => string;
};

export function registerGatewayHooks(deps: GatewayHooksDeps): void {
  // Gateway start hook - triggered when gateway starts
  deps.api.on("gateway_start", (event, ctx) => {
    traceDbg("gateway_start", { node: "gateway_start_hook" });
  });

  // Gateway stop hook - triggered when gateway stops
  deps.api.on("gateway_stop", (event, ctx) => {
    traceDbg("gateway_stop", { node: "gateway_stop_hook" });
  });
}
