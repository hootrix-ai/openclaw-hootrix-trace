import type { OpenClawConfig } from "openclaw/plugin-sdk";

import { runHootrixConfigure, showHootrixStatus, type ConfigDeps, type MutateConfigFileOptions } from "./configure.js";

type RegisterHootrixCliParams = {
  program: any;
  readConfig: () => OpenClawConfig;
  mutateConfigFile: (options: MutateConfigFileOptions) => Promise<{ followUp?: unknown }>;
};

export function registerHootrixCli(params: RegisterHootrixCliParams): void {
  const { program, readConfig, mutateConfigFile } = params;
  const deps: ConfigDeps = { readConfig, mutateConfigFile };

  const root = program.command("hootrix").description("hootrix trace export integration");

  root
    .command("configure")
    .description("Interactive setup for hootrix trace export")
    .action(async () => {
      await runHootrixConfigure(deps);
    });

  root
    .command("status")
    .description("Show current hootrix configuration")
    .action(async () => {
      showHootrixStatus(deps);
    });
}
