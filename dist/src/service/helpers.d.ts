import type { Trace } from "hootrix";
import type { ActiveTrace, HootrixPluginConfig } from "../types.js";
export type { KnownTraceType, TraceClassification } from "./trace-classification.js";
export { KNOWN_TRACE_TYPES, classificationMetadata, resolveTraceClassification, resolveTraceKind, traceKindMetadata, } from "./trace-classification.js";
/** Map OpenClaw usage fields to Hootrix's expected token field names. */
export declare function mapUsageToHootrixTokens(usage: Record<string, unknown> | undefined): Record<string, number> | undefined;
export declare function mergeDefinedConfig(base: HootrixPluginConfig, override: HootrixPluginConfig): HootrixPluginConfig;
export declare function asNonEmptyString(value: unknown): string | undefined;
/** Feishu / OpenClaw peer or chat instance ids — not provider display names. */
export declare function isChannelInstanceId(id: string): boolean;
/** Provider slug from `agent:<agentId>:<provider>:…` thread keys. */
export declare function inferChannelProviderFromThreadKey(threadKey: string): string | undefined;
/** Hook context channel / peer instance id (e.g. ou_…, oc_…, or provider slug when no peer id). */
export declare function resolveChannelId(ctx: Record<string, unknown> | undefined): string | undefined;
/** Human-facing channel label for collector `channel_name` (provider slug or explicit name). */
export declare function resolveChannelName(ctx: Record<string, unknown> | undefined, sessionKey?: string): string | undefined;
/** Writes channel resolution details to /tmp/hootrix-debug.ndjson for troubleshooting. */
export declare function logChannelResolve(node: string, sessionKey: string | undefined, ctx: Record<string, unknown> | undefined, resolved: {
    channelId?: string;
    channelName?: string;
    metadata?: Record<string, string>;
}): void;
export declare function channelMetadataFields(parts: {
    channelId?: string;
    channelName?: string;
}): Record<string, string>;
export declare function resolveTrigger(ctx: Record<string, unknown>): string | undefined;
/** Best-effort agent id for trace metadata (hooks sometimes omit top-level agentId). */
export declare function resolveAgentId(ctx: Record<string, unknown>): string | undefined;
/** Normalize `agent/…` slash form to `agent:…` (OpenClaw uses colon form for thread_id). */
export declare function normalizeAgentThreadKey(key: string): string;
/**
 * Infer stable `agent:…` thread key from hook ctx. OpenClaw often puts it in `keys` / `aliasKeys` /
 * `pendingAliasKeys` or `primarySessionKey`, while top-level `sessionKey` may be a short id or missing.
 */
export declare function inferCanonicalThreadKey(ctx: Record<string, unknown>): string | undefined;
export declare function resetHootrixThreadSessionAliases(): void;
/**
 * Prefer canonical `agent:…` thread id; remember volatile run session UUID → canonical for hooks that
 * only carry `sessionId`.
 */
export declare function resolveEffectiveHootrixSessionKey(ctx: Record<string, unknown>, eventSessionId?: string): string | undefined;
/** `agent:<agentId>:subagent:<uuid>` child session threads. */
export declare function isSubagentThreadKey(sessionKey: string): boolean;
export declare function resolveTraceId(trace: Trace): string | undefined;
export declare function resolveMainSessionKey(ctx: Record<string, unknown>): string | undefined;
export declare function asNonNegativeNumber(value: unknown): number | undefined;
export declare function normalizeProvider(value: unknown): string | undefined;
export declare function hasUsageFields(usage: ActiveTrace["usage"]): boolean;
export declare function hasCostUsageFields(costMeta: ActiveTrace["costMeta"]): boolean;
export declare function resolveToolCallId(event: Record<string, unknown>, ctx: Record<string, unknown>): string | undefined;
export declare function resolveRunId(event: Record<string, unknown>, ctx: Record<string, unknown>): string | undefined;
export declare function formatError(err: unknown): string;
/** Extract LLM API endpoint host from hook event when OpenClaw exposes baseUrl. */
export declare function resolveLlmEndpointMeta(event: Record<string, unknown>): {
    llm_endpoint?: string;
    llm_endpoint_host?: string;
};
export declare function sleep(ms: number): Promise<void>;
