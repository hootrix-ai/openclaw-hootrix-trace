declare module "openclaw/plugin-sdk" {
  export type OpenClawConfig = Record<string, unknown>;

  export type ConfigWriteAfterPolicy =
    | { mode: "auto" }
    | { mode: "restart"; reason: string }
    | { mode: "none"; reason: string };

  export type MutateConfigFileOptions = {
    afterWrite: ConfigWriteAfterPolicy;
    mutate: (draft: OpenClawConfig) => void;
  };

  export type ConfigMutationResult = {
    followUp?: {
      mode?: string;
      requiresRestart?: boolean;
      reason?: string;
    };
  };

  export type OpenClawConfigRuntime = {
    /** Current process config snapshot (readonly). */
    current: () => OpenClawConfig;
    mutateConfigFile: (options: MutateConfigFileOptions) => Promise<ConfigMutationResult>;
    replaceConfigFile: (
      cfg: OpenClawConfig,
      options: { afterWrite: ConfigWriteAfterPolicy },
    ) => Promise<ConfigMutationResult>;
    /** @deprecated Use `current()` instead. */
    loadConfig?: () => OpenClawConfig;
    /** @deprecated Use `mutateConfigFile()` or `replaceConfigFile()` instead. */
    writeConfigFile?: (cfg: OpenClawConfig) => Promise<void>;
  };

  export type DiagnosticEventPayload = {
    type: string;
    sessionKey?: string;
    costUsd?: number;
    context?: {
      limit?: number;
      used?: number;
    };
    model?: string;
    provider?: string;
    durationMs?: number;
    usage?: {
      input?: number;
      output?: number;
      cacheRead?: number;
      cacheWrite?: number;
      total?: number;
    };
  };

  export type OpenClawPluginService = {
    id: string;
    start: (ctx: {
      config: unknown;
      logger: {
        info: (message: string) => void;
        warn: (message: string) => void;
      };
    }) => void | Promise<void>;
    stop?: (ctx?: unknown) => void | Promise<void>;
  };

  export type OpenClawPluginApi = {
    pluginConfig?: unknown;
    logger?: {
      info: (message: string) => void;
      warn: (message: string) => void;
    };
    registerService: (service: OpenClawPluginService) => void;
    registerCli: (
      register: (params: { program: any }) => void,
      options?: { commands?: string[] },
    ) => void;
    runtime: {
      config: OpenClawConfigRuntime;
    };
    on: (event: string, handler: (event: any, ctx: any) => void) => void;
  };

  export function definePluginEntry(plugin: {
    id: string;
    name: string;
    description?: string;
    register: (api: OpenClawPluginApi) => void;
  }): unknown;

  export function onDiagnosticEvent(
    handler: (event: DiagnosticEventPayload) => void,
  ): () => void;

  export function emptyPluginConfigSchema(): unknown;
}

declare module "openclaw/plugin-sdk/plugin-entry" {
  export type OpenClawConfig = Record<string, unknown>;

  export type OpenClawPluginApi = {
    pluginConfig?: unknown;
    logger?: {
      info: (message: string) => void;
      warn: (message: string) => void;
    };
    registerService: (service: {
      id: string;
      start: (ctx: {
        config: unknown;
        logger: {
          info: (message: string) => void;
          warn: (message: string) => void;
        };
      }) => void | Promise<void>;
      stop?: (ctx?: unknown) => void | Promise<void>;
    }) => void;
    registerCli: (
      register: (params: { program: any }) => void,
      options?: { commands?: string[] },
    ) => void;
    runtime: {
      config: OpenClawConfigRuntime;
    };
    on: (event: string, handler: (event: any, ctx: any) => void) => void;
  };

  export function definePluginEntry(plugin: {
    id: string;
    name: string;
    description?: string;
    register: (api: OpenClawPluginApi) => void;
  }): unknown;
}
