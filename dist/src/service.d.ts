import type { OpenClawPluginApi, OpenClawPluginService } from "openclaw/plugin-sdk";
import { type OpikPluginConfig } from "./types.js";
export type OpikRuntimeService = OpenClawPluginService & {
    registerHooks: () => void;
};
export declare function createOpikService(api: OpenClawPluginApi, pluginConfig?: OpikPluginConfig): OpikRuntimeService;
