import { onDiagnosticEvent } from "openclaw/plugin-sdk";
import { HOOTRIX_PLUGIN_ID } from "./constants.js";
import { createAttachmentUploader } from "./service/attachment-uploader.js";
import { resetMediaPlaceholderRegistry } from "./service/attachment-placeholder-registry.js";
import { registerGatewayHooks } from "./service/hooks/gateway.js";
import { registerLlmHooks } from "./service/hooks/llm.js";
import { registerSubagentHooks } from "./service/hooks/subagent.js";
import { registerToolHooks } from "./service/hooks/tool.js";
import { ATTACHMENT_UPLOADS_ENABLED, DEFAULT_ATTACHMENT_BASE_URL, DEFAULT_FLUSH_RETRY_BASE_DELAY_MS, DEFAULT_FLUSH_RETRY_COUNT, DEFAULT_STALE_SWEEP_INTERVAL_MS, DEFAULT_STALE_TRACE_TIMEOUT_MS, FALLBACK_FINALIZE_DELAY_MS, MAX_FLUSH_RETRY_DELAY_MS, HOOTRIX_CREATED_FROM, } from "./service/constants.js";
import { asNonEmptyString, asNonNegativeNumber, formatError, hasCostUsageFields, hasUsageFields, mergeDefinedConfig, normalizeProvider, resetHootrixThreadSessionAliases, channelMetadataFields, inferChannelProviderFromThreadKey, logChannelResolve, resolveChannelName, resolveEffectiveHootrixSessionKey, resolveTrigger, sleep, } from "./service/helpers.js";
import { setOpenClawStateDir } from "./service/media.js";
import { sanitizeStringForHootrix, sanitizeValueForHootrix } from "./service/payload-sanitizer.js";
import { collectorFetch } from "./collector-fetch.js";
import { parseHootrixPluginConfig } from "./types.js";
import { refreshSageExperiment } from "./service/sage-client.js";
import { parseExperimentIdFromTags } from "./service/sage-experiment.js";
import { getHootrixPluginEntry } from "./configure.js";
import { startPluginInstanceReporter, } from "./plugin-instance-client.js";
import { traceDbg } from "../index.js";
let client = null;
const activeTraces = new Map();
const subagentSpanHosts = new Map();
const sessionByAgentId = new Map();
let cleanup = null;
let spanSeq = 0;
let lastActiveSessionKey;
let warnedMissingAfterToolSessionKey = false;
let log = {
    info: () => undefined,
    warn: () => undefined,
};
let staleTraceTimeoutMs = DEFAULT_STALE_TRACE_TIMEOUT_MS;
let staleSweepIntervalMs = DEFAULT_STALE_SWEEP_INTERVAL_MS;
let staleTraceCleanupEnabled = true;
let flushRetryCount = DEFAULT_FLUSH_RETRY_COUNT;
let flushRetryBaseDelayMs = DEFAULT_FLUSH_RETRY_BASE_DELAY_MS;
let attachmentBaseUrl = DEFAULT_ATTACHMENT_BASE_URL;
let currentApiKey;
let currentWorkspaceName = "default";
let currentProjectName = "openclaw";
let currentTags = ["openclaw"];
let toolResultPersistSanitizeEnabled = false;
let sageEnabled = false;
let sageMainApiUrl = "http://127.0.0.1:9821";
let sageAutoRefreshExperiment = true;
let sageApiKey;
let flushQueue = Promise.resolve();
// 延迟 finalize 机制：用于合并 fallback 场景的多个 LLM 调用到同一个 trace
const pendingFinalizes = new Map();
const pendingSubagentLineage = new Map();
const attachmentUploader = createAttachmentUploader({
    getApiKey: () => currentApiKey,
    getWorkspaceName: () => currentWorkspaceName,
    getAttachmentBaseUrl: () => attachmentBaseUrl,
    onWarn: (message) => log.warn(message),
    formatError,
    attachmentsEnabled: ATTACHMENT_UPLOADS_ENABLED,
});
const exporterMetrics = {
    traceUpdateErrors: 0,
    traceEndErrors: 0,
    spanUpdateErrors: 0,
    spanEndErrors: 0,
    flushSuccesses: 0,
    flushFailures: 0,
    flushRetries: 0,
};
function resetSharedRuntimeState() {
    traceDbg("service_state", { node: "reset_shared_runtime_state" });
    cleanup?.();
    client = null;
    activeTraces.clear();
    subagentSpanHosts.clear();
    sessionByAgentId.clear();
    cleanup = null;
    spanSeq = 0;
    lastActiveSessionKey = undefined;
    warnedMissingAfterToolSessionKey = false;
    staleTraceTimeoutMs = DEFAULT_STALE_TRACE_TIMEOUT_MS;
    staleSweepIntervalMs = DEFAULT_STALE_SWEEP_INTERVAL_MS;
    staleTraceCleanupEnabled = true;
    flushRetryCount = DEFAULT_FLUSH_RETRY_COUNT;
    flushRetryBaseDelayMs = DEFAULT_FLUSH_RETRY_BASE_DELAY_MS;
    attachmentBaseUrl = DEFAULT_ATTACHMENT_BASE_URL;
    currentApiKey = undefined;
    currentWorkspaceName = "default";
    currentProjectName = "openclaw";
    currentTags = ["openclaw"];
    toolResultPersistSanitizeEnabled = false;
    sageEnabled = false;
    sageMainApiUrl = "http://127.0.0.1:9821";
    sageAutoRefreshExperiment = true;
    sageApiKey = undefined;
    flushQueue = Promise.resolve();
    pendingFinalizes.clear();
    pendingSubagentLineage.clear();
    setOpenClawStateDir(undefined);
    attachmentUploader.reset();
    resetMediaPlaceholderRegistry();
    exporterMetrics.traceUpdateErrors = 0;
    exporterMetrics.traceEndErrors = 0;
    exporterMetrics.spanUpdateErrors = 0;
    exporterMetrics.spanEndErrors = 0;
    exporterMetrics.flushSuccesses = 0;
    exporterMetrics.flushFailures = 0;
    exporterMetrics.flushRetries = 0;
    resetHootrixThreadSessionAliases();
}
export function createHootrixService(api, pluginConfig = {}) {
    let hooksRegistered = false;
    let pluginInstanceReporter = null;
    /** Merge disk + register-time + service.start ctx.config + closure pluginConfig (later wins within mergeDefinedConfig rules). */
    function mergePluginConfigLayers(ctxConfig) {
        let acc = parseHootrixPluginConfig(undefined);
        try {
            const disk = api.runtime?.config?.current?.();
            acc = mergeDefinedConfig(acc, parseHootrixPluginConfig(disk));
            const entry = getHootrixPluginEntry(disk ?? {});
            if (entry.enabled !== undefined) {
                acc = mergeDefinedConfig(acc, { enabled: entry.enabled });
            }
        }
        catch {
            /* current() unavailable or invalid */
        }
        acc = mergeDefinedConfig(acc, parseHootrixPluginConfig(api.pluginConfig));
        acc = mergeDefinedConfig(acc, parseHootrixPluginConfig(ctxConfig));
        return mergeDefinedConfig(acc, pluginConfig);
    }
    function rememberSessionCorrelation(sessionKey, agentId) {
        lastActiveSessionKey = sessionKey;
        if (typeof agentId === "string" && agentId.length > 0) {
            sessionByAgentId.set(agentId, sessionKey);
        }
    }
    function resolveSessionKey(ctx, sessionIdOverride) {
        const explicitSessionKey = asNonEmptyString(ctx.sessionKey);
        if (explicitSessionKey)
            return explicitSessionKey;
        const sessionId = sessionIdOverride ?? asNonEmptyString(ctx.sessionId);
        if (sessionId)
            return sessionId;
        const agentId = asNonEmptyString(ctx.agentId);
        if (agentId) {
            const mappedSessionKey = sessionByAgentId.get(agentId);
            if (mappedSessionKey)
                return mappedSessionKey;
        }
        return lastActiveSessionKey;
    }
    function applyContextMeta(active, ctx, sessionKey) {
        const explicitAgentId = asNonEmptyString(ctx.agentId);
        if (explicitAgentId) {
            active.agentId = explicitAgentId;
        }
        const explicitChannelId = asNonEmptyString(ctx.channelId);
        if (explicitChannelId) {
            active.channelId = explicitChannelId;
        }
        const channelName = resolveChannelName(ctx, sessionKey);
        if (channelName) {
            active.channelName = channelName;
        }
        const trigger = resolveTrigger(ctx);
        if (trigger)
            active.trigger = trigger;
    }
    function forgetSessionCorrelation(sessionKey) {
        if (lastActiveSessionKey === sessionKey) {
            lastActiveSessionKey = undefined;
        }
        for (const [agentId, mappedSessionKey] of sessionByAgentId) {
            if (mappedSessionKey === sessionKey) {
                sessionByAgentId.delete(agentId);
            }
        }
    }
    function rememberSubagentSpanHost(sessionKey, hostSessionKey, active, span) {
        subagentSpanHosts.set(sessionKey, { hostSessionKey, active, span });
    }
    function getSubagentSpanHost(sessionKey) {
        return subagentSpanHosts.get(sessionKey);
    }
    function forgetSubagentSpanHost(sessionKey) {
        subagentSpanHosts.delete(sessionKey);
    }
    function forgetSubagentSpanHostsByActive(active) {
        for (const [sessionKey, spanHost] of subagentSpanHosts) {
            if (spanHost.active === active) {
                subagentSpanHosts.delete(sessionKey);
            }
        }
    }
    /** Parent trace may finalize while subagent bridge spans are still open. */
    function hasOpenSubagentBridgeSpans(active) {
        if (active.subagentSpans.size > 0) {
            return true;
        }
        for (const spanHost of subagentSpanHosts.values()) {
            if (spanHost.active === active) {
                return true;
            }
        }
        return false;
    }
    function forgetSubagentSpanHostsByActiveIfClosed(active) {
        if (!hasOpenSubagentBridgeSpans(active)) {
            forgetSubagentSpanHostsByActive(active);
        }
    }
    function warnMissingAfterToolSessionKey(fallbackMode) {
        if (warnedMissingAfterToolSessionKey)
            return;
        warnedMissingAfterToolSessionKey = true;
        log.warn(`hootrix: after_tool_call missing sessionKey; using ${fallbackMode} fallback correlation (upgrade OpenClaw for strict context propagation)`);
    }
    function safeTraceUpdate(traceRef, payload, reason) {
        try {
            traceRef.update(payload);
        }
        catch (err) {
            exporterMetrics.traceUpdateErrors += 1;
            log.warn(`hootrix: trace.update failed (${reason}): ${formatError(err)}`);
        }
    }
    function safeTraceEnd(traceRef, reason) {
        try {
            traceRef.end();
        }
        catch (err) {
            exporterMetrics.traceEndErrors += 1;
            log.warn(`hootrix: trace.end failed (${reason}): ${formatError(err)}`);
        }
    }
    function safeSpanUpdate(span, payload, reason) {
        try {
            span.update(payload);
        }
        catch (err) {
            exporterMetrics.spanUpdateErrors += 1;
            log.warn(`hootrix: span.update failed (${reason}): ${formatError(err)}`);
        }
    }
    function safeSpanEnd(span, reason) {
        try {
            span.end();
        }
        catch (err) {
            exporterMetrics.spanEndErrors += 1;
            log.warn(`hootrix: span.end failed (${reason}): ${formatError(err)}`);
        }
    }
    function rememberSubagentLineage(childSessionKey, lineage) {
        pendingSubagentLineage.set(childSessionKey, lineage);
    }
    function getSubagentLineage(childSessionKey) {
        return pendingSubagentLineage.get(childSessionKey);
    }
    function forgetSubagentLineage(childSessionKey) {
        pendingSubagentLineage.delete(childSessionKey);
    }
    function endChildSpans(active, reason, opts) {
        for (const [toolKey, toolSpan] of active.toolSpans) {
            safeSpanEnd(toolSpan, `${reason} toolKey=${toolKey}`);
        }
        active.toolSpans.clear();
        if (opts?.endSubagentSpans !== false) {
            for (const [subagentKey, subagentSpan] of active.subagentSpans) {
                safeSpanEnd(subagentSpan, `${reason} subagentKey=${subagentKey}`);
            }
            active.subagentSpans.clear();
        }
        if (active.llmSpan) {
            safeSpanEnd(active.llmSpan, `${reason} llm`);
            active.llmSpan = null;
        }
    }
    function closeActiveTrace(active, reason) {
        endChildSpans(active, reason);
        forgetSubagentSpanHostsByActive(active);
        // Clear deferred finalization state so stale microtasks no-op.
        active.agentEnd = undefined;
        active.output = undefined;
        safeTraceEnd(active.trace, reason);
    }
    /**
     * Cancel pending finalize for a sessionKey.
     * Returns true if a pending finalize was cancelled (indicates fallback scenario).
     */
    function cancelPendingFinalize(sessionKey) {
        const timeoutId = pendingFinalizes.get(sessionKey);
        if (timeoutId) {
            clearTimeout(timeoutId);
            pendingFinalizes.delete(sessionKey);
            traceDbg("trace_lifecycle", { node: "pending_finalize_cancelled", sessionKey });
            return true;
        }
        return false;
    }
    function resolveSessionSpanContainer(sessionKey) {
        // Subagent sessions own their tool/LLM spans on their independent trace.
        const ownActive = activeTraces.get(sessionKey);
        if (ownActive) {
            return { sessionKey, active: ownActive, parent: ownActive.trace };
        }
        const spanHost = getSubagentSpanHost(sessionKey);
        if (spanHost) {
            return {
                sessionKey: spanHost.hostSessionKey,
                active: spanHost.active,
                parent: spanHost.span,
            };
        }
        return undefined;
    }
    function resolveSubagentSpanContainer(params) {
        if (params.requesterSessionKey) {
            const requesterContainer = resolveSessionSpanContainer(params.requesterSessionKey);
            if (requesterContainer) {
                return requesterContainer;
            }
        }
        const candidates = [params.childSessionKey, params.targetSessionKey];
        for (const key of candidates) {
            if (!key)
                continue;
            const active = activeTraces.get(key);
            if (active) {
                return { sessionKey: key, active, parent: active.trace };
            }
        }
        return undefined;
    }
    async function flushWithRetry(reason) {
        traceDbg("flush", { node: "flush_start", reason });
        const currentClient = client;
        if (!currentClient) {
            traceDbg("flush", { node: "flush_skipped_no_client" });
            return;
        }
        const attempts = flushRetryCount + 1;
        for (let attempt = 1; attempt <= attempts; attempt++) {
            try {
                traceDbg("flush", { node: "flush_attempt", attempt, total: attempts });
                await currentClient.flush();
                exporterMetrics.flushSuccesses += 1;
                traceDbg("flush", { node: "flush_success", reason });
                return;
            }
            catch (err) {
                exporterMetrics.flushFailures += 1;
                traceDbg("flush", { node: "flush_error", attempt, error: formatError(err) });
                log.warn(`hootrix: flush failed (${reason}) attempt ${attempt}/${attempts}: ${formatError(err)}`);
                if (attempt >= attempts) {
                    traceDbg("flush", { node: "flush_give_up", reason });
                    return;
                }
                exporterMetrics.flushRetries += 1;
                const delayMs = Math.min(flushRetryBaseDelayMs * 2 ** (attempt - 1), MAX_FLUSH_RETRY_DELAY_MS);
                traceDbg("flush", { node: "flush_retry_delay", delayMs });
                if (delayMs > 0) {
                    await sleep(delayMs);
                }
            }
        }
    }
    function scheduleFlush(reason) {
        traceDbg("flush", { node: "schedule_flush", reason });
        flushQueue = flushQueue.then(() => flushWithRetry(reason)).catch((err) => {
            traceDbg("flush", { node: "flush_queue_error", error: formatError(err) });
        });
    }
    function trimOrUndefined(value) {
        if (typeof value !== "string")
            return undefined;
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : undefined;
    }
    async function validateProjectTarget(params) {
        const retrieveProject = typeof params.client === "object" &&
            params.client !== null &&
            "projects" in params.client &&
            typeof params.client.projects?.retrieveProject ===
                "function"
            ? (params.client.projects.retrieveProject)
            : undefined;
        if (!retrieveProject)
            return;
        try {
            await retrieveProject({ name: params.projectName }, { workspaceName: params.workspaceName });
        }
        catch (err) {
            const statusCode = typeof err === "object" && err !== null && "statusCode" in err
                ? err.statusCode
                : undefined;
            if (statusCode === 404) {
                log.warn(`hootrix: configured project "${params.projectName}" was not found in workspace "${params.workspaceName}"; traces may not appear until the project exists or the plugin is reconfigured`);
                return;
            }
            if (statusCode === 403) {
                log.warn(`hootrix: could not access project "${params.projectName}" in workspace "${params.workspaceName}" (forbidden); verify the API key and workspace permissions`);
                return;
            }
            log.warn(`hootrix: could not validate project "${params.projectName}" in workspace "${params.workspaceName}": ${formatError(err)}`);
        }
    }
    /** Consolidate output + metadata into a single trace.update() + trace.end(). */
    function finalizeTrace(sessionKey) {
        const active = activeTraces.get(sessionKey);
        if (!active)
            return;
        // End any remaining open child spans (LLM span if llm_output didn't fire).
        // Keep subagent bridge spans open while child sessions may still be running.
        endChildSpans(active, `finalize sessionKey=${sessionKey}`, { endSubagentSpans: false });
        // Build output: prefer llm_output data, fall back to last assistant from messages.
        let output;
        if (active.output) {
            output = active.output;
        }
        else if (active.agentEnd?.messages?.length) {
            const last = [...active.agentEnd.messages]
                .reverse()
                .find((m) => m?.role === "assistant");
            if (last)
                output = { output: "", lastAssistant: last };
        }
        const agentEnd = active.agentEnd;
        if (!active.channelName && sessionKey) {
            active.channelName = inferChannelProviderFromThreadKey(sessionKey);
        }
        const finChannelMeta = channelMetadataFields({
            channelId: active.channelId,
            channelName: active.channelName,
        });
        logChannelResolve("finalize_trace", sessionKey, undefined, {
            channelId: active.channelId,
            channelName: active.channelName,
            metadata: finChannelMeta,
        });
        const metadata = {
            created_from: HOOTRIX_CREATED_FROM,
            ...active.costMeta,
            success: agentEnd?.success,
            durationMs: agentEnd?.durationMs,
            model: active.model ?? active.costMeta.model,
            provider: active.provider ?? active.costMeta.provider,
            ...(active.agentId ? { agentId: active.agentId } : {}),
            ...finChannelMeta,
            ...(active.trigger ? { trigger: active.trigger } : {}),
            ...(active.experimentId ? { "hootrix.experiment_id": active.experimentId } : {}),
        };
        // Prefer accumulated llm_output usage, fall back to diagnostic costMeta usage.
        if (hasUsageFields(active.usage)) {
            metadata.usage = { ...active.usage };
        }
        else if (hasCostUsageFields(active.costMeta)) {
            metadata.usage = {
                input: active.costMeta.usageInput,
                output: active.costMeta.usageOutput,
                cacheRead: active.costMeta.usageCacheRead,
                cacheWrite: active.costMeta.usageCacheWrite,
                total: active.costMeta.usageTotal,
            };
        }
        // 优先使用 LLM 错误，其次使用 agentEnd 错误
        const errorMessage = active.llmError?.message ?? agentEnd?.error;
        if (errorMessage)
            metadata.error = errorMessage;
        // 构建 errorInfo：优先使用 llmError，其次使用 agentEnd.error
        const errorInfo = active.llmError
            ? {
                exceptionType: "LLMError",
                message: active.llmError.message,
                traceback: active.llmError.details ?? active.llmError.message,
            }
            : agentEnd?.error
                ? {
                    exceptionType: "AgentError",
                    message: agentEnd.error,
                    traceback: agentEnd.error,
                }
                : undefined;
        safeTraceUpdate(active.trace, {
            ...(output ? { output } : {}),
            metadata: {
                ...metadata,
                // 标记是否存在 LLM 错误，便于后续分析
                hasLlmError: !!active.llmError,
                ...(active.llmError?.model ? { llmErrorModel: active.llmError.model } : {}),
                ...(active.llmError?.stopReason ? { llmStopReason: active.llmError.stopReason } : {}),
            },
            ...(errorInfo ? { errorInfo } : {}),
        }, `finalize sessionKey=${sessionKey}`);
        safeTraceEnd(active.trace, `finalize sessionKey=${sessionKey}`);
        const experimentId = active.experimentId ?? parseExperimentIdFromTags(currentTags);
        // Keep bridge-span host lookups alive until subagent_ended closes each child.
        forgetSubagentSpanHostsByActiveIfClosed(active);
        activeTraces.delete(sessionKey);
        forgetSessionCorrelation(sessionKey);
        scheduleFlush(`trace-finalized sessionKey=${sessionKey}`);
        if (sageEnabled && sageAutoRefreshExperiment && experimentId && sageApiKey) {
            const apiKey = sageApiKey;
            flushQueue = flushQueue
                .then(async () => {
                traceDbg("sage_experiment", { node: "refresh_after_finalize", experimentId, sessionKey });
                await refreshSageExperiment({
                    mainApiUrl: sageMainApiUrl,
                    apiKey,
                    experimentId,
                });
            })
                .catch((err) => {
                log.warn(`hootrix-sage: experiment refresh failed (${experimentId}): ${formatError(err)}`);
            });
        }
    }
    function registerHooks() {
        traceDbg("hooks_lifecycle", { node: "registerHooks_start" });
        if (hooksRegistered) {
            traceDbg("hooks_lifecycle", { node: "registerHooks_already_registered" });
            return;
        }
        hooksRegistered = true;
        traceDbg("hooks_lifecycle", { node: "registerHooks_proceeding" });
        traceDbg("hooks_registration", { node: "registering_gateway_hooks" });
        registerGatewayHooks({
            api,
            getClient: () => client,
            activeTraces,
            getProjectName: () => currentProjectName,
            getTags: () => currentTags,
            warn: (message) => log.warn(message),
            formatError,
        });
        traceDbg("hooks_registration", { node: "gateway_hooks_registered" });
        traceDbg("hooks_registration", { node: "registering_llm_hooks" });
        registerLlmHooks({
            api,
            getClient: () => client,
            activeTraces,
            getTags: () => currentTags,
            getProjectName: () => currentProjectName,
            rememberSessionCorrelation,
            closeActiveTrace,
            forgetSessionCorrelation,
            applyContextMeta,
            safeSpanUpdate,
            safeSpanEnd,
            safeTraceUpdate,
            scheduleMediaAttachmentUploads: attachmentUploader.scheduleMediaAttachmentUploads,
            warn: (message) => log.warn(message),
            formatError,
            resolveSessionKey,
            cancelPendingFinalize,
            getSubagentLineage,
            forgetSubagentLineage,
        });
        traceDbg("hooks_registration", { node: "llm_hooks_registered" });
        traceDbg("hooks_registration", { node: "registering_tool_hooks" });
        registerToolHooks({
            api,
            getClient: () => client,
            activeTraces,
            sessionByAgentId,
            getLastActiveSessionKey: () => lastActiveSessionKey,
            rememberSessionCorrelation,
            resolveSessionSpanContainer,
            warnMissingAfterToolSessionKey,
            nextSpanSeq: () => ++spanSeq,
            safeSpanUpdate,
            safeSpanEnd,
            scheduleMediaAttachmentUploads: attachmentUploader.scheduleMediaAttachmentUploads,
            getProjectName: () => currentProjectName,
            warn: (message) => log.warn(message),
            formatError,
        });
        traceDbg("hooks_registration", { node: "tool_hooks_registered" });
        traceDbg("hooks_registration", { node: "registering_subagent_hooks" });
        registerSubagentHooks({
            api,
            getClient: () => client,
            activeTraces,
            rememberSessionCorrelation,
            resolveSubagentSpanContainer,
            getSubagentSpanHost,
            rememberSubagentSpanHost,
            forgetSubagentSpanHost,
            forgetSubagentSpanHostsByActiveIfClosed,
            rememberSubagentLineage,
            forgetSubagentLineage,
            safeSpanUpdate,
            safeSpanEnd,
            safeTraceUpdate,
            warn: (message) => log.warn(message),
            formatError,
        });
        traceDbg("hooks_registration", { node: "subagent_hooks_registered" });
        api.on("tool_result_persist", (event) => {
            traceDbg("hook_event", { node: "tool_result_persist", enabled: toolResultPersistSanitizeEnabled });
            if (!toolResultPersistSanitizeEnabled) {
                return;
            }
            try {
                const eventObj = event;
                const message = eventObj.message;
                if (!message || typeof message !== "object")
                    return;
                const sanitizedMessage = sanitizeValueForHootrix(message);
                if (sanitizedMessage !== message) {
                    return { message: sanitizedMessage };
                }
            }
            catch (err) {
                log.warn(`hootrix: tool_result_persist failed: ${formatError(err)}`);
            }
        });
        api.on("agent_end", (event, agentCtx) => {
            traceDbg("hook_event", { node: "agent_end_start" });
            const agentCtxObj = agentCtx;
            const sessionKey = resolveEffectiveHootrixSessionKey(agentCtxObj) ?? resolveSessionKey(agentCtxObj);
            traceDbg("hook_event", { node: "agent_end_session_key_resolved", sessionKey });
            if (!sessionKey) {
                log.warn("hootrix: agent_end missing sessionKey");
                return;
            }
            rememberSessionCorrelation(sessionKey, agentCtx.agentId);
            const active = activeTraces.get(sessionKey);
            if (!active) {
                log.warn(`hootrix: agent_end missing active trace sessionKey=${sessionKey} activeTraces=${activeTraces.size}`);
                return;
            }
            applyContextMeta(active, agentCtx, sessionKey);
            for (const [toolKey, toolSpan] of active.toolSpans) {
                safeSpanEnd(toolSpan, `agent_end orphan tool sessionKey=${sessionKey} toolKey=${toolKey}`);
            }
            active.toolSpans.clear();
            // Subagent bridge spans are ended by subagent_ended, not main agent_end.
            active.agentEnd = {
                success: event.success,
                error: typeof event.error === "string" ? sanitizeStringForHootrix(event.error) : event.error,
                durationMs: event.durationMs,
                messages: sanitizeValueForHootrix(event.messages ?? []) ?? [],
            };
            const attachmentEntity = active.llmSpan ?? active.trace;
            attachmentUploader.scheduleMediaAttachmentUploads({
                entityType: active.llmSpan ? "span" : "trace",
                entity: attachmentEntity,
                projectName: currentProjectName,
                traceId: active.traceId,
                reason: `agent_end sessionKey=${sessionKey}`,
                payloads: [
                    event.error,
                    ...(event.messages ?? []),
                ],
            });
            // 延迟 finalize 以支持 fallback 场景：如果 20 秒内有新的 LLM 调用，取消本次 finalize
            if (pendingFinalizes.has(sessionKey)) {
                clearTimeout(pendingFinalizes.get(sessionKey));
                traceDbg("trace_lifecycle", { node: "cancelled_previous_finalize", sessionKey });
            }
            const timeoutId = setTimeout(() => {
                pendingFinalizes.delete(sessionKey);
                const current = activeTraces.get(sessionKey);
                if (current && current.trace === active.trace) {
                    traceDbg("trace_lifecycle", { node: "delayed_finalize_executing", sessionKey, delayMs: FALLBACK_FINALIZE_DELAY_MS });
                    finalizeTrace(sessionKey);
                }
            }, FALLBACK_FINALIZE_DELAY_MS);
            pendingFinalizes.set(sessionKey, timeoutId);
            traceDbg("trace_lifecycle", { node: "delayed_finalize_scheduled", sessionKey, delayMs: FALLBACK_FINALIZE_DELAY_MS });
            // Return session fields to hootrix to prevent status from staying "running"
            // and to prevent session list fields from being overwritten with empty values.
            return {
                ...event,
                status: event.success ? "completed" : "failed",
            };
        });
    }
    const service = {
        id: HOOTRIX_PLUGIN_ID,
        registerHooks,
        async start(ctx) {
            traceDbg("service_lifecycle", { node: "service_start_begin" });
            registerHooks();
            resetSharedRuntimeState();
            const hootrixCfg = mergePluginConfigLayers(ctx.config);
            traceDbg("service_config", { node: "config_merged", enabled: hootrixCfg?.enabled });
            log = {
                info: ctx.logger.info.bind(ctx.logger),
                warn: ctx.logger.warn.bind(ctx.logger),
            };
            setOpenClawStateDir(asNonEmptyString(ctx.stateDir));
            traceDbg("service_lifecycle", { node: "logger_initialized" });
            currentProjectName = pluginConfig.projectName?.trim() || "openclaw";
            currentTags = pluginConfig.tags ?? ["openclaw"];
            toolResultPersistSanitizeEnabled = pluginConfig.toolResultPersistSanitizeEnabled === true;
            if (!hootrixCfg?.enabled) {
                traceDbg("service_lifecycle", { node: "service_disabled_skipping" });
                log.warn("hootrix-trace: plugin disabled (set plugins.entries.openclaw-hootrix-trace.config.enabled=true and apiUrl/apiKey)");
                cleanup = () => undefined;
                return;
            }
            traceDbg("service_lifecycle", { node: "service_enabled_proceeding" });
            const apiKey = hootrixCfg.apiKey ?? process.env.HOOTRIX_API_KEY;
            const apiUrl = hootrixCfg.apiUrl ?? process.env.HOOTRIX_URL_OVERRIDE;
            if (!apiUrl?.trim()) {
                log.warn("hootrix-trace: apiUrl missing — traces will not reach collector (run `openclaw hootrix configure` or set config.apiUrl / HOOTRIX_URL_OVERRIDE)");
            }
            if (!apiKey?.trim()) {
                log.warn("hootrix-trace: apiKey missing — collector ingest will be rejected");
            }
            const projectName = hootrixCfg.projectName ?? trimOrUndefined(process.env.HOOTRIX_PROJECT_NAME) ?? "openclaw";
            const workspaceName = hootrixCfg.workspaceName ?? trimOrUndefined(process.env.HOOTRIX_WORKSPACE) ?? "default";
            const tags = hootrixCfg.tags ?? ["openclaw"];
            currentProjectName = projectName;
            currentTags = tags;
            currentApiKey = apiKey?.trim() || undefined;
            currentWorkspaceName = workspaceName;
            attachmentBaseUrl = (apiUrl ?? DEFAULT_ATTACHMENT_BASE_URL).replace(/\/+$/, "");
            toolResultPersistSanitizeEnabled = hootrixCfg.toolResultPersistSanitizeEnabled === true;
            sageEnabled = hootrixCfg.sageEnabled === true;
            sageMainApiUrl = hootrixCfg.mainApiUrl?.trim() || "http://127.0.0.1:9821";
            sageAutoRefreshExperiment = hootrixCfg.sageAutoRefreshExperiment !== false;
            sageApiKey = apiKey?.trim() || undefined;
            staleTraceCleanupEnabled = hootrixCfg.staleTraceCleanupEnabled !== false;
            staleTraceTimeoutMs = Math.max(1000, asNonNegativeNumber(hootrixCfg.staleTraceTimeoutMs) ?? DEFAULT_STALE_TRACE_TIMEOUT_MS);
            staleSweepIntervalMs = Math.max(1000, asNonNegativeNumber(hootrixCfg.staleSweepIntervalMs) ?? DEFAULT_STALE_SWEEP_INTERVAL_MS);
            flushRetryCount = Math.floor(asNonNegativeNumber(hootrixCfg.flushRetryCount) ?? DEFAULT_FLUSH_RETRY_COUNT);
            flushRetryBaseDelayMs = asNonNegativeNumber(hootrixCfg.flushRetryBaseDelayMs) ??
                DEFAULT_FLUSH_RETRY_BASE_DELAY_MS;
            traceDbg("service_hootrix", { node: "initializing_hootrix_client", projectName, workspaceName });
            const { disableLogger, Opik } = await import("hootrix");
            // Suppress SDK tslog console output once the exporter actually starts.
            disableLogger();
            client = new Opik({
                apiKey,
                ...(apiUrl ? { apiUrl } : {}),
                projectName,
                workspaceName,
                fetch: collectorFetch,
                ...(apiKey
                    ? {
                        headers: {
                            "X-API-Key": apiKey,
                            Authorization: `Bearer ${apiKey}`,
                        },
                    }
                    : {}),
            });
            traceDbg("service_hootrix", { node: "hootrix_client_created" });
            traceDbg("service_hootrix", { node: "validating_project_target" });
            await validateProjectTarget({
                client,
                projectName,
                workspaceName,
            });
            traceDbg("service_hootrix", { node: "project_target_validated" });
            if (apiUrl && apiKey) {
                pluginInstanceReporter = startPluginInstanceReporter({
                    config: { baseUrl: apiUrl, apiKey },
                    workspaceName,
                    agentCount: () => activeTraces.size,
                });
                traceDbg("plugin_instance", { node: "reporter_started", workspaceName });
            }
            // =====================================================================
            // Diagnostic event: model.usage — Accumulate cost/context info
            // =====================================================================
            traceDbg("service_diagnostics", { node: "subscribing_to_diagnostics" });
            const unsubscribeDiagnosticsRaw = onDiagnosticEvent((evt) => {
                if (evt.type !== "model.usage")
                    return;
                const evtObj = evt;
                const sessionKey = resolveEffectiveHootrixSessionKey(evtObj) ?? asNonEmptyString(evt.sessionKey);
                if (!sessionKey)
                    return;
                const active = activeTraces.get(sessionKey);
                if (!active)
                    return;
                // Accumulate cost metadata — will be merged into trace at agent_end.
                if (evt.costUsd !== undefined) {
                    active.costMeta.costUsd = evt.costUsd;
                }
                if (evt.context?.limit !== undefined) {
                    active.costMeta.contextLimit = evt.context.limit;
                }
                if (evt.context?.used !== undefined) {
                    active.costMeta.contextUsed = evt.context.used;
                }
                if (evt.model)
                    active.costMeta.model = evt.model;
                if (evt.provider)
                    active.costMeta.provider = normalizeProvider(evt.provider) ?? evt.provider;
                if (evt.durationMs !== undefined)
                    active.costMeta.durationMs = evt.durationMs;
                if (evt.usage) {
                    active.costMeta.usageInput = evt.usage.input;
                    active.costMeta.usageOutput = evt.usage.output;
                    active.costMeta.usageCacheRead = evt.usage.cacheRead;
                    active.costMeta.usageCacheWrite = evt.usage.cacheWrite;
                    active.costMeta.usageTotal = evt.usage.total;
                }
            });
            const unsubscribeDiagnostics = typeof unsubscribeDiagnosticsRaw === "function" ? unsubscribeDiagnosticsRaw : () => undefined;
            // =====================================================================
            // Stale trace cleanup interval (based on inactivity, not age)
            // =====================================================================
            const sweepInterval = staleTraceCleanupEnabled
                ? setInterval(() => {
                    const now = Date.now();
                    for (const [key, active] of activeTraces) {
                        if (now - active.lastActivityAt > staleTraceTimeoutMs) {
                            endChildSpans(active, `stale cleanup sessionKey=${key}`);
                            // Mark trace as stale before closing.
                            safeTraceUpdate(active.trace, {
                                metadata: { staleCleanup: true },
                                errorInfo: {
                                    exceptionType: "StaleTrace",
                                    message: "Trace exceeded maximum inactivity threshold and was forcibly ended",
                                    traceback: `Stale trace for sessionKey=${key}, inactive=${now - active.lastActivityAt}ms`,
                                },
                            }, `stale cleanup sessionKey=${key}`);
                            safeTraceEnd(active.trace, `stale cleanup sessionKey=${key}`);
                            forgetSubagentSpanHostsByActive(active);
                            activeTraces.delete(key);
                            forgetSessionCorrelation(key);
                        }
                    }
                    // Flush when no active traces remain.
                    if (activeTraces.size === 0) {
                        scheduleFlush("stale cleanup empty active traces");
                    }
                }, staleSweepIntervalMs)
                : null;
            // =====================================================================
            // Wire cleanup
            // =====================================================================
            traceDbg("service_cleanup", { node: "setting_up_cleanup" });
            cleanup = () => {
                traceDbg("service_cleanup", { node: "cleanup_invoked" });
                unsubscribeDiagnostics();
                if (sweepInterval) {
                    clearInterval(sweepInterval);
                }
            };
            traceDbg("service_lifecycle", { node: "service_start_complete" });
            log.info(`hootrix: exporting traces to project "${projectName}" (staleCleanup=${staleTraceCleanupEnabled ? "on" : "off"}, staleTimeoutMs=${staleTraceTimeoutMs}, staleSweepMs=${staleSweepIntervalMs}, flushRetryCount=${flushRetryCount}, flushRetryBaseDelayMs=${flushRetryBaseDelayMs})`);
        },
        async stop() {
            traceDbg("service_lifecycle", { node: "service_stop_begin", activeTracesCount: activeTraces.size });
            if (pluginInstanceReporter) {
                await pluginInstanceReporter.stop();
                pluginInstanceReporter = null;
            }
            cleanup?.();
            cleanup = null;
            // End all open traces before flushing.
            for (const [sessionKey, active] of activeTraces) {
                traceDbg("service_stop", { node: "closing_active_trace", sessionKey });
                closeActiveTrace(active, `service stop sessionKey=${sessionKey}`);
            }
            activeTraces.clear();
            sessionByAgentId.clear();
            lastActiveSessionKey = undefined;
            // Drain any already-scheduled flushes before the final flush.
            await flushQueue.catch(() => undefined);
            await attachmentUploader.waitForUploads();
            if (client) {
                await flushWithRetry("service stop");
                client = null;
            }
            toolResultPersistSanitizeEnabled = false;
            log.info(`hootrix: exporter metrics flushSuccesses=${exporterMetrics.flushSuccesses} flushFailures=${exporterMetrics.flushFailures} flushRetries=${exporterMetrics.flushRetries} traceUpdateErrors=${exporterMetrics.traceUpdateErrors} traceEndErrors=${exporterMetrics.traceEndErrors} spanUpdateErrors=${exporterMetrics.spanUpdateErrors} spanEndErrors=${exporterMetrics.spanEndErrors}`);
        },
    };
    return service;
}
