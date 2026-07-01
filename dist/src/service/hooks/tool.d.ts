import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { Opik as HootrixClient, Span, Trace } from "hootrix";
import type { ActiveTrace } from "../../types.js";
import { type CollectorExportConfig } from "../../direct-collector-export.js";
type ToolHooksDeps = {
    api: OpenClawPluginApi;
    getClient: () => HootrixClient | null;
    activeTraces: Map<string, ActiveTrace>;
    sessionByAgentId: Map<string, string>;
    getLastActiveSessionKey: () => string | undefined;
    rememberSessionCorrelation: (sessionKey: string, agentId?: unknown) => void;
    resolveSessionSpanContainer: (sessionKey: string) => {
        sessionKey: string;
        active: ActiveTrace;
        parent: Trace | Span;
    } | undefined;
    warnMissingAfterToolSessionKey: (fallbackMode: string) => void;
    nextSpanSeq: () => number;
    safeSpanUpdate: (span: Span, payload: Record<string, unknown>, reason: string) => void;
    safeSpanEnd: (span: Span, reason: string) => void;
    scheduleMediaAttachmentUploads: (params: {
        entityType: "trace" | "span";
        entity: unknown;
        projectName: string;
        reason: string;
        payloads: unknown[];
        traceId?: string;
    }) => void;
    getProjectName: () => string;
    warn: (message: string) => void;
    formatError: (err: unknown) => string;
    getCollectorExportConfig: () => CollectorExportConfig | null;
    awaitFlush: (reason: string) => Promise<void>;
};
export declare function registerToolHooks(deps: ToolHooksDeps): void;
export {};
