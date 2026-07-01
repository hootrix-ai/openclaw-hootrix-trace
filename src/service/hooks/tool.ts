import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { Opik as HootrixClient, Span, Trace } from "hootrix";
import type { ActiveTrace } from "../../types.js";
import { asNonEmptyString, resolveRunId, resolveToolCallId } from "../helpers.js";
import { sanitizeStringForHootrix, sanitizeValueForHootrix } from "../payload-sanitizer.js";
import {
  buildMinimalSpanCompletionPatch,
  directBootstrapSpan,
  directPatchSpan,
  type CollectorExportConfig,
} from "../../direct-collector-export.js";
import { traceDbg } from "../../trace-logger.js";

type ToolHooksDeps = {
  api: OpenClawPluginApi;
  getClient: () => HootrixClient | null;
  activeTraces: Map<string, ActiveTrace>;
  sessionByAgentId: Map<string, string>;
  getLastActiveSessionKey: () => string | undefined;
  rememberSessionCorrelation: (sessionKey: string, agentId?: unknown) => void;
  resolveSessionSpanContainer: (
    sessionKey: string,
  ) => { sessionKey: string; active: ActiveTrace; parent: Trace | Span } | undefined;
  warnMissingAfterToolSessionKey: (fallbackMode: string) => void;
  nextSpanSeq: () => number;
  safeSpanUpdate: (span: Span, payload: Record<string, unknown>, reason: string) => void;
  safeSpanEnd: (span: Span, reason: string) => void;
  scheduleMediaAttachmentUploads: (params: {
    entityType: "trace" | "span";
    entity: unknown;
    projectName: string;
    reason: string;
    payloads: unknown[];
    traceId?: string;
  }) => void;
  getProjectName: () => string;
  warn: (message: string) => void;
  formatError: (err: unknown) => string;
  getCollectorExportConfig: () => CollectorExportConfig | null;
  awaitFlush: (reason: string) => Promise<void>;
};

export function registerToolHooks(deps: ToolHooksDeps): void {
  traceDbg("hooks_registration", { node: "tool_hooks_registering" });
  deps.api.on("before_tool_call", async (event, toolCtx) => {
    traceDbg("hook_event", { node: "before_tool_call_start", tool: event.tool });
    if (!deps.getClient()) {
      traceDbg("hook_event", { node: "before_tool_call_no_client" });
      return;
    }
    const sessionKey = toolCtx.sessionKey;
    if (!sessionKey) {
      traceDbg("hook_event", { node: "before_tool_call_no_session_key" });
      return;
    }
    traceDbg("hook_event", { node: "before_tool_call_session_key", sessionKey, tool: event.tool });
    deps.rememberSessionCorrelation(sessionKey, toolCtx.agentId);

    const container = deps.resolveSessionSpanContainer(sessionKey);
    if (!container) return;
    const active = container.active;
    const toolParent =
      container.sessionKey === sessionKey && active.llmSpan ? active.llmSpan : container.parent;

    active.lastActivityAt = Date.now();

    const eventObj = event as Record<string, unknown>;
    const ctxObj = toolCtx as Record<string, unknown>;
    const runId = resolveRunId(eventObj, ctxObj);
    const toolCallId = resolveToolCallId(eventObj, ctxObj);
    const sessionId = asNonEmptyString(ctxObj.sessionId);
    traceDbg("trace_data", { node: "before_tool_call_context", sessionKey, toolName: event.toolName, toolCallId, runId, sessionId });

    const spanMetadata: Record<string, unknown> = {
      ...(toolCtx.agentId ? { agentId: toolCtx.agentId } : {}),
      ...(sessionId ? { sessionId } : {}),
      ...(runId ? { runId } : {}),
      ...(toolCallId ? { toolCallId } : {}),
    };
    traceDbg("trace_data", { node: "before_tool_call_span_metadata", sessionKey, metadataKeys: Object.keys(spanMetadata) });

    let toolSpan: Span;
    const sanitizedInput = sanitizeValueForHootrix(event.params);
    traceDbg("trace_data", { node: "before_tool_call_sanitized_input", sessionKey, toolName: event.toolName, hasParams: !!event.params });
    try {
      traceDbg("trace_lifecycle", { node: "before_tool_call_creating_span", sessionKey, toolName: event.toolName, parentType: active.llmSpan ? "llmSpan" : "trace" });
      toolSpan = toolParent.span({
        name:
          typeof event.toolName === "string" && event.toolName.trim().length > 0
            ? event.toolName.trim()
            : "tool",
        type: "tool",
        input: sanitizedInput as any,
        ...(Object.keys(spanMetadata).length > 0 ? { metadata: spanMetadata } : {}),
      });
      traceDbg("trace_lifecycle", { node: "before_tool_call_span_created", sessionKey, toolName: event.toolName });
    } catch (err) {
      traceDbg("trace_error", { node: "before_tool_call_span_creation_failed", sessionKey, toolName: event.toolName, error: deps.formatError(err) });
      deps.warn(
        `hootrix: tool span creation failed (sessionKey=${sessionKey}, tool=${event.toolName}): ${deps.formatError(err)}`,
      );
      return;
    }

    const spanKey = toolCallId
      ? `session:${sessionKey}:toolcall:${toolCallId}`
      : `session:${sessionKey}:${event.toolName}:${deps.nextSpanSeq()}`;
    traceDbg("trace_state", { node: "before_tool_call_span_key", sessionKey, spanKey, toolCallId, existingSpansCount: active.toolSpans.size });
    if (toolCallId) {
      const existing = active.toolSpans.get(spanKey);
      if (existing) {
        traceDbg("trace_state", { node: "before_tool_call_duplicate_span", sessionKey, toolCallId });
        deps.safeSpanEnd(
          existing,
          `replace duplicate toolCallId sessionKey=${sessionKey} toolCallId=${toolCallId}`,
        );
        active.toolSpans.delete(spanKey);
      }
    }
    active.toolSpans.set(spanKey, toolSpan);
    traceDbg("trace_state", { node: "before_tool_call_span_stored", sessionKey, spanKey, totalToolSpans: active.toolSpans.size });

    const exportCfg = deps.getCollectorExportConfig();
    const toolSpanId = (toolSpan as unknown as { data?: { id?: string; traceId?: string } }).data?.id;
    const traceId = active.traceId ?? (toolSpan as unknown as { data?: { traceId?: string } }).data?.traceId;
    if (exportCfg && toolSpanId) {
      try {
        const bootstrap = await directBootstrapSpan({
          config: exportCfg,
          span: toolSpan,
          traceId,
        });
        if (!bootstrap.ok) {
          deps.warn(
            `hootrix: direct tool span bootstrap failed (sessionKey=${sessionKey} tool=${event.toolName} status=${bootstrap.status})`,
          );
        }
      } catch (err) {
        deps.warn(
          `hootrix: direct tool span bootstrap error (sessionKey=${sessionKey} tool=${event.toolName}): ${deps.formatError(err)}`,
        );
      }
    }

    traceDbg("attachment", { node: "before_tool_call_scheduling_upload", sessionKey, toolName: event.toolName });
    deps.scheduleMediaAttachmentUploads({
      entityType: "span",
      entity: toolSpan,
      projectName: deps.getProjectName(),
      traceId: active.traceId,
      reason: `before_tool_call sessionKey=${sessionKey} tool=${event.toolName}`,
      payloads: [event.params],
    });
    traceDbg("hook_event", { node: "before_tool_call_complete", sessionKey, toolName: event.toolName });
  });

  deps.api.on("after_tool_call", async (event, toolCtx) => {
    traceDbg("hook_event", { node: "after_tool_call_start" });
    if (!deps.getClient()) {
      traceDbg("hook_event", { node: "after_tool_call_no_client" });
      return;
    }
    const eventObj = event as Record<string, unknown>;
    traceDbg("hook_event", { node: "after_tool_call_processing" });
    const ctxObj = toolCtx as Record<string, unknown>;
    const runId = resolveRunId(eventObj, ctxObj);
    const toolCallId = resolveToolCallId(eventObj, ctxObj);
    const sessionId = asNonEmptyString(ctxObj.sessionId);

    let sessionKey = toolCtx.sessionKey;
    let fallbackMode: "agentId" | "single active trace" | "last active session" | undefined;
    traceDbg("trace_resolution", { node: "after_tool_call_resolving_session", sessionKey, agentId: toolCtx.agentId, activeTracesCount: deps.activeTraces.size });
    if (!sessionKey) {
      if (typeof toolCtx.agentId === "string" && toolCtx.agentId.length > 0) {
        const byAgentId = deps.sessionByAgentId.get(toolCtx.agentId);
        traceDbg("trace_resolution", { node: "after_tool_call_agent_lookup", agentId: toolCtx.agentId, foundByAgentId: !!byAgentId });
        if (byAgentId && deps.activeTraces.has(byAgentId)) {
          sessionKey = byAgentId;
          fallbackMode = "agentId";
        }
      }
      if (!sessionKey && deps.activeTraces.size === 1) {
        sessionKey = deps.activeTraces.keys().next().value as string | undefined;
        fallbackMode = "single active trace";
        traceDbg("trace_resolution", { node: "after_tool_call_single_trace_fallback", sessionKey });
      } else if (!sessionKey) {
        const lastActiveSessionKey = deps.getLastActiveSessionKey();
        if (lastActiveSessionKey && deps.activeTraces.has(lastActiveSessionKey)) {
          sessionKey = lastActiveSessionKey;
          fallbackMode = "last active session";
          traceDbg("trace_resolution", { node: "after_tool_call_last_active_fallback", sessionKey });
        }
      }
      if (sessionKey && fallbackMode) {
        traceDbg("trace_resolution", { node: "after_tool_call_fallback_applied", sessionKey, fallbackMode });
        deps.warnMissingAfterToolSessionKey(fallbackMode);
      }
    }
    if (!sessionKey) {
      traceDbg("trace_error", { node: "after_tool_call_no_session_key", agentId: toolCtx.agentId });
      return;
    }
    deps.rememberSessionCorrelation(sessionKey, toolCtx.agentId);
    traceDbg("trace_state", { node: "after_tool_call_session_correlated", sessionKey, agentId: toolCtx.agentId });

    const container = deps.resolveSessionSpanContainer(sessionKey);
    if (!container) {
      traceDbg("trace_error", { node: "after_tool_call_no_container", sessionKey });
      return;
    }
    traceDbg("trace_state", { node: "after_tool_call_container_resolved", sessionKey, containerType: container.parent === container.active.trace ? "trace" : "span" });
    const active = container.active;

    active.lastActivityAt = Date.now();
    traceDbg("trace_state", { node: "after_tool_call_activity_updated", sessionKey, lastActivityAt: active.lastActivityAt });

    let matchedKey: string | undefined;
    let matchedSpan: Span | undefined;
    traceDbg("trace_resolution", { node: "after_tool_call_finding_span", sessionKey, toolName: event.toolName, toolCallId, availableToolSpans: active.toolSpans.size, availableSpanKeys: Array.from(active.toolSpans.keys()).slice(0, 5) });
    if (toolCallId) {
      const toolCallKey = `session:${sessionKey}:toolcall:${toolCallId}`;
      const toolCallSpan = active.toolSpans.get(toolCallKey);
      if (toolCallSpan) {
        matchedKey = toolCallKey;
        matchedSpan = toolCallSpan;
        traceDbg("trace_resolution", { node: "after_tool_call_matched_by_toolcallid", sessionKey, toolCallKey });
      }
    }
    if (!matchedSpan) {
      traceDbg("trace_resolution", { node: "after_tool_call_searching_by_name", sessionKey, toolName: event.toolName });
      for (const [key, span] of active.toolSpans) {
        if (key.startsWith(`session:${sessionKey}:${event.toolName}:`)) {
          matchedKey = key;
          matchedSpan = span;
          traceDbg("trace_resolution", { node: "after_tool_call_matched_by_name", sessionKey, matchedKey });
          break;
        }
      }
    }
    if (!matchedKey || !matchedSpan) {
      traceDbg("trace_error", { node: "after_tool_call_no_matching_span", sessionKey, toolName: event.toolName, toolCallId, availableSpans: active.toolSpans.size });
      return;
    }

    const spanUpdate: Record<string, unknown> = {};
    if (typeof event.toolName === "string" && event.toolName.trim().length > 0) {
      spanUpdate.name = event.toolName.trim();
    }
    if (event.params && typeof event.params === "object" && !Array.isArray(event.params)) {
      spanUpdate.input = sanitizeValueForHootrix(event.params) as Record<string, unknown>;
    }
    const spanMetadata: Record<string, unknown> = {
      ...(event.durationMs !== undefined ? { durationMs: event.durationMs } : {}),
      ...(toolCtx.agentId ? { agentId: toolCtx.agentId } : {}),
      ...(sessionId ? { sessionId } : {}),
      ...(runId ? { runId } : {}),
      ...(toolCallId ? { toolCallId } : {}),
    };
    if (Object.keys(spanMetadata).length > 0) {
      spanUpdate.metadata = spanMetadata;
    }
    traceDbg("trace_data", { node: "after_tool_call_span_update_prepared", sessionKey, toolName: event.toolName, updateKeys: Object.keys(spanUpdate), hasError: !!event.error, hasResult: event.result !== undefined });

    if (event.error) {
      const sanitizedError = sanitizeStringForHootrix(event.error);
      traceDbg("trace_data", { node: "after_tool_call_error_output", sessionKey, errorLength: sanitizedError.length });
      spanUpdate.output = { error: sanitizedError };
      spanUpdate.errorInfo = {
        exceptionType: "ToolError",
        message: sanitizedError,
        traceback: sanitizedError,
      };
    } else if (event.result !== undefined) {
      const output =
        typeof event.result === "object" && event.result !== null
          ? (event.result as Record<string, unknown>)
          : { result: event.result };
      traceDbg("trace_data", { node: "after_tool_call_result_output", sessionKey, resultType: typeof event.result });
      spanUpdate.output = sanitizeValueForHootrix(output) as Record<string, unknown>;
    }

    if (Object.keys(spanUpdate).length > 0) {
      traceDbg("trace_lifecycle", { node: "after_tool_call_updating_span", sessionKey, matchedKey });
      deps.safeSpanUpdate(
        matchedSpan,
        spanUpdate,
        `after_tool_call sessionKey=${sessionKey} tool=${event.toolName}`,
      );
      traceDbg("trace_lifecycle", { node: "after_tool_call_span_updated", sessionKey, matchedKey });
    }

    traceDbg("attachment", { node: "after_tool_call_scheduling_upload", sessionKey, toolName: event.toolName });
    deps.scheduleMediaAttachmentUploads({
      entityType: "span",
      entity: matchedSpan,
      projectName: deps.getProjectName(),
      traceId: active.traceId,
      reason: `after_tool_call sessionKey=${sessionKey} tool=${event.toolName}`,
      payloads: [event.params, event.result, event.error],
    });

    traceDbg("trace_lifecycle", { node: "after_tool_call_ending_span", sessionKey, matchedKey, remainingToolSpans: active.toolSpans.size });
    const toolSpanId = (matchedSpan as unknown as { data?: { id?: string; traceId?: string } }).data?.id;
    const traceId = active.traceId ?? (matchedSpan as unknown as { data?: { traceId?: string } }).data?.traceId;
    deps.safeSpanEnd(
      matchedSpan,
      `after_tool_call sessionKey=${sessionKey} tool=${event.toolName} key=${matchedKey}`,
    );
    active.toolSpans.delete(matchedKey);

    await deps.awaitFlush(`after_tool_call pre-completion sessionKey=${sessionKey} tool=${event.toolName}`);

    const exportCfg = deps.getCollectorExportConfig();
    if (exportCfg && toolSpanId && traceId) {
      try {
        const completionPatch = buildMinimalSpanCompletionPatch({
          name: spanUpdate.name,
          type: "tool",
          traceId,
          endTime: new Date(),
        });
        const patchResult = await directPatchSpan({
          config: exportCfg,
          spanId: toolSpanId,
          patch: completionPatch,
        });
        if (!patchResult.ok) {
          deps.warn(
            `hootrix: direct tool span completion patch failed (sessionKey=${sessionKey} tool=${event.toolName} spanId=${toolSpanId} status=${patchResult.status})`,
          );
        }
      } catch (err) {
        deps.warn(
          `hootrix: direct tool span completion patch error (sessionKey=${sessionKey} tool=${event.toolName}): ${deps.formatError(err)}`,
        );
      }
    } else if (exportCfg && toolSpanId && !traceId) {
      deps.warn(
        `hootrix: skipping direct tool span completion patch (missing traceId sessionKey=${sessionKey} tool=${event.toolName} spanId=${toolSpanId})`,
      );
    }
    await deps.awaitFlush(`after_tool_call sessionKey=${sessionKey} tool=${event.toolName}`);

    traceDbg("hook_event", { node: "after_tool_call_complete", sessionKey, toolName: event.toolName, remainingToolSpans: active.toolSpans.size });
  });
  traceDbg("hooks_registration", { node: "tool_hooks_registered" });
}
