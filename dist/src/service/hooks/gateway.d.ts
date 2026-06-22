import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { Opik as HootrixClient } from "hootrix";
import type { ActiveTrace } from "../../types.js";
type GatewayHooksDeps = {
    api: OpenClawPluginApi;
    getClient: () => HootrixClient | null;
    activeTraces: Map<string, ActiveTrace>;
    getProjectName: () => string;
    getTags: () => string[];
    warn: (message: string) => void;
    formatError: (err: unknown) => string;
};
export declare function registerGatewayHooks(deps: GatewayHooksDeps): void;
export {};
