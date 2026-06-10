import { buildOpikApiUrl } from "./collector-url.js";
function asObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return {};
    }
    return value;
}
function asOptionalString(value) {
    return typeof value === "string" ? value : undefined;
}
function asOptionalTrimmedString(value) {
    if (typeof value !== "string") {
        return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}
function asOptionalNumber(value) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return undefined;
    }
    return value;
}
/** JSON / UI sometimes yields strings ("true") instead of booleans. */
function parseOptionalBoolean(value) {
    if (typeof value === "boolean")
        return value;
    if (typeof value === "string") {
        const s = value.trim().toLowerCase();
        if (s === "true" || s === "1" || s === "yes" || s === "on")
            return true;
        if (s === "false" || s === "0" || s === "no" || s === "off")
            return false;
    }
    return undefined;
}
const PLUGIN_ENTRY_IDS = ["openclaw-hootrix-trace"];
function looksLikeOpikPluginConfig(o) {
    return ("apiKey" in o ||
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
        "mainApiUrl" in o);
}
function shouldUseEmbeddedPluginConfig(nested) {
    if (Object.keys(nested).length === 0)
        return false;
    if (looksLikeOpikPluginConfig(nested))
        return true;
    if (typeof nested.enabled === "boolean")
        return true;
    return false;
}
/**
 * Gateways may pass either the plugin `config` object or the full OpenClaw document.
 * Unwrap `plugins.entries["openclaw-hootrix-trace"].config` when needed.
 */
export function coercePluginConfigRoot(raw) {
    const o = asObject(raw);
    const plugins = asObject(o.plugins);
    const entries = plugins.entries;
    if (entries && typeof entries === "object" && !Array.isArray(entries)) {
        const er = entries;
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
    if (looksLikeOpikPluginConfig(o)) {
        return o;
    }
    const wrapped = asObject(o.config);
    if (looksLikeOpikPluginConfig(wrapped)) {
        return wrapped;
    }
    return o;
}
export function parseOpikPluginConfig(raw) {
    const cfg = coercePluginConfigRoot(raw);
    const tagsRaw = cfg.tags;
    const tags = Array.isArray(tagsRaw)
        ? tagsRaw.filter((entry) => typeof entry === "string")
        : undefined;
    // Parse policy sync interval with environment variable fallback
    const policySyncIntervalMs = (() => {
        if (typeof cfg.policySyncIntervalMs === "number" && Number.isFinite(cfg.policySyncIntervalMs)) {
            return Math.max(5000, Math.floor(cfg.policySyncIntervalMs));
        }
        const envVal = process.env.CRABAGENT_POLICY_SYNC_INTERVAL_MS?.trim();
        if (envVal && Number.isFinite(Number(envVal))) {
            return Math.max(5000, Math.floor(Number(envVal)));
        }
        return undefined;
    })();
    const apiKey = asOptionalTrimmedString(cfg.apiKey) ?? asOptionalTrimmedString(process.env.HOOTRIX_API_KEY);
    let apiUrl = asOptionalTrimmedString(cfg.apiUrl) ?? asOptionalTrimmedString(process.env.HOOTRIX_URL);
    if (apiUrl) {
        apiUrl = buildOpikApiUrl(apiUrl.replace(/\/+$/, ""));
    }
    const enabledExplicit = parseOptionalBoolean(cfg.enabled);
    // Default on when credentials are present (common misconfig: apiKey set but enabled omitted).
    const enabled = enabledExplicit ?? Boolean(apiKey && apiUrl);
    return {
        enabled,
        debug: parseOptionalBoolean(cfg.debug),
        apiKey,
        apiUrl,
        projectName: asOptionalTrimmedString(cfg.projectName),
        workspaceName: asOptionalTrimmedString(cfg.workspaceName),
        tags,
        toolResultPersistSanitizeEnabled: typeof cfg.toolResultPersistSanitizeEnabled === "boolean"
            ? cfg.toolResultPersistSanitizeEnabled
            : undefined,
        staleTraceTimeoutMs: asOptionalNumber(cfg.staleTraceTimeoutMs),
        staleSweepIntervalMs: asOptionalNumber(cfg.staleSweepIntervalMs),
        staleTraceCleanupEnabled: typeof cfg.staleTraceCleanupEnabled === "boolean" ? cfg.staleTraceCleanupEnabled : undefined,
        flushRetryCount: asOptionalNumber(cfg.flushRetryCount),
        flushRetryBaseDelayMs: asOptionalNumber(cfg.flushRetryBaseDelayMs),
        policySyncIntervalMs,
        sageEnabled: parseOptionalBoolean(cfg.sageEnabled),
        mainApiUrl: asOptionalTrimmedString(cfg.mainApiUrl) ??
            asOptionalTrimmedString(process.env.HOOTRIX_MAIN_API_URL),
        sageAutoRefreshExperiment: parseOptionalBoolean(cfg.sageAutoRefreshExperiment),
    };
}
