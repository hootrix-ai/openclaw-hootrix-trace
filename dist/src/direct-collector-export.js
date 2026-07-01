import { collectorFetch } from "./collector-fetch.js";
function buildCollectorHeaders(apiKey, workspaceName) {
    return {
        "Content-Type": "application/json",
        Accept: "application/json",
        "Comet-Workspace": workspaceName,
        "X-API-Key": apiKey,
        Authorization: `Bearer ${apiKey}`,
    };
}
function readEntityData(entity) {
    const bag = entity;
    return bag.data ?? {};
}
function toIso(value) {
    if (value instanceof Date) {
        return value.toISOString();
    }
    if (typeof value === "string" && value.trim().length > 0) {
        return value;
    }
    return undefined;
}
function omitUndefined(obj) {
    const out = {};
    for (const [key, value] of Object.entries(obj)) {
        if (value !== undefined) {
            out[key] = value;
        }
    }
    return out;
}
export function serializeTraceForBatch(data, overrides = {}) {
    const merged = { ...data, ...overrides };
    return omitUndefined({
        id: merged.id,
        start_time: toIso(merged.startTime ?? merged.start_time),
        end_time: toIso(merged.endTime ?? merged.end_time),
        source: merged.source ?? "sdk",
        name: merged.name,
        project_name: merged.projectName ?? merged.project_name,
        thread_id: merged.threadId ?? merged.thread_id,
        input: merged.input,
        output: merged.output,
        tags: merged.tags,
        metadata: merged.metadata,
    });
}
export function serializeSpanForBatch(data, overrides = {}) {
    const merged = { ...data, ...overrides };
    return omitUndefined({
        id: merged.id,
        start_time: toIso(merged.startTime ?? merged.start_time),
        end_time: toIso(merged.endTime ?? merged.end_time),
        source: merged.source ?? "sdk",
        name: merged.name,
        type: merged.type,
        model: merged.model,
        provider: merged.provider,
        project_name: merged.projectName ?? merged.project_name,
        trace_id: merged.traceId ?? merged.trace_id,
        parent_span_id: merged.parentSpanId ?? merged.parent_span_id,
        input: merged.input,
        output: merged.output,
        metadata: merged.metadata,
        usage: merged.usage,
    });
}
function collectorBaseUrl(baseUrl) {
    return baseUrl.replace(/\/+$/, "");
}
/** UI reads trace.input.prompt; omit history/systemPrompt to stay under collector body limits. */
export function buildSlimDirectExportInput(input) {
    if (!input || Object.keys(input).length === 0) {
        return undefined;
    }
    const out = {};
    if (typeof input.prompt === "string" && input.prompt.trim()) {
        out.prompt = input.prompt;
    }
    if (input.imagesCount !== undefined) {
        out.imagesCount = input.imagesCount;
    }
    if (Array.isArray(input.historyMessages) && input.historyMessages.length > 0) {
        out.historyMessageCount = input.historyMessages.length;
    }
    return Object.keys(out).length > 0 ? out : undefined;
}
function slimPatchPayload(patch) {
    const next = { ...patch };
    if (next.input !== undefined) {
        const slim = buildSlimDirectExportInput(next.input);
        if (slim) {
            next.input = slim;
        }
        else {
            delete next.input;
        }
    }
    return next;
}
/** Completion patches only need terminal fields; full tool output can exceed collector limits. */
export function buildMinimalSpanCompletionPatch(patch) {
    return omitUndefined({
        traceId: patch.traceId ?? patch.trace_id,
        type: patch.type,
        name: patch.name,
        endTime: patch.endTime ?? patch.end_time ?? new Date(),
    });
}
function patchHasHeavyDirectExportFields(patch) {
    return patch.output != null || patch.input != null || patch.metadata != null;
}
async function postTraceBatch(config, traces, spans = []) {
    const url = `${collectorBaseUrl(config.baseUrl)}/v1/private/traces/batch`;
    return collectorFetch(url, {
        method: "POST",
        headers: buildCollectorHeaders(config.apiKey, config.workspaceName),
        body: JSON.stringify({ traces, spans }),
    });
}
async function postSpanBatch(config, spans) {
    const url = `${collectorBaseUrl(config.baseUrl)}/v1/private/spans/batch`;
    return collectorFetch(url, {
        method: "POST",
        headers: buildCollectorHeaders(config.apiKey, config.workspaceName),
        body: JSON.stringify({ spans }),
    });
}
export async function directBootstrapTraceAndSpan(params) {
    const traceData = readEntityData(params.trace);
    const slimInput = buildSlimDirectExportInput(params.input ?? traceData.input);
    const tracePayload = serializeTraceForBatch(traceData, {
        threadId: params.threadId,
        input: slimInput,
        tags: params.tags ?? traceData.tags,
    });
    let spanId;
    let spanPayload;
    if (params.llmSpan) {
        const spanData = readEntityData(params.llmSpan);
        spanId = typeof spanData.id === "string" ? spanData.id : undefined;
        spanPayload = serializeSpanForBatch(spanData, {
            traceId: tracePayload.id,
        });
    }
    let traceRes = await postTraceBatch(params.config, [tracePayload]);
    if (!traceRes.ok && slimInput && traceRes.status >= 500) {
        const minimalTrace = serializeTraceForBatch(traceData, {
            threadId: params.threadId,
            tags: params.tags ?? traceData.tags,
        });
        traceRes = await postTraceBatch(params.config, [minimalTrace]);
    }
    let spanStatus;
    if (spanPayload && traceRes.ok) {
        const spanRes = await postSpanBatch(params.config, [spanPayload]);
        spanStatus = spanRes.status;
    }
    const traceId = typeof tracePayload.id === "string" ? tracePayload.id : undefined;
    const ok = traceRes.ok && (spanPayload == null || (spanStatus != null && spanStatus >= 200 && spanStatus < 300));
    return { ok, status: traceRes.status, traceId, spanId };
}
export async function directPatchTrace(params) {
    const url = `${collectorBaseUrl(params.config.baseUrl)}/v1/private/traces/${encodeURIComponent(params.traceId)}`;
    const slimPatch = slimPatchPayload(params.patch);
    let body = serializeTraceForBatch({}, slimPatch);
    delete body.id;
    delete body.start_time;
    let res = await collectorFetch(url, {
        method: "PATCH",
        headers: buildCollectorHeaders(params.config.apiKey, params.config.workspaceName),
        body: JSON.stringify(body),
    });
    if (!res.ok && res.status >= 500 && slimPatch.input) {
        const fallbackPatch = { ...slimPatch };
        delete fallbackPatch.input;
        body = serializeTraceForBatch({}, fallbackPatch);
        delete body.id;
        delete body.start_time;
        res = await collectorFetch(url, {
            method: "PATCH",
            headers: buildCollectorHeaders(params.config.apiKey, params.config.workspaceName),
            body: JSON.stringify(body),
        });
    }
    return { ok: res.ok, status: res.status };
}
export async function directBootstrapSpan(params) {
    const spanData = readEntityData(params.span);
    const spanPayload = serializeSpanForBatch(spanData, {
        traceId: params.traceId ?? spanData.traceId,
    });
    const res = await postSpanBatch(params.config, [spanPayload]);
    return { ok: res.ok, status: res.status };
}
export async function directPatchSpan(params) {
    const url = `${collectorBaseUrl(params.config.baseUrl)}/v1/private/spans/${encodeURIComponent(params.spanId)}`;
    const slimPatch = slimPatchPayload(params.patch);
    let body = serializeSpanForBatch({}, slimPatch);
    delete body.id;
    let res = await collectorFetch(url, {
        method: "PATCH",
        headers: buildCollectorHeaders(params.config.apiKey, params.config.workspaceName),
        body: JSON.stringify(body),
    });
    // #region agent log
    fetch("http://127.0.0.1:7476/ingest/4d7ed9c5-7cd3-4ac7-9c9d-952f6e3c27eb", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "cc096c" },
        body: JSON.stringify({
            sessionId: "cc096c",
            location: "direct-collector-export.ts:directPatchSpan",
            message: "direct span patch result",
            data: {
                spanId: params.spanId,
                status: res.status,
                ok: res.ok,
                hasTraceId: body.trace_id != null,
                hasEndTime: body.end_time != null,
                hasStartTime: body.start_time != null,
                hasUsage: body.usage != null,
                bodyBytes: JSON.stringify(body).length,
                retriedMinimal: false,
            },
            timestamp: Date.now(),
            hypothesisId: "H13-H14",
            runId: "post-fix-4",
        }),
    }).catch(() => { });
    // #endregion
    if (!res.ok && patchHasHeavyDirectExportFields(slimPatch)) {
        const minimalPatch = buildMinimalSpanCompletionPatch(slimPatch);
        body = serializeSpanForBatch({}, minimalPatch);
        delete body.id;
        res = await collectorFetch(url, {
            method: "PATCH",
            headers: buildCollectorHeaders(params.config.apiKey, params.config.workspaceName),
            body: JSON.stringify(body),
        });
        // #region agent log
        fetch("http://127.0.0.1:7476/ingest/4d7ed9c5-7cd3-4ac7-9c9d-952f6e3c27eb", {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "cc096c" },
            body: JSON.stringify({
                sessionId: "cc096c",
                location: "direct-collector-export.ts:directPatchSpan",
                message: "direct span patch minimal retry",
                data: {
                    spanId: params.spanId,
                    status: res.status,
                    ok: res.ok,
                    hasTraceId: body.trace_id != null,
                    hasEndTime: body.end_time != null,
                    hasStartTime: body.start_time != null,
                    hasUsage: body.usage != null,
                    bodyBytes: JSON.stringify(body).length,
                    retriedMinimal: true,
                },
                timestamp: Date.now(),
                hypothesisId: "H13-H14",
                runId: "post-fix-4",
            }),
        }).catch(() => { });
        // #endregion
    }
    if (!res.ok && res.status >= 500 && slimPatch.input) {
        const fallbackPatch = { ...slimPatch };
        delete fallbackPatch.input;
        body = serializeSpanForBatch({}, fallbackPatch);
        delete body.id;
        res = await collectorFetch(url, {
            method: "PATCH",
            headers: buildCollectorHeaders(params.config.apiKey, params.config.workspaceName),
            body: JSON.stringify(body),
        });
    }
    return { ok: res.ok, status: res.status };
}
