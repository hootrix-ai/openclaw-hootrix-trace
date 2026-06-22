import { asNonEmptyString, resolveTraceId } from "../helpers.js";
import { sanitizeStringForHootrix } from "../payload-sanitizer.js";
import { traceDbg } from "../../trace-logger.js";
function asStringOrNumber(value) {
    if (typeof value === "string" || typeof value === "number")
        return value;
    return undefined;
}
function rememberSubagentLineageFromHost(deps, childSessionKey, host) {
    const parentTurnId = host.active.traceId ?? resolveTraceId(host.active.trace);
    if (!parentTurnId) {
        return;
    }
    deps.rememberSubagentLineage(childSessionKey, {
        parentTurnId,
        anchorParentThreadId: host.sessionKey,
    });
}
export function registerSubagentHooks(deps) {
    traceDbg("hooks_registration", { node: "subagent_hooks_registering" });
    deps.api.on("subagent_spawning", (event, subagentCtx) => {
        traceDbg("hook_event", { node: "subagent_spawning_start" });
        if (!deps.getClient()) {
            traceDbg("hook_event", { node: "subagent_spawning_no_client" });
            return;
        }
        const eventObj = event;
        const ctxObj = subagentCtx;
        const requesterSessionKey = asNonEmptyString(ctxObj.requesterSessionKey);
        const childSessionKey = asNonEmptyString(eventObj.childSessionKey) ?? asNonEmptyString(ctxObj.childSessionKey);
        if (!childSessionKey) {
            traceDbg("hook_event", { node: "subagent_spawning_no_child_session_key" });
            return;
        }
        traceDbg("hook_event", { node: "subagent_spawning_child_session_key", childSessionKey, requesterSessionKey });
        const existingHost = deps.getSubagentSpanHost(childSessionKey);
        if (existingHost) {
            deps.safeSpanEnd(existingHost.span, `subagent reset childSessionKey=${childSessionKey}`);
            existingHost.active.subagentSpans.delete(childSessionKey);
            deps.forgetSubagentSpanHost(childSessionKey);
        }
        traceDbg("trace_resolution", { node: "subagent_spawning_resolving_host", childSessionKey, requesterSessionKey });
        const host = deps.resolveSubagentSpanContainer({ requesterSessionKey, childSessionKey });
        if (!host) {
            traceDbg("trace_error", { node: "subagent_spawning_no_host", childSessionKey, requesterSessionKey });
            return;
        }
        traceDbg("trace_state", { node: "subagent_spawning_host_resolved", childSessionKey, hostSessionKey: host.sessionKey });
        deps.rememberSessionCorrelation(host.sessionKey);
        host.active.lastActivityAt = Date.now();
        traceDbg("trace_state", { node: "subagent_spawning_activity_updated", childSessionKey });
        traceDbg("trace_lifecycle", { node: "subagent_spawning_creating_span", childSessionKey, agentId: eventObj.agentId });
        try {
            const span = host.parent.span({
                name: `subagent:${asNonEmptyString(eventObj.agentId) ?? "unknown"}`,
                input: {
                    childSessionKey,
                    agentId: eventObj.agentId,
                    label: eventObj.label,
                    mode: eventObj.mode,
                    requester: eventObj.requester,
                    threadRequested: eventObj.threadRequested,
                },
                metadata: {
                    status: "spawning",
                    requesterSessionKey,
                    childSessionKey,
                    runId: asNonEmptyString(ctxObj.runId),
                },
            });
            host.active.subagentSpans.set(childSessionKey, span);
            deps.rememberSubagentSpanHost(childSessionKey, host.sessionKey, host.active, span);
            rememberSubagentLineageFromHost(deps, childSessionKey, host);
            traceDbg("trace_lifecycle", { node: "subagent_spawning_span_created", childSessionKey, hostSessionKey: host.sessionKey, totalSubagentSpans: host.active.subagentSpans.size });
        }
        catch (err) {
            traceDbg("trace_error", { node: "subagent_spawning_span_creation_failed", childSessionKey, error: deps.formatError(err) });
            deps.warn(`hootrix: subagent span creation failed (childSessionKey=${childSessionKey}): ${deps.formatError(err)}`);
        }
        traceDbg("hook_event", { node: "subagent_spawning_complete", childSessionKey });
    });
    deps.api.on("subagent_spawned", (event, subagentCtx) => {
        traceDbg("hook_event", { node: "subagent_spawned_start" });
        if (!deps.getClient()) {
            traceDbg("hook_event", { node: "subagent_spawned_no_client" });
            return;
        }
        const eventObj = event;
        const ctxObj = subagentCtx;
        const requesterSessionKey = asNonEmptyString(ctxObj.requesterSessionKey);
        const childSessionKey = asNonEmptyString(eventObj.childSessionKey) ?? asNonEmptyString(ctxObj.childSessionKey);
        if (!childSessionKey) {
            traceDbg("hook_event", { node: "subagent_spawned_no_child_key" });
            return;
        }
        traceDbg("hook_event", { node: "subagent_spawned_child_key", childSessionKey, requesterSessionKey, agentId: eventObj.agentId });
        const existingHost = deps.getSubagentSpanHost(childSessionKey);
        traceDbg("trace_state", { node: "subagent_spawned_host_lookup", childSessionKey, hasExistingHost: !!existingHost });
        const host = existingHost
            ? { sessionKey: existingHost.hostSessionKey, active: existingHost.active, parent: existingHost.span }
            : deps.resolveSubagentSpanContainer({ requesterSessionKey, childSessionKey });
        if (!host) {
            traceDbg("trace_error", { node: "subagent_spawned_no_host", childSessionKey });
            return;
        }
        deps.rememberSessionCorrelation(host.sessionKey);
        host.active.lastActivityAt = Date.now();
        traceDbg("trace_state", { node: "subagent_spawned_activity_updated", childSessionKey, hostSessionKey: host.sessionKey });
        let span = existingHost?.span ?? host.active.subagentSpans.get(childSessionKey);
        traceDbg("trace_state", { node: "subagent_spawned_span_lookup", childSessionKey, foundExistingSpan: !!span });
        if (!span) {
            traceDbg("trace_lifecycle", { node: "subagent_spawned_creating_new_span", childSessionKey, agentId: eventObj.agentId });
            try {
                span = host.parent.span({
                    name: `subagent:${asNonEmptyString(eventObj.agentId) ?? "unknown"}`,
                    input: {
                        childSessionKey,
                        agentId: eventObj.agentId,
                        mode: eventObj.mode,
                    },
                });
                host.active.subagentSpans.set(childSessionKey, span);
                deps.rememberSubagentSpanHost(childSessionKey, host.sessionKey, host.active, span);
                traceDbg("trace_lifecycle", { node: "subagent_spawned_new_span_created", childSessionKey });
            }
            catch (err) {
                traceDbg("trace_error", { node: "subagent_spawned_span_creation_failed", childSessionKey, error: deps.formatError(err) });
                deps.warn(`hootrix: subagent span creation failed on spawn (childSessionKey=${childSessionKey}): ${deps.formatError(err)}`);
                return;
            }
        }
        rememberSubagentLineageFromHost(deps, childSessionKey, host);
        traceDbg("trace_lifecycle", { node: "subagent_spawned_updating_span", childSessionKey, status: "spawned" });
        deps.safeSpanUpdate(span, {
            metadata: {
                status: "spawned",
                requesterSessionKey,
                childSessionKey,
                runId: asNonEmptyString(eventObj.runId) ?? asNonEmptyString(ctxObj.runId),
                agentId: eventObj.agentId,
                mode: eventObj.mode,
                threadRequested: eventObj.threadRequested,
            },
        }, `subagent_spawned childSessionKey=${childSessionKey}`);
        traceDbg("hook_event", { node: "subagent_spawned_complete", childSessionKey });
        return { ...event };
    });
    deps.api.on("subagent_delivery_target", (event, subagentCtx) => {
        if (!deps.getClient())
            return;
        const eventObj = event;
        const ctxObj = subagentCtx;
        const requesterSessionKey = asNonEmptyString(eventObj.requesterSessionKey) ?? asNonEmptyString(ctxObj.requesterSessionKey);
        const childSessionKey = asNonEmptyString(eventObj.childSessionKey) ?? asNonEmptyString(ctxObj.childSessionKey);
        if (!childSessionKey)
            return;
        const childActive = deps.activeTraces.get(childSessionKey);
        if (childActive) {
            deps.rememberSessionCorrelation(childSessionKey);
            childActive.lastActivityAt = Date.now();
            try {
                const deliverySpan = childActive.trace.span({
                    name: "subagent:delivery-target",
                    input: {
                        childSessionKey,
                        requesterSessionKey,
                    },
                    metadata: {
                        status: "delivery_target",
                        requesterSessionKey,
                        childSessionKey,
                    },
                });
                const requesterOrigin = eventObj.requesterOrigin && typeof eventObj.requesterOrigin === "object" && !Array.isArray(eventObj.requesterOrigin)
                    ? eventObj.requesterOrigin
                    : undefined;
                const childRunId = asNonEmptyString(eventObj.childRunId);
                const spawnMode = asNonEmptyString(eventObj.spawnMode);
                const expectsCompletionMessage = typeof eventObj.expectsCompletionMessage === "boolean"
                    ? eventObj.expectsCompletionMessage
                    : undefined;
                const originChannel = asNonEmptyString(requesterOrigin?.channel);
                const originAccountId = asNonEmptyString(requesterOrigin?.accountId);
                const originTo = asNonEmptyString(requesterOrigin?.to);
                const originThreadId = asStringOrNumber(requesterOrigin?.threadId);
                deps.safeSpanUpdate(deliverySpan, {
                    metadata: {
                        status: "delivery_target",
                        requesterSessionKey,
                        childSessionKey,
                        ...(childRunId ? { childRunId } : {}),
                        ...(spawnMode ? { spawnMode } : {}),
                        ...(expectsCompletionMessage !== undefined ? { expectsCompletionMessage } : {}),
                        ...(originChannel ? { originChannel } : {}),
                        ...(originAccountId ? { originAccountId } : {}),
                        ...(originTo ? { originTo } : {}),
                        ...(originThreadId !== undefined ? { originThreadId } : {}),
                    },
                }, `subagent_delivery_target childSessionKey=${childSessionKey}`);
                deps.safeSpanEnd(deliverySpan, `subagent_delivery_target childSessionKey=${childSessionKey}`);
            }
            catch (err) {
                deps.warn(`hootrix: subagent delivery target span failed (childSessionKey=${childSessionKey}): ${deps.formatError(err)}`);
            }
            return;
        }
        const existingHost = deps.getSubagentSpanHost(childSessionKey);
        const host = existingHost
            ? { sessionKey: existingHost.hostSessionKey, active: existingHost.active, parent: existingHost.span }
            : deps.resolveSubagentSpanContainer({ requesterSessionKey, childSessionKey });
        if (!host)
            return;
        deps.rememberSessionCorrelation(host.sessionKey);
        host.active.lastActivityAt = Date.now();
        let span = existingHost?.span ?? host.active.subagentSpans.get(childSessionKey);
        if (!span) {
            try {
                span = host.parent.span({
                    name: "subagent:delivery-target",
                    input: {
                        childSessionKey,
                        requesterSessionKey,
                    },
                });
                host.active.subagentSpans.set(childSessionKey, span);
                deps.rememberSubagentSpanHost(childSessionKey, host.sessionKey, host.active, span);
            }
            catch (err) {
                deps.warn(`hootrix: subagent span creation failed on delivery target (childSessionKey=${childSessionKey}): ${deps.formatError(err)}`);
                return;
            }
        }
        const requesterOrigin = eventObj.requesterOrigin && typeof eventObj.requesterOrigin === "object" && !Array.isArray(eventObj.requesterOrigin)
            ? eventObj.requesterOrigin
            : undefined;
        const childRunId = asNonEmptyString(eventObj.childRunId);
        const spawnMode = asNonEmptyString(eventObj.spawnMode);
        const expectsCompletionMessage = typeof eventObj.expectsCompletionMessage === "boolean"
            ? eventObj.expectsCompletionMessage
            : undefined;
        const originChannel = asNonEmptyString(requesterOrigin?.channel);
        const originAccountId = asNonEmptyString(requesterOrigin?.accountId);
        const originTo = asNonEmptyString(requesterOrigin?.to);
        const originThreadId = asStringOrNumber(requesterOrigin?.threadId);
        deps.safeSpanUpdate(span, {
            metadata: {
                status: "delivery_target",
                requesterSessionKey,
                childSessionKey,
                ...(childRunId ? { childRunId } : {}),
                ...(spawnMode ? { spawnMode } : {}),
                ...(expectsCompletionMessage !== undefined ? { expectsCompletionMessage } : {}),
                ...(originChannel ? { originChannel } : {}),
                ...(originAccountId ? { originAccountId } : {}),
                ...(originTo ? { originTo } : {}),
                ...(originThreadId !== undefined ? { originThreadId } : {}),
            },
        }, `subagent_delivery_target childSessionKey=${childSessionKey}`);
    });
    deps.api.on("subagent_ended", (event, subagentCtx) => {
        traceDbg("hook_event", { node: "subagent_ended_start" });
        if (!deps.getClient()) {
            traceDbg("hook_event", { node: "subagent_ended_no_client" });
            return;
        }
        const eventObj = event;
        const ctxObj = subagentCtx;
        const requesterSessionKey = asNonEmptyString(ctxObj.requesterSessionKey);
        const childSessionKey = asNonEmptyString(ctxObj.childSessionKey);
        const targetSessionKey = asNonEmptyString(eventObj.targetSessionKey) ?? childSessionKey;
        traceDbg("hook_event", {
            node: "subagent_ended_target",
            targetSessionKey,
            requesterSessionKey,
            childSessionKey,
            reason: eventObj.reason,
        });
        const existingHost = targetSessionKey ? deps.getSubagentSpanHost(targetSessionKey) : undefined;
        traceDbg("trace_state", {
            node: "subagent_ended_host_lookup",
            targetSessionKey,
            foundExistingHost: !!existingHost,
            hostSessionKey: existingHost?.hostSessionKey,
        });
        let span = existingHost?.span;
        let host = existingHost
            ? { sessionKey: existingHost.hostSessionKey, active: existingHost.active, parent: existingHost.span }
            : undefined;
        if (!span && targetSessionKey && host) {
            span = host.active.subagentSpans.get(targetSessionKey);
        }
        if (!span) {
            host =
                host ??
                    deps.resolveSubagentSpanContainer({ requesterSessionKey, childSessionKey, targetSessionKey });
            if (!host) {
                traceDbg("trace_error", {
                    node: "subagent_ended_no_host",
                    targetSessionKey,
                    requesterSessionKey,
                });
                return;
            }
            span = targetSessionKey ? host.active.subagentSpans.get(targetSessionKey) : undefined;
            if (!span) {
                traceDbg("trace_lifecycle", {
                    node: "subagent_ended_creating_fallback_span",
                    targetSessionKey,
                    hostSessionKey: host.sessionKey,
                });
                try {
                    span = host.parent.span({
                        name: `subagent:${asNonEmptyString(eventObj.targetKind) ?? "unknown"}`,
                        input: {
                            targetSessionKey,
                            targetKind: eventObj.targetKind,
                            reason: eventObj.reason,
                        },
                    });
                    if (targetSessionKey) {
                        host.active.subagentSpans.set(targetSessionKey, span);
                        deps.rememberSubagentSpanHost(targetSessionKey, host.sessionKey, host.active, span);
                    }
                }
                catch (err) {
                    traceDbg("trace_error", {
                        node: "subagent_ended_span_creation_failed",
                        targetSessionKey,
                        error: deps.formatError(err),
                    });
                    deps.warn(`hootrix: subagent span creation failed on end (targetSessionKey=${targetSessionKey ?? "unknown"}): ${deps.formatError(err)}`);
                    return;
                }
            }
        }
        if (!host || !span) {
            traceDbg("trace_error", { node: "subagent_ended_unresolved_span", targetSessionKey });
            return;
        }
        deps.rememberSessionCorrelation(host.sessionKey);
        host.active.lastActivityAt = Date.now();
        const spanUpdate = {
            metadata: {
                status: "ended",
                targetSessionKey,
                requesterSessionKey,
                targetKind: eventObj.targetKind,
                reason: eventObj.reason,
                outcome: eventObj.outcome,
                sendFarewell: eventObj.sendFarewell,
                endedAt: eventObj.endedAt,
                accountId: eventObj.accountId,
                runId: asNonEmptyString(eventObj.runId) ?? asNonEmptyString(ctxObj.runId),
            },
        };
        const error = asNonEmptyString(eventObj.error);
        if (error) {
            const sanitizedError = sanitizeStringForHootrix(error);
            spanUpdate.output = { error: sanitizedError };
            spanUpdate.errorInfo = {
                exceptionType: "SubagentError",
                message: sanitizedError,
                traceback: sanitizedError,
            };
        }
        traceDbg("trace_lifecycle", {
            node: "subagent_ended_closing_span",
            targetSessionKey,
            hostSessionKey: host.sessionKey,
            usedExistingHost: !!existingHost,
        });
        deps.safeSpanUpdate(span, spanUpdate, `subagent_ended targetSessionKey=${targetSessionKey ?? "unknown"}`);
        deps.safeSpanEnd(span, `subagent_ended targetSessionKey=${targetSessionKey ?? "unknown"}`);
        if (targetSessionKey) {
            host.active.subagentSpans.delete(targetSessionKey);
            deps.forgetSubagentSpanHost(targetSessionKey);
            deps.forgetSubagentLineage(targetSessionKey);
            deps.forgetSubagentSpanHostsByActiveIfClosed(host.active);
        }
        traceDbg("hook_event", { node: "subagent_ended_complete", targetSessionKey });
        // Return event data to hootrix to prevent session list fields from being overwritten.
        return {
            ...event,
            status: event.success ? "completed" : "failed",
        };
    });
}
