import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { type MutateConfigFileOptions } from "./configure.js";
type RegisterHootrixCliParams = {
    program: any;
    readConfig: () => OpenClawConfig;
    mutateConfigFile: (options: MutateConfigFileOptions) => Promise<{
        followUp?: unknown;
    }>;
};
export declare function registerHootrixCli(params: RegisterHootrixCliParams): void;
export {};
