import { HOOTRIX_CREATED_FROM, } from "../constants.js";
import { asNonEmptyString, inferCanonicalThreadKey, mapUsageToHootrixTokens, normalizeProvider, resolveAgentId, channelMetadataFields, logChannelResolve, resolveChannelId, resolveChannelName, resolveEffectiveHootrixSessionKey, resolveTrigger, resolveLlmEndpointMeta, resolveTraceId, } from "../helpers.js";
import { classificationMetadata, resolveTraceClassification, } from "../trace-classification.js";
import { buildSanitizedLlmInputFromEvent, sanitizeStringForHootrix, sanitizeValueForHootrix, } from "../payload-sanitizer.js";
import { directBootstrapTraceAndSpan, directPatchSpan, directPatchTrace, } from "../../direct-collector-export.js";
import { traceDbg } from "../../trace-logger.js";
/**
 * OpenClaw may only provide a per-run `sessionId` (UUID) on the first LLM call, then add a stable
 * `sessionKey` (e.g. agent:…:feishu:…). Without migration, the fallback `llm_input` would open a
 * second Hootrix trace for the same user turn.
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
    deps.api.on("llm_input", async (event, agentCtx) => {
        traceDbg("hook_event", { node: "llm_input_start", model: event.model });
        const client = deps.getClient();
        const agentCtxObj = agentCtx;
        migrateVolatileSessionKeyIfNeeded(deps, agentCtxObj, asNonEmptyString(event.sessionId));
        const sessionKey = resolveEffectiveHootrixSessionKey(agentCtxObj, asNonEmptyString(event.sessionId)) ??
            deps.resolveSessionKey(agentCtxObj, asNonEmptyString(event.sessionId));
        if (!client) {
            traceDbg("hook_event", { node: "llm_input_no_client" });
            return;
        }
        if (!sessionKey) {
            traceDbg("hook_event", { node: "llm_input_missing_session_key" });
            deps.warn("hootrix: llm_input missing sessionKey");
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
        const classification = resolveTraceClassification({
            sessionKey,
            runId: asNonEmptyString(event.runId),
            trigger,
            prompt: typeof event.prompt === "string" ? event.prompt : undefined,
            systemPrompt: typeof event.systemPrompt === "string" ? event.systemPrompt : undefined,
        });
        const kindMeta = classificationMetadata(classification);
        const { capabilities } = classification;
        const sanitizedLlmInput = buildSanitizedLlmInputFromEvent(event);
        const llmInputForExport = Object.keys(sanitizedLlmInput).length > 0 ? sanitizedLlmInput : undefined;
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
                    input: llmInputForExport,
                    metadata: {
                        created_from: HOOTRIX_CREATED_FROM,
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
                deps.warn(`hootrix: trace creation failed (sessionKey=${sessionKey}): ${deps.formatError(err)}`);
                return;
            }
        }
        let llmSpan = null;
        const llmEndpointMeta = resolveLlmEndpointMeta(event);
        try {
            traceDbg("trace_data", { node: "llm_input_span_input", sessionKey, inputKeys: Object.keys(sanitizedLlmInput) });
            llmSpan = trace.span({
                name: typeof event.model === "string" && event.model.trim().length > 0
                    ? event.model.trim()
                    : "llm",
                type: "llm",
                model: event.model,
                provider: normalizedProvider,
                input: llmInputForExport,
                metadata: Object.keys(llmEndpointMeta).length > 0 ? llmEndpointMeta : undefined,
            });
            traceDbg("trace_lifecycle", { node: "llm_input_span_created", sessionKey, spanName: event.model });
            if (llmSpan && llmInputForExport) {
                deps.safeSpanUpdate(llmSpan, { input: llmInputForExport }, `llm_input span input sessionKey=${sessionKey}`);
            }
        }
        catch (err) {
            traceDbg("trace_error", { node: "llm_input_span_creation_failed", sessionKey, error: deps.formatError(err) });
            deps.warn(`hootrix: llm span creation failed (sessionKey=${sessionKey}): ${deps.formatError(err)}`);
        }
        const now = Date.now();
        const llmSpanStartedAt = now;
        const resolvedTraceId = resolveTraceId(trace);
        if (existing) {
            if (llmInputForExport) {
                deps.safeTraceUpdate(trace, { input: llmInputForExport }, `llm_input trace input sessionKey=${sessionKey}`);
            }
            traceDbg("trace_state", { node: "llm_input_updating_existing_trace", sessionKey, hasLlmSpan: !!llmSpan });
            deps.applyContextMeta(existing, agentCtxObj, sessionKey);
            existing.traceId = resolvedTraceId ?? existing.traceId;
            existing.llmSpan = llmSpan;
            existing.llmSpanStartedAt = llmSpanStartedAt;
            existing.lastActivityAt = now;
            existing.lastLlmInput = llmInputForExport;
            existing.model = event.model;
            existing.provider = normalizedProvider;
            if (channelId)
                existing.channelId = channelId;
            if (channelName)
                existing.channelName = channelName;
            if (trigger)
                existing.trigger = trigger;
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
                llmSpanStartedAt,
                lastActivityAt: now,
                costMeta: {},
                usage: {},
                model: event.model,
                provider: normalizedProvider,
                agentId: resolveAgentId(agentCtxObj),
                channelId,
                channelName,
                trigger,
                lastLlmInput: llmInputForExport,
            });
            traceDbg("trace_state", { node: "llm_input_new_trace_entry_created", sessionKey, traceCount: deps.activeTraces.size });
        }
        const exportCfg = deps.getCollectorExportConfig();
        if (exportCfg) {
            try {
                await directBootstrapTraceAndSpan({
                    config: exportCfg,
                    trace,
                    llmSpan,
                    threadId: sessionKey,
                    input: llmInputForExport,
                    tags: tags.length > 0 ? tags : undefined,
                });
            }
            catch (err) {
                deps.warn(`hootrix: direct trace bootstrap failed (sessionKey=${sessionKey}): ${deps.formatError(err)}`);
            }
        }
        const attachmentPayloads = [
            event.prompt,
            ...(Array.isArray(event.historyMessages) ? event.historyMessages : []),
        ].filter(Boolean);
        traceDbg("attachment", { node: "llm_input_scheduling_attachments", sessionKey, payloadCount: attachmentPayloads.length });
        if (llmSpan) {
            deps.scheduleMediaAttachmentUploads({
                entityType: "span",
                entity: llmSpan,
                projectName,
                traceId: resolvedTraceId,
                reason: `llm_input sessionKey=${sessionKey}`,
                payloads: attachmentPayloads,
            });
        }
        await deps.awaitFlush(`llm_input sessionKey=${sessionKey}`);
        if (llmInputForExport) {
            deps.safeTraceUpdate(trace, { threadId: sessionKey, input: llmInputForExport }, `llm_input post-flush trace patch sessionKey=${sessionKey}`);
            if (llmSpan) {
                deps.safeSpanUpdate(llmSpan, { type: "llm", input: llmInputForExport }, `llm_input post-flush span patch sessionKey=${sessionKey}`);
            }
        }
        await deps.awaitFlush(`llm_input post-patch sessionKey=${sessionKey}`);
        if (exportCfg && llmInputForExport && resolvedTraceId) {
            try {
                await directPatchTrace({
                    config: exportCfg,
                    traceId: resolvedTraceId,
                    patch: { threadId: sessionKey, input: llmInputForExport },
                });
            }
            catch (err) {
                deps.warn(`hootrix: direct trace patch after llm_input failed (sessionKey=${sessionKey}): ${deps.formatError(err)}`);
            }
        }
        traceDbg("hook_event", { node: "llm_input_complete", sessionKey, model: event.model, activeTracesCount: deps.activeTraces.size });
    });
    deps.api.on("llm_output", async (event, agentCtx) => {
        traceDbg("hook_event", { node: "llm_output_start", model: event.model, hasUsage: !!event.usage });
        const client = deps.getClient();
        const agentCtxObj = agentCtx;
        const ev = event;
        migrateVolatileSessionKeyIfNeeded(deps, agentCtxObj, asNonEmptyString(ev.sessionId));
        const sessionKey = resolveEffectiveHootrixSessionKey(agentCtxObj, asNonEmptyString(ev.sessionId)) ??
            deps.resolveSessionKey(agentCtxObj, asNonEmptyString(ev.sessionId));
        if (!client) {
            traceDbg("hook_event", { node: "llm_output_no_client" });
            return;
        }
        if (!sessionKey) {
            traceDbg("hook_event", { node: "llm_output_missing_session_key" });
            deps.warn("hootrix: llm_output missing sessionKey");
            return;
        }
        traceDbg("hook_event", { node: "llm_output_session_key_resolved", sessionKey });
        deps.rememberSessionCorrelation(sessionKey, resolveAgentId(agentCtxObj));
        traceDbg("trace_state", { node: "llm_output_session_correlated", sessionKey, agentId: resolveAgentId(agentCtxObj) });
        const normalizedProvider = normalizeProvider(event.provider) ?? event.provider;
        const active = deps.activeTraces.get(sessionKey);
        if (!active?.llmSpan) {
            traceDbg("trace_error", { node: "llm_output_no_active_span", sessionKey, hasTrace: !!active, hasLlmSpan: !!active?.llmSpan, activeTracesCount: deps.activeTraces.size, activeTracesKeys: Array.from(deps.activeTraces.keys()).slice(0, 10) });
            deps.warn(`hootrix: llm_output missing active llm span sessionKey=${sessionKey} hasTrace=${Boolean(active)} hasLlmSpan=${Boolean(active?.llmSpan)}`);
            return;
        }
        traceDbg("trace_state", { node: "llm_output_found_active_span", sessionKey, spanExists: true });
        await deps.awaitFlush(`llm_output pre-update sessionKey=${sessionKey}`);
        deps.applyContextMeta(active, agentCtx, sessionKey);
        active.lastActivityAt = Date.now();
        traceDbg("trace_state", { node: "llm_output_context_applied", sessionKey, lastActivityAt: active.lastActivityAt });
        const llmInputForExport = active.lastLlmInput;
        if (llmInputForExport) {
            deps.safeTraceUpdate(active.trace, { input: llmInputForExport }, `llm_output trace input sessionKey=${sessionKey}`);
        }
        traceDbg("trace_data", { node: "llm_output_sanitizing", sessionKey, assistantTextsCount: event.assistantTexts?.length });
        const sanitizedLlmOutput = sanitizeValueForHootrix({
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
        const hootrixUsage = mapUsageToHootrixTokens(event.usage);
        // 检测 LLM 调用是否失败
        const lastAssistant = event.lastAssistant;
        const stopReason = lastAssistant?.stopReason;
        const errorMessage = lastAssistant?.errorMessage;
        const hasError = !!event.error || stopReason === "error" || !!errorMessage;
        const errorInfo = hasError
            ? {
                exceptionType: "LLMError",
                message: sanitizeStringForHootrix(event.error || errorMessage || `stopReason: ${stopReason || "unknown"}`),
                traceback: sanitizeStringForHootrix(JSON.stringify({
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
            usage: hootrixUsage,
            hasError,
            stopReason,
            errorMessage: errorMessage?.slice(0, 100),
        });
        const spanUpdatePayload = {
            name: llmSpanName,
            type: "llm",
            ...(llmInputForExport ? { input: llmInputForExport } : {}),
            output: sanitizedLlmOutput,
            usage: hootrixUsage,
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
        const llmSpanRef = active.llmSpan;
        const llmSpanId = llmSpanRef.data?.id;
        const llmSpanStartTime = (() => {
            const sdkStart = llmSpanRef.data?.startTime;
            if (sdkStart instanceof Date) {
                return sdkStart;
            }
            if (active.llmSpanStartedAt != null) {
                return new Date(active.llmSpanStartedAt);
            }
            return undefined;
        })();
        const exportCfg = deps.getCollectorExportConfig();
        deps.safeSpanUpdate(llmSpanRef, spanUpdatePayload, `llm_output sessionKey=${sessionKey}`);
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
        deps.safeSpanEnd(llmSpanRef, `llm_output sessionKey=${sessionKey}`);
        active.llmSpan = null;
        active.llmSpanStartedAt = undefined;
        if (exportCfg && llmSpanId) {
            try {
                // #region agent log
                fetch("http://127.0.0.1:7476/ingest/4d7ed9c5-7cd3-4ac7-9c9d-952f6e3c27eb", {
                    method: "POST",
                    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "cc096c" },
                    body: JSON.stringify({
                        sessionId: "cc096c",
                        location: "llm.ts:llm_output_direct_patch",
                        message: "llm completion patch payload",
                        data: {
                            spanId: llmSpanId,
                            hasStartTime: llmSpanStartTime != null,
                            hasUsage: hootrixUsage != null,
                            usageKeys: hootrixUsage ? Object.keys(hootrixUsage) : [],
                        },
                        timestamp: Date.now(),
                        hypothesisId: "H13-H14",
                        runId: "post-fix-4",
                    }),
                }).catch(() => { });
                // #endregion
                await directPatchSpan({
                    config: exportCfg,
                    spanId: llmSpanId,
                    patch: {
                        ...spanUpdatePayload,
                        traceId: active.traceId ?? resolveTraceId(active.trace),
                        startTime: llmSpanStartTime,
                        endTime: new Date(),
                    },
                });
            }
            catch (err) {
                deps.warn(`hootrix: direct llm span completion patch failed (sessionKey=${sessionKey}): ${deps.formatError(err)}`);
            }
        }
        await deps.awaitFlush(`llm_output sessionKey=${sessionKey}`);
        const traceId = active.traceId ?? resolveTraceId(active.trace);
        if (exportCfg && traceId && llmInputForExport) {
            try {
                await directPatchTrace({
                    config: exportCfg,
                    traceId,
                    patch: { threadId: sessionKey, input: llmInputForExport, output: active.output },
                });
            }
            catch (err) {
                deps.warn(`hootrix: direct trace patch after llm_output failed (sessionKey=${sessionKey}): ${deps.formatError(err)}`);
            }
        }
        traceDbg("hook_event", { node: "llm_output_complete", sessionKey, model: event.model, outputLength: sanitizedAssistantTexts.join("\n\n").length });
    });
    traceDbg("hooks_registration", { node: "llm_hooks_registered" });
}
