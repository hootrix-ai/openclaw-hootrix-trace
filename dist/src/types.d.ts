import type { Span, Trace } from "hootrix";
export type HootrixPluginConfig = {
    enabled?: boolean;
    debug?: boolean;
    apiKey?: string;
    apiUrl?: string;
    projectName?: string;
    workspaceName?: string;
    tags?: string[];
    toolResultPersistSanitizeEnabled?: boolean;
    staleTraceTimeoutMs?: number;
    staleSweepIntervalMs?: number;
    staleTraceCleanupEnabled?: boolean;
    flushRetryCount?: number;
    flushRetryBaseDelayMs?: number;
    /** Policy sync interval in milliseconds (default: 120000) */
    policySyncIntervalMs?: number;
};
/**
 * Gateways may pass either the plugin `config` object or the full OpenClaw document.
 * Unwrap `plugins.entries["openclaw-hootrix-trace"].config` when needed.
 */
export declare function coercePluginConfigRoot(raw: unknown): Record<string, unknown>;
export declare function parseHootrixPluginConfig(raw: unknown): HootrixPluginConfig;
/** Active trace state for a single agent run, keyed by sessionKey. */
export type ActiveTrace = {
    trace: Trace;
    /** Resolved Opik trace id for lineage (from trace.data.id). */
    traceId?: string;
    llmSpan: Span | null;
    /** Wall-clock ms when the current llmSpan was opened (for direct collector completion patches). */
    llmSpanStartedAt?: number;
    toolSpans: Map<string, Span>;
    subagentSpans: Map<string, Span>;
    startedAt: number;
    lastActivityAt: number;
    /** Cost metadata accumulated from model.usage diagnostic events. */
    costMeta: {
        costUsd?: number;
        contextLimit?: number;
        contextUsed?: number;
        model?: string;
        provider?: string;
        durationMs?: number;
        usageInput?: number;
        usageOutput?: number;
        usageCacheRead?: number;
        usageCacheWrite?: number;
        usageTotal?: number;
    };
    /** Accumulated usage from llm_output events. */
    usage: {
        input?: number;
        output?: number;
        cacheRead?: number;
        cacheWrite?: number;
        total?: number;
    };
    /** Last known model name from hooks or diagnostics. */
    model?: string;
    /** Last known provider from hooks or diagnostics. */
    provider?: string;
    /** Last known channel / peer instance id from hook context (e.g. ou_…, oc_…). */
    channelId?: string;
    /** Display channel name / provider slug for collector (e.g. feishu, discord). */
    channelName?: string;
    /** Last known agent id from hook context (for collector thread agent_name). */
    agentId?: string;
    /** Last known trigger from hook context. */
    trigger?: string;
    /** Sanitized LLM input from the latest llm_input (re-sent on output/finalize to survive SDK/collector races). */
    lastLlmInput?: Record<string, unknown>;
    /** Output accumulated from llm_output. */
    output?: {
        output: string;
        lastAssistant?: unknown;
    };
    /** Data stored by agent_end for deferred finalization. */
    agentEnd?: {
        success: boolean;
        error?: string;
        durationMs?: number;
        messages: unknown[];
    };
    /** LLM error info from llm_output, used to propagate error state to trace level. */
    llmError?: {
        message: string;
        details?: string;
        stopReason?: string;
        model?: string;
        provider?: string;
    };
};
