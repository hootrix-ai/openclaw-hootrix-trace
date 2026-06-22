import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { Opik as HootrixClient, Span, Trace } from "hootrix";
import type { ActiveTrace } from "../../types.js";
type SubagentHooksDeps = {
    api: OpenClawPluginApi;
    getClient: () => HootrixClient | null;
    activeTraces: Map<string, ActiveTrace>;
    rememberSessionCorrelation: (sessionKey: string, agentId?: unknown) => void;
    resolveSubagentSpanContainer: (params: {
        requesterSessionKey?: string;
        childSessionKey?: string;
        targetSessionKey?: string;
    }) => {
        sessionKey: string;
        active: ActiveTrace;
        parent: Trace | Span;
    } | undefined;
    getSubagentSpanHost: (sessionKey: string) => {
        hostSessionKey: string;
        active: ActiveTrace;
        span: Span;
    } | undefined;
    rememberSubagentSpanHost: (sessionKey: string, hostSessionKey: string, active: ActiveTrace, span: Span) => void;
    forgetSubagentSpanHost: (sessionKey: string) => void;
    forgetSubagentSpanHostsByActiveIfClosed: (active: ActiveTrace) => void;
    rememberSubagentLineage: (childSessionKey: string, lineage: {
        parentTurnId: string;
        anchorParentThreadId: string;
    }) => void;
    forgetSubagentLineage: (childSessionKey: string) => void;
    safeSpanUpdate: (span: Span, payload: Record<string, unknown>, reason: string) => void;
    safeSpanEnd: (span: Span, reason: string) => void;
    safeTraceUpdate: (trace: Trace, payload: Record<string, unknown>, reason: string) => void;
    warn: (message: string) => void;
    formatError: (err: unknown) => string;
};
export declare function registerSubagentHooks(deps: SubagentHooksDeps): void;
export {};
