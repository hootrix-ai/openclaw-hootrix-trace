export type OpenClawPluginApi = {
  pluginConfig?: unknown;
  logger?: {
    info: (message: string) => void;
    warn: (message: string) => void;
  };
  registerService: (service: unknown) => void;
  registerCli: (register: (params: { program: unknown }) => void, options?: { commands?: string[] }) => void;
  runtime: {
    config: {
      current: () => Record<string, unknown>;
      mutateConfigFile: (options: unknown) => Promise<unknown>;
    };
  };
  on: (event: string, handler: (event: unknown, ctx: unknown) => void) => void;
};

export function definePluginEntry<T extends { register: (api: OpenClawPluginApi) => void }>(plugin: T): T {
  return plugin;
}
