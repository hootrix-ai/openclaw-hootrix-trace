import type { Span, Trace } from "hootrix";
import { buildHootrixApiUrl } from "./collector-url.js";
import { HOOTRIX_PLUGIN_ID } from "./constants.js";

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
  /** Enable Sage experiment auto-refresh after live traces (default: false) */
  sageEnabled?: boolean;
  /** Main backend URL for Sage APIs (default: HOOTRIX_MAIN_API_URL or http://127.0.0.1:9821) */
  mainApiUrl?: string;
  /** After finalize, refresh experiment when trace tags include hootrix.experiment_id=… (default: true when sageEnabled) */
  sageAutoRefreshExperiment?: boolean;
};

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asOptionalTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asOptionalNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return value;
}

/** JSON / UI sometimes yields strings ("true") instead of booleans. */
function parseOptionalBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const s = value.trim().toLowerCase();
    if (s === "true" || s === "1" || s === "yes" || s === "on") return true;
    if (s === "false" || s === "0" || s === "no" || s === "off") return false;
  }
  return undefined;
}

const PLUGIN_ENTRY_IDS = [HOOTRIX_PLUGIN_ID] as const;

function looksLikeHootrixPluginConfig(o: Record<string, unknown>): boolean {
  return (
    "apiKey" in o ||
    "apiUrl" in o ||
    "projectName" in o ||
    "workspaceName" in o ||
    "tags" in o ||
    "debug" in o ||
    "toolResultPersistSanitizeEnabled" in o ||
    "staleTraceCleanupEnabled" in o ||
    "staleTraceTimeoutMs" in o ||
    "staleSweepIntervalMs" in o ||
    "flushRetryCount" in o ||
    "flushRetryBaseDelayMs" in o ||
    "sageEnabled" in o ||
    "mainApiUrl" in o
  );
}

function shouldUseEmbeddedPluginConfig(nested: Record<string, unknown>): boolean {
  if (Object.keys(nested).length === 0) return false;
  if (looksLikeHootrixPluginConfig(nested)) return true;
  if (typeof nested.enabled === "boolean") return true;
  return false;
}

/**
 * Gateways may pass either the plugin `config` object or the full OpenClaw document.
 * Unwrap `plugins.entries["openclaw-hootrix-trace"].config` when needed.
 */
export function coercePluginConfigRoot(raw: unknown): Record<string, unknown> {
  const o = asObject(raw);

  const plugins = asObject(o.plugins);
  const entries = plugins.entries;
  if (entries && typeof entries === "object" && !Array.isArray(entries)) {
    const er = entries as Record<string, unknown>;
    for (const id of PLUGIN_ENTRY_IDS) {
      const entry = asObject(er[id]);
      const nested = asObject(entry.config);
      if (Object.keys(nested).length > 0) {
        return nested;
      }
    }
    for (const entryRaw of Object.values(er)) {
      const entry = asObject(entryRaw);
      const nested = asObject(entry.config);
      if (Object.keys(nested).length > 0) {
        return nested;
      }
    }
  }

  const embedded = asObject(o.config);
  if (shouldUseEmbeddedPluginConfig(embedded)) {
    return embedded;
  }

  if (looksLikeHootrixPluginConfig(o)) {
    return o;
  }

  const wrapped = asObject(o.config);
  if (looksLikeHootrixPluginConfig(wrapped)) {
    return wrapped;
  }

  return o;
}

export function parseHootrixPluginConfig(raw: unknown): HootrixPluginConfig {
  const cfg = coercePluginConfigRoot(raw);
  const tagsRaw = cfg.tags;
  const tags = Array.isArray(tagsRaw)
    ? tagsRaw.filter((entry): entry is string => typeof entry === "string")
    : undefined;

  // Parse policy sync interval with environment variable fallback
  const policySyncIntervalMs = (() => {
    if (typeof cfg.policySyncIntervalMs === "number" && Number.isFinite(cfg.policySyncIntervalMs)) {
      return Math.max(5000, Math.floor(cfg.policySyncIntervalMs));
    }
    const envVal =
      process.env.HOOTRIX_POLICY_SYNC_INTERVAL_MS?.trim() ??
      process.env.CRABAGENT_POLICY_SYNC_INTERVAL_MS?.trim();
    if (envVal && Number.isFinite(Number(envVal))) {
      return Math.max(5000, Math.floor(Number(envVal)));
    }
    return undefined;
  })();

  const apiKey = asOptionalTrimmedString(cfg.apiKey) ?? asOptionalTrimmedString(process.env.HOOTRIX_API_KEY);
  let apiUrl = asOptionalTrimmedString(cfg.apiUrl) ?? asOptionalTrimmedString(process.env.HOOTRIX_URL_OVERRIDE);
  if (apiUrl) {
    apiUrl = buildHootrixApiUrl(apiUrl.replace(/\/+$/, ""));
  }

  const enabledExplicit = parseOptionalBoolean(cfg.enabled);
  // Default on when credentials are present (common misconfig: apiKey set but enabled omitted).
  const enabled =
    enabledExplicit ?? Boolean(apiKey && apiUrl);

  return {
    enabled,
    debug: parseOptionalBoolean(cfg.debug),
    apiKey,
    apiUrl,
    projectName: asOptionalTrimmedString(cfg.projectName),
    workspaceName: asOptionalTrimmedString(cfg.workspaceName),
    tags,
    toolResultPersistSanitizeEnabled:
      typeof cfg.toolResultPersistSanitizeEnabled === "boolean"
        ? cfg.toolResultPersistSanitizeEnabled
        : undefined,
    staleTraceTimeoutMs: asOptionalNumber(cfg.staleTraceTimeoutMs),
    staleSweepIntervalMs: asOptionalNumber(cfg.staleSweepIntervalMs),
    staleTraceCleanupEnabled:
      typeof cfg.staleTraceCleanupEnabled === "boolean" ? cfg.staleTraceCleanupEnabled : undefined,
    flushRetryCount: asOptionalNumber(cfg.flushRetryCount),
    flushRetryBaseDelayMs: asOptionalNumber(cfg.flushRetryBaseDelayMs),
    policySyncIntervalMs,
    sageEnabled: parseOptionalBoolean(cfg.sageEnabled),
    mainApiUrl:
      asOptionalTrimmedString(cfg.mainApiUrl) ??
      asOptionalTrimmedString(process.env.HOOTRIX_MAIN_API_URL),
    sageAutoRefreshExperiment: parseOptionalBoolean(cfg.sageAutoRefreshExperiment),
  };
}

/** Active trace state for a single agent run, keyed by sessionKey. */
export type ActiveTrace = {
  trace: Trace;
  /** Resolved Opik trace id for lineage (from trace.data.id). */
  traceId?: string;
  llmSpan: Span | null;
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
  /** Output accumulated from llm_output. */
  output?: { output: string; lastAssistant?: unknown };
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
  /** Sage comparison experiment id from hootrix.experiment_id= tag */
  experimentId?: string;
};
