import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { type MutateConfigFileOptions } from "./configure.js";
type RegisterOpikCliParams = {
    program: any;
    readConfig: () => OpenClawConfig;
    mutateConfigFile: (options: MutateConfigFileOptions) => Promise<{
        followUp?: unknown;
    }>;
};
export declare function registerOpikCli(params: RegisterOpikCliParams): void;
export {};
