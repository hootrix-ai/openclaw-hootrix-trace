import { runHootrixConfigure, showHootrixStatus } from "./configure.js";
export function registerHootrixCli(params) {
    const { program, readConfig, mutateConfigFile } = params;
    const deps = { readConfig, mutateConfigFile };
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
