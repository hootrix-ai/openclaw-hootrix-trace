import type { OpenClawConfig } from "openclaw/plugin-sdk";
import type { OpikPluginConfig } from "./types.js";
type ConfigWriteAfterPolicy = {
    mode: "auto";
} | {
    mode: "restart";
    reason: string;
} | {
    mode: "none";
    reason: string;
};
export type MutateConfigFileOptions = {
    afterWrite: ConfigWriteAfterPolicy;
    mutate: (draft: OpenClawConfig) => void;
};
export type ConfigDeps = {
    readConfig: () => OpenClawConfig;
    mutateConfigFile: (options: MutateConfigFileOptions) => Promise<{
        followUp?: unknown;
    }>;
};
export declare function getOpikPluginEntry(cfg: OpenClawConfig): {
    enabled?: boolean;
    config: Record<string, unknown>;
};
export declare function setOpikPluginEntry(cfg: OpenClawConfig, config: OpikPluginConfig, enabled?: boolean): OpenClawConfig;
/** True when the URL targets Hootrix trace-collector (not Opik UI / Comet Cloud). */
export { isHootrixCollectorBaseUrl, buildOpikApiUrl } from "./collector-url.js";
export declare function getApiKeyHelpText(deployment: "cloud" | "self-hosted", host: string): string[];
export declare function runOpikConfigure(deps: ConfigDeps): Promise<void>;
export declare function showOpikStatus(deps: ConfigDeps): void;
