import type { OpenClawPluginApi, OpenClawPluginService } from "openclaw/plugin-sdk";
import { type HootrixPluginConfig } from "./types.js";
export type HootrixRuntimeService = OpenClawPluginService & {
    registerHooks: () => void;
};
export declare function createHootrixService(api: OpenClawPluginApi, pluginConfig?: HootrixPluginConfig): HootrixRuntimeService;
