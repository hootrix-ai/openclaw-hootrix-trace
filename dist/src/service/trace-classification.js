import { asNonEmptyString, isSubagentThreadKey, normalizeAgentThreadKey, } from "./helpers.js";
export const KNOWN_TRACE_TYPES = ["external", "subagent", "async_command", "system"];
const INTERNAL_TRACE_KINDS = new Set([
    "internal_memory_flush",
    "internal_compaction",
    "internal_heartbeat",
    "internal_followup",
    "internal_silent_ack",
]);
function metadataRecord(ctx) {
    return ctx ?? {};
}
function looksLikeSystemPrompt(prompt) {
    if (!prompt)
        return false;
    return prompt.includes("Pre-compaction memory flush.");
}
function looksLikeAsyncMetadata(meta) {
    if (meta.async_command === true || meta.is_async === true)
        return true;
    const commandKind = asNonEmptyString(meta.command_kind)?.toLowerCase();
    if (commandKind && /async/.test(commandKind))
        return true;
    const traceKind = asNonEmptyString(meta.trace_kind)?.toLowerCase();
    if (traceKind && /async/.test(traceKind))
        return true;
    return false;
}
/** OpenClaw subagent completion announces reuse announce:* runIds on the host thread. */
export function looksLikeSubagentAnnounceRun(runId, meta) {
    const id = (runId?.trim() ||
        asNonEmptyString(meta?.runId) ||
        asNonEmptyString(meta?.run_id) ||
        "").toLowerCase();
    if (!id)
        return false;
    if (!id.startsWith("announce:") && !id.startsWith("announce/"))
        return false;
    if (id.includes(":subagent:"))
        return true;
    if (id.includes("subagent_announce"))
        return true;
    return false;
}
function capabilitiesFor(traceType) {
    switch (traceType) {
        case "subagent":
            return {
                independentTrace: true,
                allowFinalizeReuse: false,
                bridgeSpanOnHost: true,
                hideInUiByDefault: false,
            };
        case "async_command":
            return {
                independentTrace: true,
                allowFinalizeReuse: false,
                bridgeSpanOnHost: false,
                hideInUiByDefault: false,
            };
        case "system":
            return {
                independentTrace: true,
                allowFinalizeReuse: false,
                bridgeSpanOnHost: false,
                hideInUiByDefault: true,
            };
        default:
            return {
                independentTrace: false,
                allowFinalizeReuse: true,
                bridgeSpanOnHost: false,
                hideInUiByDefault: false,
            };
    }
}
export function classificationMetadata(c) {
    const out = {
        trace_type: c.traceType,
        run_kind: c.runKind,
    };
    if (c.traceKind) {
        out.trace_kind = c.traceKind;
    }
    return out;
}
export function resolveTraceClassification(params) {
    const meta = metadataRecord(params.metadata);
    const sessionKey = normalizeAgentThreadKey(params.sessionKey);
    const runId = params.runId?.trim() ?? "";
    const trigger = params.trigger?.trim().toLowerCase() ?? "";
    const explicitTraceType = asNonEmptyString(meta.trace_type)?.toLowerCase();
    if (explicitTraceType) {
        const runKind = asNonEmptyString(meta.run_kind) ?? explicitTraceType;
        return {
            traceType: explicitTraceType,
            runKind,
            traceKind: asNonEmptyString(meta.trace_kind),
            capabilities: capabilitiesFor(explicitTraceType),
        };
    }
    if (isSubagentThreadKey(sessionKey)) {
        return {
            traceType: "subagent",
            runKind: "subagent",
            capabilities: capabilitiesFor("subagent"),
        };
    }
    const traceKindRaw = asNonEmptyString(meta.trace_kind)?.toLowerCase();
    if (traceKindRaw && INTERNAL_TRACE_KINDS.has(traceKindRaw)) {
        return {
            traceType: "system",
            runKind: "system",
            traceKind: traceKindRaw,
            capabilities: capabilitiesFor("system"),
        };
    }
    if (trigger === "system" ||
        looksLikeSystemPrompt(params.prompt) ||
        looksLikeSystemPrompt(params.systemPrompt)) {
        return {
            traceType: "system",
            runKind: "system",
            traceKind: traceKindRaw,
            capabilities: capabilitiesFor("system"),
        };
    }
    if (looksLikeSubagentAnnounceRun(runId, meta)) {
        return {
            traceType: "external",
            runKind: "subagent_announce",
            capabilities: capabilitiesFor("external"),
        };
    }
    if (runId.startsWith("announce:") ||
        runId.startsWith("announce/") ||
        trigger === "async" ||
        trigger === "async_followup" ||
        trigger === "cron" ||
        looksLikeAsyncMetadata(meta)) {
        return {
            traceType: "async_command",
            runKind: "async_followup",
            capabilities: capabilitiesFor("async_command"),
        };
    }
    return {
        traceType: "external",
        runKind: "external",
        capabilities: capabilitiesFor("external"),
    };
}
/** @deprecated use resolveTraceClassification */
export function resolveTraceKind(params) {
    return resolveTraceClassification(params).traceType;
}
/** @deprecated use classificationMetadata */
export function traceKindMetadata(kind) {
    const runKind = kind === "async_command" ? "async_followup" : kind === "external" ? "external" : kind;
    return { trace_type: kind, run_kind: runKind };
}
