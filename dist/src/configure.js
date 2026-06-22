import * as p from "@clack/prompts";
import { collectorFetch } from "./collector-fetch.js";
import { isHootrixCollectorBaseUrl } from "./collector-url.js";
import { HOOTRIX_CLOUD_HOST, HOOTRIX_CLOUD_SIGNUP_URL, HOOTRIX_COLLECTOR_HOST, HOOTRIX_PLUGIN_ID, DEFAULT_PROJECT_NAME, DEFAULT_WORKSPACE_NAME, } from "./constants.js";
import { runCloudDeviceAuth } from "./device-auth.js";
/** Default local Hootrix URL (matches SDK's DEFAULT_LOCAL_URL). */
const DEFAULT_LOCAL_URL = "http://localhost:6820/";
/** Max URL validation retries (matches SDK's MAX_URL_VALIDATION_RETRIES). */
const MAX_URL_RETRIES = 3;
function asObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return {};
    }
    return value;
}
export function getHootrixPluginEntry(cfg) {
    const root = asObject(cfg);
    const plugins = asObject(root.plugins);
    const entries = asObject(plugins.entries);
    const entry = asObject(entries[HOOTRIX_PLUGIN_ID]);
    const config = asObject(entry.config);
    return {
        enabled: typeof entry.enabled === "boolean" ? entry.enabled : undefined,
        config,
    };
}
export function setHootrixPluginEntry(cfg, config, enabled = true) {
    const root = asObject(cfg);
    const plugins = asObject(root.plugins);
    const entries = asObject(plugins.entries);
    const existingEntry = asObject(entries[HOOTRIX_PLUGIN_ID]);
    const existingHooks = asObject(existingEntry.hooks);
    const nextEntries = {
        ...entries,
        [HOOTRIX_PLUGIN_ID]: {
            ...existingEntry,
            enabled,
            hooks: {
                ...existingHooks,
                allowConversationAccess: true,
            },
            config: {
                ...asObject(existingEntry.config),
                ...config,
            },
        },
    };
    return {
        ...root,
        plugins: {
            ...plugins,
            entries: nextEntries,
        },
    };
}
function applyHootrixPluginEntryToDraft(draft, config, enabled = true) {
    const merged = setHootrixPluginEntry(draft, config, enabled);
    const root = draft;
    const mergedRoot = merged;
    root.plugins = mergedRoot.plugins;
}
// ---------------------------------------------------------------------------
// URL helpers (mirrors Hootrix SDK api-helpers.ts / urls.ts)
// ---------------------------------------------------------------------------
/** Ensure trailing slash on a URL. */
function normalizeUrl(url) {
    return url.endsWith("/") ? url : `${url}/`;
}
/** True when the URL targets Hootrix trace-collector (not Hootrix UI / Comet Cloud). */
export { isHootrixCollectorBaseUrl, buildHootrixApiUrl } from "./collector-url.js";
/**
 * Build a browser URL pointing to the projects list in the Hootrix UI.
 * Cloud/self-hosted: {host}app?workspace={workspace}
 * Local:             {host}?workspace={workspace}
 */
function buildProjectsUrl(host, workspaceName) {
    const base = host.endsWith("/") ? host.slice(0, -1) : host;
    const isLocal = base.includes("localhost") || base.includes("127.0.0.1");
    const prefix = isLocal ? "" : "/app";
    return `${base}${prefix}?workspace=${encodeURIComponent(workspaceName)}`;
}
function buildApiKeysUrl(host) {
    return new URL("account-settings/apiKeys", normalizeUrl(host)).toString();
}
export function getApiKeyHelpText(deployment, host) {
    const lines = [`You can find your Hootrix API key here:\n${buildApiKeysUrl(host)}`];
    if (deployment === "cloud") {
        lines.push(`No Hootrix Cloud account yet? Sign up for a free account:\n${HOOTRIX_CLOUD_SIGNUP_URL}`);
    }
    return lines;
}
// ---------------------------------------------------------------------------
// API validation helpers (mirrors Hootrix SDK api-helpers.ts)
// ---------------------------------------------------------------------------
/**
 * Check if an Hootrix instance is accessible at the given URL.
 * Accepts 2xx-4xx as valid (even 404 means server is running).
 * Mirrors `isHootrixAccessible` in the Hootrix SDK.
 */
async function isHootrixAccessible(url, timeoutMs = 5_000) {
    try {
        const healthUrl = new URL("health", normalizeUrl(url)).toString();
        const fetchImpl = isHootrixCollectorBaseUrl(url) ? collectorFetch : fetch;
        const res = await fetchImpl(healthUrl, { signal: AbortSignal.timeout(timeoutMs) });
        return res.status >= 200 && res.status < 500;
    }
    catch {
        return false;
    }
}
function buildCollectorAuthHeaders(apiKey) {
    return {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-API-Key": apiKey,
        Authorization: `Bearer ${apiKey}`,
    };
}
async function readCollectorResponse(res) {
    const text = await res.text();
    try {
        return { text, json: asObject(JSON.parse(text)) };
    }
    catch {
        return { text, json: {} };
    }
}
function collectorGlobalMessage(json) {
    const message = json.message;
    if (typeof message === "string") {
        return message;
    }
    const messageObj = asObject(message);
    const global = messageObj.global;
    return typeof global === "string" ? global : "";
}
function isCollectorAuthFailure(status, json) {
    if (status === 401 || status === 403) {
        return true;
    }
    return json.code === "AuthFail";
}
/** Auth succeeded but ingest rejected an intentionally empty validation batch. */
function isEmptyBatchAuthProbeSuccess(status, json) {
    if (status === 204 || (status >= 200 && status < 300)) {
        return true;
    }
    if (status !== 500) {
        return false;
    }
    const global = collectorGlobalMessage(json).toLowerCase();
    return global.includes("cannot be empty") || global.includes("batch traces cannot be empty");
}
/**
 * Validate a Hootrix API key against the trace-collector ingest API.
 * Uses an empty traces batch so auth is checked without writing trace data.
 */
export async function validateHootrixApiKey(apiKey, collectorBaseUrl = HOOTRIX_COLLECTOR_HOST) {
    const url = new URL("v1/private/traces/batch", normalizeUrl(collectorBaseUrl)).toString();
    const res = await collectorFetch(url, {
        method: "POST",
        headers: buildCollectorAuthHeaders(apiKey),
        body: JSON.stringify({ traces: [], spans: [] }),
        signal: AbortSignal.timeout(5_000),
    });
    const { text, json } = await readCollectorResponse(res);
    if (isCollectorAuthFailure(res.status, json)) {
        throw new Error(`Invalid API key (status ${res.status})`);
    }
    if (isEmptyBatchAuthProbeSuccess(res.status, json)) {
        return;
    }
    if (res.status === 404) {
        throw new Error(`Collector endpoint not found at ${url}`);
    }
    if (res.status >= 500) {
        const detail = collectorGlobalMessage(json) || text.trim();
        throw new Error(detail
            ? `Collector unavailable (status ${res.status}): ${detail}`
            : `Collector unavailable (status ${res.status})`);
    }
    throw new Error(`API key validation failed (status ${res.status})`);
}
// ---------------------------------------------------------------------------
// Deployment-specific URL handlers (mirrors Hootrix SDK clack-utils.ts)
// ---------------------------------------------------------------------------
/**
 * Handle local deployment URL config with auto-detection and retry.
 * Mirrors `handleLocalDeploymentConfig` in the Hootrix SDK.
 */
async function handleLocalDeploymentConfig() {
    const isDefaultRunning = await isHootrixAccessible(DEFAULT_LOCAL_URL, 3_000);
    if (isDefaultRunning) {
        p.log.success(`Local Hootrix instance detected at ${DEFAULT_LOCAL_URL}`);
        return normalizeUrl(DEFAULT_LOCAL_URL);
    }
    p.log.warn(`Local Hootrix instance not found at ${DEFAULT_LOCAL_URL}`);
    return promptAndValidateUrl("http://localhost:5173/");
}
/**
 * Handle self-hosted deployment URL config with retry.
 * Mirrors `handleSelfHostedDeploymentConfig` in the Hootrix SDK.
 */
async function handleSelfHostedDeploymentConfig() {
    return promptAndValidateUrl("https://your-hootrix-instance.com/");
}
/**
 * Prompt the user for a URL and validate connectivity, retrying up to MAX_URL_RETRIES times.
 * Returns the normalized URL on success, or calls p.cancel and throws on max retries.
 */
async function promptAndValidateUrl(placeholder) {
    for (let attempt = 0; attempt < MAX_URL_RETRIES; attempt++) {
        const urlInput = await p.text({
            message: "Please enter your Hootrix instance URL:",
            placeholder,
            validate(value) {
                if (!value || !value.trim())
                    return "URL cannot be empty. Please enter a valid URL...";
                try {
                    new URL(value.trim());
                }
                catch {
                    return "Invalid URL format. The URL should follow a format similar to http://localhost:5173/";
                }
            },
        });
        if (p.isCancel(urlInput)) {
            p.cancel("Setup cancelled.");
            throw new Error("cancelled");
        }
        const normalized = normalizeUrl(urlInput.trim());
        const spinner = p.spinner();
        spinner.start("Checking connectivity...");
        const accessible = await isHootrixAccessible(normalized, 5_000);
        spinner.stop(accessible ? "Connected." : "Not reachable.");
        if (accessible)
            return normalized;
        if (attempt + 1 < MAX_URL_RETRIES) {
            p.log.error(`Hootrix is not accessible at ${normalized}. Please try again. (Attempt ${attempt + 1}/${MAX_URL_RETRIES})`);
        }
    }
    p.cancel(`Failed to connect to Hootrix after ${MAX_URL_RETRIES} attempts.`);
    throw new Error(`Failed to connect to Hootrix after ${MAX_URL_RETRIES} attempts`);
}
/**
 * Manual API key entry with collector-side validation.
 */
async function promptManualApiKeyCredentials(deployment, host) {
    let apiKeyValidated = false;
    let apiKey;
    const collectorBaseUrl = normalizeUrl(HOOTRIX_COLLECTOR_HOST);
    while (!apiKeyValidated) {
        for (const line of getApiKeyHelpText(deployment, host)) {
            p.log.info(line);
        }
        const keyInput = await p.password({
            message: "Enter your Hootrix API key:",
            validate(value) {
                if (!value || !value.trim())
                    return "API key is required";
            },
        });
        if (p.isCancel(keyInput)) {
            p.cancel("Setup cancelled.");
            return null;
        }
        apiKey = keyInput.trim();
        const spinner = p.spinner();
        spinner.start("Validating API key...");
        try {
            await validateHootrixApiKey(apiKey, collectorBaseUrl);
            apiKeyValidated = true;
            spinner.stop("API key validated.");
        }
        catch (err) {
            spinner.stop("Invalid API key.");
            const detail = err instanceof Error ? err.message : String(err);
            if (detail.includes("Invalid API key")) {
                p.log.error("Invalid API key. Please check your API key and try again.");
            }
            else {
                p.log.error(`${detail}. Please try again.`);
            }
        }
    }
    // const workspaceInput = await p.text({
    //   message: `Enter your workspace name (press Enter to use: ${DEFAULT_WORKSPACE_NAME}):`,
    //   placeholder: DEFAULT_WORKSPACE_NAME,
    //   initialValue: DEFAULT_WORKSPACE_NAME,
    //   validate(value) {
    //     if ((!value || !value.trim()) && !DEFAULT_WORKSPACE_NAME) {
    //       return "Workspace name is required";
    //     }
    //   },
    // });
    // if (p.isCancel(workspaceInput)) {
    //   p.cancel("Setup cancelled.");
    //   return null;
    // }
    return {
        apiKey: apiKey,
        workspaceName: DEFAULT_WORKSPACE_NAME,
        // workspaceName: ((workspaceInput as string) || DEFAULT_WORKSPACE_NAME).trim(),
    };
}
// ---------------------------------------------------------------------------
// Interactive configure wizard (mirrors Hootrix SDK getOrAskForProjectData)
// ---------------------------------------------------------------------------
export async function runHootrixConfigure(deps) {
    p.intro("Hootrix setup");
    // Step 1: Check if local Hootrix is already running (for hint in selector)
    const isLocalRunning = await isHootrixAccessible(DEFAULT_LOCAL_URL, 3_000);
    // Step 2: Deployment type selection
    const deployment = await p.select({
        message: `Authenticate your account at: ${HOOTRIX_CLOUD_SIGNUP_URL}`,
        options: [
            { value: "cloud", label: "Press ENTER to open in the browser...", hint: HOOTRIX_CLOUD_SIGNUP_URL },
            // {
            //   value: "self-hosted" as const,
            //   label: "Self-hosted Hootrix platform",
            //   hint: "Custom Hootrix instance",
            // },
            // {
            //   value: "local" as const, 
            //   label: isLocalRunning
            //     ? `Local deployment (detected at ${DEFAULT_LOCAL_URL})`
            //     : "Local deployment",
            //   hint: isLocalRunning ? "Running" : "http://localhost:9823", // collector port
            // },
        ],
        initialValue: isLocalRunning ? "local" : "cloud",
    });
    if (p.isCancel(deployment)) {
        p.cancel("Setup cancelled.");
        return;
    }
    // Step 3: Resolve host URL based on deployment type
    let host;
    try {
        host = HOOTRIX_CLOUD_HOST;
        // if (deployment === "local") {
        //   host = await handleLocalDeploymentConfig();
        // } else if (deployment === "self-hosted") {
        //   host = await handleSelfHostedDeploymentConfig();
        // } else {
        //   host = HOOTRIX_CLOUD_HOST;
        // }
    }
    catch {
        // User cancelled or max retries — already handled via p.cancel
        return;
    }
    // Step 4: API key + workspace (only for cloud and self-hosted)
    let apiKey;
    let workspaceName;
    let apiUrlOverride;
    if (deployment === "local") {
        workspaceName = "openclaw";
    }
    else if (deployment === "cloud") {
        const authSpinner = p.spinner();
        authSpinner.start("Opening browser for Hootrix Cloud sign-in…");
        const bundle = await runCloudDeviceAuth({
            logInfo: (message) => {
                authSpinner.stop(message);
                authSpinner.start("Waiting for you to sign in using the browser…");
            },
            logWarn: (message) => {
                authSpinner.stop(message);
            },
        });
        if (bundle) {
            authSpinner.stop("Sign-in complete.");
            apiKey = bundle.api_key;
            workspaceName = bundle.workspace_name;
            apiUrlOverride = bundle.api_url;
            const who = bundle.user.display_name?.trim() ||
                bundle.user.email?.trim() ||
                bundle.user.id;
            p.log.success(`Hootrix Cloud sign-in complete (${who}).`);
        }
        else {
            const manual = await promptManualApiKeyCredentials(deployment, host);
            if (!manual)
                return;
            apiKey = manual.apiKey;
            workspaceName = manual.workspaceName;
        }
    }
    else {
        const manual = await promptManualApiKeyCredentials(deployment, host);
        if (!manual)
            return;
        apiKey = manual.apiKey;
        workspaceName = manual.workspaceName;
    }
    // // Step 5: Project name
    // const projectInput = await p.text({
    //   message: "Enter your project name (optional):",
    //   placeholder: "openclaw",
    //   initialValue: "openclaw",
    // });
    // if (p.isCancel(projectInput)) {
    //   p.cancel("Setup cancelled.");
    //   return;
    // }
    // const projectName = (projectInput as string).trim() || "openclaw";
    const projectName = DEFAULT_PROJECT_NAME;
    // Step 6: Build API URL from host and write config
    const apiUrl = apiUrlOverride ?? normalizeUrl(HOOTRIX_COLLECTOR_HOST);
    const existingHootrix = getHootrixPluginEntry(deps.readConfig()).config;
    const nextHootrix = {
        ...existingHootrix,
        enabled: true,
        apiUrl,
        ...(apiKey ? { apiKey } : {}),
        workspaceName,
        projectName,
    };
    await deps.mutateConfigFile({
        afterWrite: { mode: "auto" },
        mutate(draft) {
            applyHootrixPluginEntryToDraft(draft, nextHootrix, true);
        },
    });
    const projectsUrl = buildProjectsUrl(host, workspaceName);
    p.note([
        `API URL:    ${apiUrl}`,
        // `Workspace:  ${workspaceName}`,
        // `Project:    ${projectName}`,
        `API key:    ${apiKey ? "***" : "(none)"}`,
        "",
        `View your Trace Data: ${projectsUrl}`,
    ].join("\n"), "Hootrix configuration saved");
    p.outro("Restart the gateway to apply changes.");
}
// ---------------------------------------------------------------------------
// Status display
// ---------------------------------------------------------------------------
export function showHootrixStatus(deps) {
    const cfg = deps.readConfig();
    const entry = getHootrixPluginEntry(cfg);
    const hootrix = entry.config;
    if (entry.enabled === undefined && Object.keys(hootrix).length === 0) {
        console.log("Hootrix is not configured. Run: openclaw hootrix configure");
        return;
    }
    const enabled = entry.enabled !== false && hootrix.enabled !== false;
    const lines = [
        `  Enabled:    ${enabled ? "yes" : "no"}`,
        `  API URL:    ${hootrix.apiUrl ?? "(default)"}`,
        // `  Workspace:  ${(hootrix.workspaceName as string) ?? "default"}`,
        // `  Project:    ${(hootrix.projectName as string) ?? "openclaw"}`,
        `  API key:    ${hootrix.apiKey ? "***" : "(not set)"}`,
    ];
    const tags = hootrix.tags;
    if (tags?.length) {
        lines.push(`  Tags:       ${tags.join(", ")}`);
    }
    console.log("Hootrix trace status:\n");
    console.log(lines.join("\n"));
}
