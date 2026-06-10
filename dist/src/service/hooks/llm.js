import { OPIK_CREATED_FROM, } from "../constants.js";
import { asNonEmptyString, inferCanonicalThreadKey, mapUsageToOpikTokens, normalizeProvider, resolveAgentId, channelMetadataFields, logChannelResolve, resolveChannelId, resolveChannelName, resolveEffectiveOpikSessionKey, resolveTrigger, resolveLlmEndpointMeta, resolveTraceId, } from "../helpers.js";
import { classificationMetadata, resolveTraceClassification, } from "../trace-classification.js";
import { sanitizeStringForOpik, sanitizeValueForOpik } from "../payload-sanitizer.js";
import { experimentMetadataFields, parseExperimentIdFromTags } from "../sage-experiment.js";
import { traceDbg } from "../../trace-logger.js";
/**
 * OpenClaw may only provide a per-run `sessionId` (UUID) on the first LLM call, then add a stable
 * `sessionKey` (e.g. agent:…:feishu:…). Without migration, the fallback `llm_input` would open a
 * second Opik trace for the same user turn.
 */
function migrateVolatileSessionKeyIfNeeded(d, agentCtxObj, eventSessionId) {
    const inferred = inferCanonicalThreadKey(agentCtxObj);
    const stableKey = inferred ?? asNonEmptyString(agentCtxObj.sessionKey);
    const volatileKey = asNonEmptyString(eventSessionId) ?? asNonEmptyString(agentCtxObj.sessionId);
    if (!stableKey || !volatileKey || stableKey === volatileKey) {
        return;
    }
    const moving = d.activeTraces.get(volatileKey);
    if (!moving || d.activeTraces.has(stableKey)) {
        return;
    }
    d.activeTraces.delete(volatileKey);
    d.activeTraces.set(stableKey, moving);
    d.rememberSessionCorrelation(stableKey, resolveAgentId(agentCtxObj));
}
export function registerLlmHooks(deps) {
    traceDbg("hooks_registration", { node: "llm_hooks_registering" });
    deps.api.on("llm_input", (event, agentCtx) => {
        traceDbg("hook_event", { node: "llm_input_start", model: event.model });
        const client = deps.getClient();
        const agentCtxObj = agentCtx;
        migrateVolatileSessionKeyIfNeeded(deps, agentCtxObj, asNonEmptyString(event.sessionId));
        const sessionKey = resolveEffectiveOpikSessionKey(agentCtxObj, asNonEmptyString(event.sessionId)) ??
            deps.resolveSessionKey(agentCtxObj, asNonEmptyString(event.sessionId));
        if (!client) {
            traceDbg("hook_event", { node: "llm_input_no_client" });
            return;
        }
        if (!sessionKey) {
            traceDbg("hook_event", { node: "llm_input_missing_session_key" });
            deps.warn("opik: llm_input missing sessionKey");
            return;
        }
        traceDbg("hook_event", { node: "llm_input_session_key", sessionKey });
        deps.rememberSessionCorrelation(sessionKey, resolveAgentId(agentCtxObj));
        const normalizedProvider = normalizeProvider(event.provider) ?? event.provider;
        const channelId = resolveChannelId(agentCtxObj);
        const channelName = resolveChannelName(agentCtxObj, sessionKey);
        const llmChannelMeta = channelMetadataFields({ channelId, channelName });
        logChannelResolve("llm_input", sessionKey, agentCtxObj, {
            channelId,
            channelName,
            metadata: llmChannelMeta,
        });
        const trigger = resolveTrigger(agentCtxObj);
        const projectName = deps.getProjectName();
        const tags = deps.getTags();
        const experimentId = parseExperimentIdFromTags(tags);
        const classification = resolveTraceClassification({
            sessionKey,
            runId: asNonEmptyString(event.runId),
            trigger,
            prompt: typeof event.prompt === "string" ? event.prompt : undefined,
            systemPrompt: typeof event.systemPrompt === "string" ? event.systemPrompt : undefined,
        });
        const kindMeta = classificationMetadata(classification);
        const { capabilities } = classification;
        const sanitizedSharedLlmInput = sanitizeValueForOpik({
            prompt: event.prompt,
            systemPrompt: event.systemPrompt,
            imagesCount: event.imagesCount,
        });
        // 检查是否有 pending finalize（延迟策略），取消它以复用 trace
        const hasCancelled = deps.cancelPendingFinalize(sessionKey);
        if (hasCancelled && capabilities.allowFinalizeReuse) {
            traceDbg("trace_fallback", { node: "cancelled_finalize_reusing_trace", sessionKey, model: event.model });
        }
        else if (hasCancelled && !capabilities.allowFinalizeReuse) {
            traceDbg("trace_fallback", { node: "cancelled_finalize_new_independent_trace", sessionKey, model: event.model, traceType: classification.traceType });
        }
        let existing = deps.activeTraces.get(sessionKey);
        let parentTurnIdForAsync;
        if (capabilities.independentTrace && existing) {
            parentTurnIdForAsync = existing.traceId ?? resolveTraceId(existing.trace);
            traceDbg("trace_lifecycle", { node: "llm_input_replace_independent_trace", sessionKey, traceType: classification.traceType });
            deps.closeActiveTrace(existing, `${classification.traceType} follow-up sessionKey=${sessionKey}`);
            deps.activeTraces.delete(sessionKey);
            existing = undefined;
        }
        let trace;
        if (existing && capabilities.allowFinalizeReuse) {
            traceDbg("trace_lifecycle", { node: "llm_input_existing_trace", sessionKey, isFallback: hasCancelled });
            existing.agentEnd = undefined;
            // 清除之前的 LLM 错误状态，新调用可能是 fallback 成功场景
            if (existing.llmError) {
                traceDbg("trace_state", { node: "llm_input_clearing_previous_error", sessionKey, previousError: existing.llmError.message });
                existing.llmError = undefined;
            }
            trace = existing.trace;
            if (existing.llmSpan) {
                deps.safeSpanEnd(existing.llmSpan, `replace active llm span sessionKey=${sessionKey}`);
                existing.llmSpan = null;
            }
        }
        else {
            traceDbg("trace_lifecycle", { node: "llm_input_creating_trace", sessionKey, model: event.model, traceType: classification.traceType });
            const lineage = classification.traceType === "subagent" ? deps.getSubagentLineage(sessionKey) : undefined;
            const parentTurnId = lineage?.parentTurnId ??
                (classification.traceType === "async_command" || classification.traceType === "system"
                    ? parentTurnIdForAsync
                    : undefined);
            try {
                trace = client.trace({
                    name: `${event.model} · ${channelName ?? channelId ?? "unknown"}`,
                    projectName,
                    threadId: sessionKey,
                    input: sanitizedSharedLlmInput,
                    metadata: {
                        created_from: OPIK_CREATED_FROM,
                        provider: normalizedProvider,
                        model: event.model,
                        sessionId: event.sessionId,
                        runId: event.runId,
                        agentId: resolveAgentId(agentCtxObj),
                        ...kindMeta,
                        ...llmChannelMeta,
                        ...(trigger ? { trigger } : {}),
                        ...(parentTurnId ? { parent_turn_id: parentTurnId } : {}),
                        ...(lineage?.anchorParentThreadId
                            ? { anchor_parent_thread_id: lineage.anchorParentThreadId }
                            : {}),
                        ...(classification.traceType === "subagent" ? { subagent_thread_id: sessionKey } : {}),
                        ...experimentMetadataFields(experimentId),
                    },
                    tags: tags.length > 0 ? tags : undefined,
                });
                if (lineage) {
                    deps.forgetSubagentLineage(sessionKey);
                }
                traceDbg("trace_lifecycle", {
                    node: "llm_input_trace_created",
                    sessionKey,
                    channelName,
                    channelId,
                });
            }
            catch (err) {
                traceDbg("trace_error", { node: "llm_input_trace_creation_failed", sessionKey, error: deps.formatError(err) });
                deps.warn(`opik: trace creation failed (sessionKey=${sessionKey}): ${deps.formatError(err)}`);
                return;
            }
        }
        let llmSpan = null;
        const llmEndpointMeta = resolveLlmEndpointMeta(event);
        try {
            const sanitizedHistoryMessages = sanitizeValueForOpik(event.historyMessages);
            const sanitizedLlmInput = {
                ...sanitizedSharedLlmInput,
                ...(sanitizedHistoryMessages === undefined
                    ? {}
                    : { historyMessages: sanitizedHistoryMessages }),
            };
            traceDbg("trace_data", { node: "llm_input_span_input", sessionKey, inputKeys: Object.keys(sanitizedLlmInput) });
            llmSpan = trace.span({
                name: typeof event.model === "string" && event.model.trim().length > 0
                    ? event.model.trim()
                    : "llm",
                type: "llm",
                model: event.model,
                provider: normalizedProvider,
                input: sanitizedLlmInput,
                metadata: Object.keys(llmEndpointMeta).length > 0 ? llmEndpointMeta : undefined,
            });
            traceDbg("trace_lifecycle", { node: "llm_input_span_created", sessionKey, spanName: event.model });
        }
        catch (err) {
            traceDbg("trace_error", { node: "llm_input_span_creation_failed", sessionKey, error: deps.formatError(err) });
            deps.warn(`opik: llm span creation failed (sessionKey=${sessionKey}): ${deps.formatError(err)}`);
        }
        const now = Date.now();
        const resolvedTraceId = resolveTraceId(trace);
        if (existing) {
            traceDbg("trace_state", { node: "llm_input_updating_existing_trace", sessionKey, hasLlmSpan: !!llmSpan });
            deps.applyContextMeta(existing, agentCtxObj, sessionKey);
            existing.traceId = resolvedTraceId ?? existing.traceId;
            existing.llmSpan = llmSpan;
            existing.lastActivityAt = now;
            existing.model = event.model;
            existing.provider = normalizedProvider;
            if (channelId)
                existing.channelId = channelId;
            if (channelName)
                existing.channelName = channelName;
            if (trigger)
                existing.trigger = trigger;
            if (experimentId)
                existing.experimentId = experimentId;
            traceDbg("trace_state", { node: "llm_input_existing_trace_updated", sessionKey, traceCount: deps.activeTraces.size });
        }
        else {
            traceDbg("trace_state", { node: "llm_input_creating_new_trace_entry", sessionKey, model: event.model, agentId: resolveAgentId(agentCtxObj) });
            deps.activeTraces.set(sessionKey, {
                trace,
                traceId: resolvedTraceId,
                llmSpan,
                toolSpans: new Map(),
                subagentSpans: new Map(),
                startedAt: now,
                lastActivityAt: now,
                costMeta: {},
                usage: {},
                model: event.model,
                provider: normalizedProvider,
                agentId: resolveAgentId(agentCtxObj),
                channelId,
                channelName,
                trigger,
                experimentId,
            });
            traceDbg("trace_state", { node: "llm_input_new_trace_entry_created", sessionKey, traceCount: deps.activeTraces.size });
        }
        const attachmentPayloads = [event.prompt, Array.isArray(event.historyMessages) ? event.historyMessages.at(-1) : undefined].filter(Boolean);
        traceDbg("attachment", { node: "llm_input_scheduling_attachments", sessionKey, payloadCount: attachmentPayloads.length });
        deps.scheduleMediaAttachmentUploads({
            entityType: "trace",
            entity: trace,
            projectName,
            reason: `llm_input sessionKey=${sessionKey}`,
            payloads: attachmentPayloads,
        });
        traceDbg("hook_event", { node: "llm_input_complete", sessionKey, model: event.model, activeTracesCount: deps.activeTraces.size });
    });
    deps.api.on("llm_output", (event, agentCtx) => {
        traceDbg("hook_event", { node: "llm_output_start", model: event.model, hasUsage: !!event.usage });
        const client = deps.getClient();
        const agentCtxObj = agentCtx;
        const ev = event;
        migrateVolatileSessionKeyIfNeeded(deps, agentCtxObj, asNonEmptyString(ev.sessionId));
        const sessionKey = resolveEffectiveOpikSessionKey(agentCtxObj, asNonEmptyString(ev.sessionId)) ??
            deps.resolveSessionKey(agentCtxObj, asNonEmptyString(ev.sessionId));
        if (!client) {
            traceDbg("hook_event", { node: "llm_output_no_client" });
            return;
        }
        if (!sessionKey) {
            traceDbg("hook_event", { node: "llm_output_missing_session_key" });
            deps.warn("opik: llm_output missing sessionKey");
            return;
        }
        traceDbg("hook_event", { node: "llm_output_session_key_resolved", sessionKey });
        deps.rememberSessionCorrelation(sessionKey, resolveAgentId(agentCtxObj));
        traceDbg("trace_state", { node: "llm_output_session_correlated", sessionKey, agentId: resolveAgentId(agentCtxObj) });
        const normalizedProvider = normalizeProvider(event.provider) ?? event.provider;
        const active = deps.activeTraces.get(sessionKey);
        if (!active?.llmSpan) {
            traceDbg("trace_error", { node: "llm_output_no_active_span", sessionKey, hasTrace: !!active, hasLlmSpan: !!active?.llmSpan, activeTracesCount: deps.activeTraces.size, activeTracesKeys: Array.from(deps.activeTraces.keys()).slice(0, 10) });
            deps.warn(`opik: llm_output missing active llm span sessionKey=${sessionKey} hasTrace=${Boolean(active)} hasLlmSpan=${Boolean(active?.llmSpan)}`);
            return;
        }
        traceDbg("trace_state", { node: "llm_output_found_active_span", sessionKey, spanExists: true });
        deps.applyContextMeta(active, agentCtx, sessionKey);
        active.lastActivityAt = Date.now();
        traceDbg("trace_state", { node: "llm_output_context_applied", sessionKey, lastActivityAt: active.lastActivityAt });
        traceDbg("trace_data", { node: "llm_output_sanitizing", sessionKey, assistantTextsCount: event.assistantTexts?.length });
        const sanitizedLlmOutput = sanitizeValueForOpik({
            assistantTexts: event.assistantTexts,
            lastAssistant: event.lastAssistant,
        });
        const sanitizedAssistantTexts = Array.isArray(sanitizedLlmOutput.assistantTexts)
            ? sanitizedLlmOutput.assistantTexts.filter((item) => typeof item === "string")
            : [];
        traceDbg("trace_data", { node: "llm_output_sanitized", sessionKey, sanitizedTextsCount: sanitizedAssistantTexts.length });
        const llmSpanName = typeof event.model === "string" && event.model.trim().length > 0
            ? event.model.trim()
            : typeof active.model === "string" && active.model.trim().length > 0
                ? active.model.trim()
                : "llm";
        const opikUsage = mapUsageToOpikTokens(event.usage);
        // 检测 LLM 调用是否失败
        const lastAssistant = event.lastAssistant;
        const stopReason = lastAssistant?.stopReason;
        const errorMessage = lastAssistant?.errorMessage;
        const hasError = !!event.error || stopReason === "error" || !!errorMessage;
        const errorInfo = hasError
            ? {
                exceptionType: "LLMError",
                message: sanitizeStringForOpik(event.error || errorMessage || `stopReason: ${stopReason || "unknown"}`),
                traceback: sanitizeStringForOpik(JSON.stringify({
                    error: event.error,
                    stopReason,
                    errorMessage,
                    model: event.model,
                    provider: event.provider,
                })),
            }
            : undefined;
        traceDbg("trace_data", {
            node: "llm_output_span_update",
            sessionKey,
            spanName: llmSpanName,
            usage: opikUsage,
            hasError,
            stopReason,
            errorMessage: errorMessage?.slice(0, 100),
        });
        const spanUpdatePayload = {
            name: llmSpanName,
            type: "llm",
            output: sanitizedLlmOutput,
            usage: opikUsage,
            model: event.model,
            provider: normalizedProvider,
        };
        // 如果有错误，添加 errorInfo 标记 span 为失败状态
        if (errorInfo) {
            spanUpdatePayload.errorInfo = errorInfo;
            traceDbg("trace_data", { node: "llm_output_error_detected", sessionKey, errorMessage: errorInfo.message });
            // 保存 LLM 错误信息到 active，以便在 trace finalize 时传递错误状态
            active.llmError = {
                message: errorInfo.message,
                details: errorInfo.traceback,
                stopReason,
                model: event.model,
                provider: event.provider,
            };
            traceDbg("trace_state", { node: "llm_error_saved_to_active", sessionKey, model: event.model });
        }
        deps.safeSpanUpdate(active.llmSpan, spanUpdatePayload, `llm_output sessionKey=${sessionKey}`);
        traceDbg("trace_lifecycle", { node: "llm_output_span_updated", sessionKey, hasError });
        active.output = {
            output: sanitizedAssistantTexts.join("\n\n"),
            lastAssistant: sanitizedLlmOutput.lastAssistant,
        };
        if (event.usage) {
            active.usage = { ...active.usage, ...event.usage };
            traceDbg("trace_data", { node: "llm_output_usage_accumulated", sessionKey, usage: active.usage });
        }
        active.model = event.model;
        active.provider = normalizedProvider;
        traceDbg("trace_lifecycle", { node: "llm_output_ending_span", sessionKey });
        deps.safeSpanEnd(active.llmSpan, `llm_output sessionKey=${sessionKey}`);
        active.llmSpan = null;
        traceDbg("hook_event", { node: "llm_output_complete", sessionKey, model: event.model, outputLength: sanitizedAssistantTexts.join("\n\n").length });
    });
    traceDbg("hooks_registration", { node: "llm_hooks_registered" });
}
