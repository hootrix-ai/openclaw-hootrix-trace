import type { OpenClawConfig } from "openclaw/plugin-sdk/config-contracts";
import type { HootrixPluginConfig } from "./types.js";
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
export declare function getHootrixPluginEntry(cfg: OpenClawConfig): {
    enabled?: boolean;
    config: Record<string, unknown>;
};
export declare function setHootrixPluginEntry(cfg: OpenClawConfig, config: HootrixPluginConfig, enabled?: boolean): OpenClawConfig;
/** True when the URL targets Hootrix trace-collector (not Hootrix UI / Comet Cloud). */
export { isHootrixCollectorBaseUrl, buildHootrixApiUrl } from "./collector-url.js";
export declare function getApiKeyHelpText(deployment: "cloud" | "self-hosted", host: string): string[];
/**
 * Validate a Hootrix API key against the trace-collector ingest API.
 * Uses an empty traces batch so auth is checked without writing trace data.
 */
export declare function validateHootrixApiKey(apiKey: string, collectorBaseUrl?: string): Promise<void>;
export declare function runHootrixConfigure(deps: ConfigDeps): Promise<void>;
export declare function showHootrixStatus(deps: ConfigDeps): void;
