import { traceDbg } from "../trace-logger.js";
export { KNOWN_TRACE_TYPES, classificationMetadata, resolveTraceClassification, resolveTraceKind, traceKindMetadata, } from "./trace-classification.js";
/** Map OpenClaw usage fields to Opik's expected token field names. */
export function mapUsageToOpikTokens(usage) {
    if (!usage)
        return undefined;
    const mapped = {};
    if (usage.input != null)
        mapped.prompt_tokens = usage.input;
    if (usage.output != null)
        mapped.completion_tokens = usage.output;
    if (usage.total != null)
        mapped.total_tokens = usage.total;
    if (usage.cacheRead != null)
        mapped.cache_read_tokens = usage.cacheRead;
    if (usage.cacheWrite != null)
        mapped.cache_write_tokens = usage.cacheWrite;
    return Object.keys(mapped).length > 0 ? mapped : undefined;
}
export function mergeDefinedConfig(base, override) {
    const merged = { ...base };
    const mutable = merged;
    for (const [key, value] of Object.entries(override)) {
        if (value === undefined)
            continue;
        mutable[key] = value;
    }
    return merged;
}
export function asNonEmptyString(value) {
    return typeof value === "string" && value.length > 0 ? value : undefined;
}
/** Feishu / OpenClaw peer or chat instance ids — not provider display names. */
export function isChannelInstanceId(id) {
    const t = id.trim();
    return /^ou_/i.test(t) || /^oc_/i.test(t);
}
/** Provider slug from `agent:<agentId>:<provider>:…` thread keys. */
export function inferChannelProviderFromThreadKey(threadKey) {
    const parts = normalizeAgentThreadKey(threadKey).split(":");
    if (parts[0] !== "agent" || parts.length < 3) {
        return undefined;
    }
    const provider = parts[2]?.trim();
    if (!provider || isChannelInstanceId(provider)) {
        return undefined;
    }
    return provider;
}
/** Hook context channel / peer instance id (e.g. ou_…, oc_…, or provider slug when no peer id). */
export function resolveChannelId(ctx) {
    return asNonEmptyString(ctx?.channelId);
}
/** Human-facing channel label for collector `channel_name` (provider slug or explicit name). */
export function resolveChannelName(ctx, sessionKey) {
    const bag = ctx ?? {};
    const explicit = asNonEmptyString(bag.channelName);
    if (explicit) {
        return explicit;
    }
    const provider = asNonEmptyString(bag.messageProvider);
    if (provider && !isChannelInstanceId(provider)) {
        return provider;
    }
    const threadKey = sessionKey ?? inferCanonicalThreadKey(bag);
    if (threadKey) {
        const fromThread = inferChannelProviderFromThreadKey(threadKey);
        if (fromThread) {
            return fromThread;
        }
    }
    const channelId = asNonEmptyString(bag.channelId);
    if (channelId && !isChannelInstanceId(channelId)) {
        return channelId;
    }
    return undefined;
}
/** Writes channel resolution details to /tmp/crabagent-debug.ndjson for troubleshooting. */
export function logChannelResolve(node, sessionKey, ctx, resolved) {
    const bag = ctx ?? {};
    traceDbg("channel_resolve", {
        node,
        sessionKey,
        ctxChannelId: bag.channelId,
        ctxChannelName: bag.channelName,
        ctxMessageProvider: bag.messageProvider,
        inferredFromThread: sessionKey ? inferChannelProviderFromThreadKey(sessionKey) : undefined,
        resolvedChannelId: resolved.channelId,
        resolvedChannelName: resolved.channelName,
        metadataFields: resolved.metadata,
    });
}
export function channelMetadataFields(parts) {
    const out = {};
    const name = parts.channelName?.trim();
    const id = parts.channelId?.trim();
    if (name) {
        out.channelName = name;
    }
    if (id) {
        out.channelId = id;
        if (!isChannelInstanceId(id)) {
            out.channel = id;
        }
    }
    return out;
}
export function resolveTrigger(ctx) {
    return asNonEmptyString(ctx.trigger);
}
/** Best-effort agent id for trace metadata (hooks sometimes omit top-level agentId). */
export function resolveAgentId(ctx) {
    const direct = asNonEmptyString(ctx.agentId);
    if (direct)
        return direct;
    const agent = ctx.agent;
    if (agent && typeof agent === "object" && !Array.isArray(agent)) {
        const id = asNonEmptyString(agent.id);
        if (id)
            return id;
    }
    return undefined;
}
/** Normalize `agent/…` slash form to `agent:…` (OpenClaw uses colon form for thread_id). */
export function normalizeAgentThreadKey(key) {
    const t = key.trim();
    if (t.startsWith("agent/")) {
        return `agent:${t.slice(6)}`;
    }
    return t;
}
function firstOpenClawAgentThreadKey(...raws) {
    for (const raw of raws) {
        if (typeof raw !== "string")
            continue;
        const s = raw.trim();
        if (s.startsWith("agent:") || s.startsWith("agent/")) {
            return normalizeAgentThreadKey(s);
        }
    }
    return undefined;
}
/**
 * Infer stable `agent:…` thread key from hook ctx. OpenClaw often puts it in `keys` / `aliasKeys` /
 * `pendingAliasKeys` or `primarySessionKey`, while top-level `sessionKey` may be a short id or missing.
 */
export function inferCanonicalThreadKey(ctx) {
    const primary = firstOpenClawAgentThreadKey(ctx.primarySessionKey);
    if (primary)
        return primary;
    const topSession = firstOpenClawAgentThreadKey(ctx.sessionKey);
    if (topSession)
        return topSession;
    for (const arrName of ["keys", "aliasKeys", "pendingAliasKeys"]) {
        const arr = ctx[arrName];
        if (!Array.isArray(arr))
            continue;
        for (const item of arr) {
            const fromArr = firstOpenClawAgentThreadKey(item);
            if (fromArr)
                return fromArr;
        }
    }
    const routing = ctx.routing;
    if (routing && typeof routing === "object" && !Array.isArray(routing)) {
        const r = routing;
        const fr = firstOpenClawAgentThreadKey(r.sessionKey, r.threadKey, r.primarySessionKey);
        if (fr)
            return fr;
    }
    const oc = ctx.openclaw;
    if (oc && typeof oc === "object" && !Array.isArray(oc)) {
        const o = oc;
        const fo = firstOpenClawAgentThreadKey(o.sessionKey, o.primarySessionKey);
        if (fo)
            return fo;
    }
    const ocRout = ctx.openclaw_routing;
    if (ocRout && typeof ocRout === "object" && !Array.isArray(ocRout)) {
        const r = ocRout;
        const fx = firstOpenClawAgentThreadKey(r.sessionKey, r.session_key, r.threadKey, r.thread_key, r.primarySessionKey);
        if (fx)
            return fx;
    }
    return firstOpenClawAgentThreadKey(ctx.threadKey);
}
const volatileSessionToCanonicalThread = new Map();
export function resetOpikThreadSessionAliases() {
    volatileSessionToCanonicalThread.clear();
}
/**
 * Prefer canonical `agent:…` thread id; remember volatile run session UUID → canonical for hooks that
 * only carry `sessionId`.
 */
export function resolveEffectiveOpikSessionKey(ctx, eventSessionId) {
    const inferred = inferCanonicalThreadKey(ctx);
    const volatile = asNonEmptyString(eventSessionId) ?? asNonEmptyString(ctx.sessionId);
    if (inferred) {
        if (volatile && inferred !== volatile) {
            volatileSessionToCanonicalThread.set(volatile, inferred);
        }
        return inferred;
    }
    if (volatile && volatileSessionToCanonicalThread.has(volatile)) {
        return volatileSessionToCanonicalThread.get(volatile);
    }
    return undefined;
}
function isChildAgentThreadKey(key) {
    const segments = key.split(":");
    return segments.includes("subagent") || segments.includes("toolcall");
}
/** `agent:<agentId>:subagent:<uuid>` child session threads. */
export function isSubagentThreadKey(sessionKey) {
    const parts = normalizeAgentThreadKey(sessionKey).split(":");
    return parts.length >= 4 && parts[0] === "agent" && parts[2] === "subagent";
}
export function resolveTraceId(trace) {
    const bag = trace;
    return asNonEmptyString(bag.data?.id);
}
export function resolveMainSessionKey(ctx) {
    const canonicalThreadKey = inferCanonicalThreadKey(ctx);
    if (canonicalThreadKey && !isChildAgentThreadKey(canonicalThreadKey)) {
        return canonicalThreadKey;
    }
    const explicitSessionKey = asNonEmptyString(ctx.sessionKey);
    if (explicitSessionKey && explicitSessionKey.startsWith("agent:") && !isChildAgentThreadKey(explicitSessionKey)) {
        return explicitSessionKey;
    }
    return undefined;
}
export function asNonNegativeNumber(value) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        return undefined;
    }
    return value;
}
export function normalizeProvider(value) {
    const raw = asNonEmptyString(value);
    if (!raw)
        return undefined;
    const normalized = raw.trim().toLowerCase();
    if (normalized.length === 0)
        return undefined;
    if (normalized === "openai-codex" ||
        normalized === "openai_codex" ||
        normalized === "codex" ||
        (normalized.includes("openai") && normalized.includes("codex"))) {
        return "openai";
    }
    return normalized;
}
export function hasUsageFields(usage) {
    return (usage.input != null ||
        usage.output != null ||
        usage.cacheRead != null ||
        usage.cacheWrite != null ||
        usage.total != null);
}
export function hasCostUsageFields(costMeta) {
    return (costMeta.usageInput != null ||
        costMeta.usageOutput != null ||
        costMeta.usageCacheRead != null ||
        costMeta.usageCacheWrite != null ||
        costMeta.usageTotal != null);
}
export function resolveToolCallId(event, ctx) {
    return asNonEmptyString(event.toolCallId) ?? asNonEmptyString(ctx.toolCallId);
}
export function resolveRunId(event, ctx) {
    return asNonEmptyString(event.runId) ?? asNonEmptyString(ctx.runId);
}
export function formatError(err) {
    if (err instanceof Error) {
        return err.stack ?? err.message;
    }
    if (typeof err === "string") {
        return err;
    }
    try {
        return JSON.stringify(err);
    }
    catch {
        return String(err);
    }
}
/** Extract LLM API endpoint host from hook event when OpenClaw exposes baseUrl. */
export function resolveLlmEndpointMeta(event) {
    const raw = asNonEmptyString(event.baseUrl) ??
        asNonEmptyString(event.apiBase) ??
        asNonEmptyString(event.llmEndpoint);
    if (!raw) {
        return {};
    }
    try {
        const host = new URL(raw).hostname;
        if (!host) {
            return { llm_endpoint: raw };
        }
        return { llm_endpoint: raw, llm_endpoint_host: host };
    }
    catch {
        return { llm_endpoint: raw };
    }
}
export function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}
