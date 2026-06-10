import * as p from "@clack/prompts";
import { collectorFetch } from "./collector-fetch.js";
import { buildOpikApiUrl, isHootrixCollectorBaseUrl } from "./collector-url.js";
import { runCloudDeviceAuth } from "./device-auth.js";
/** Opik Cloud host (matches SDK's DEFAULT_HOST_URL). */
const HOOTRIX_CLOUD_HOST = "https://hootrix.ai/";
const HOOTRIX_CLOUD_SIGNUP_URL = "https://www.hootrix.ai/signup?from=llm&source=openclaw";
/** Default local Hootrix URL (matches SDK's DEFAULT_LOCAL_URL). */
const DEFAULT_LOCAL_URL = "http://localhost:6820/";
/** Max URL validation retries (matches SDK's MAX_URL_VALIDATION_RETRIES). */
const MAX_URL_RETRIES = 3;
const HOOTRIX_PLUGIN_ID = "openclaw-hootrix-trace";
function asObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return {};
    }
    return value;
}
export function getOpikPluginEntry(cfg) {
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
export function setOpikPluginEntry(cfg, config, enabled = true) {
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
function applyOpikPluginEntryToDraft(draft, config, enabled = true) {
    const merged = setOpikPluginEntry(draft, config, enabled);
    const root = draft;
    const mergedRoot = merged;
    root.plugins = mergedRoot.plugins;
}
// ---------------------------------------------------------------------------
// URL helpers (mirrors opik SDK api-helpers.ts / urls.ts)
// ---------------------------------------------------------------------------
/** Ensure trailing slash on a URL. */
function normalizeUrl(url) {
    return url.endsWith("/") ? url : `${url}/`;
}
/** True when the URL targets Hootrix trace-collector (not Opik UI / Comet Cloud). */
export { isHootrixCollectorBaseUrl, buildOpikApiUrl } from "./collector-url.js";
/**
 * Build a browser URL pointing to the projects list in the Opik UI.
 * Cloud/self-hosted: {host}opik/{workspace}/projects
 * Local:             {host}{workspace}/projects
 */
function buildProjectsUrl(host, workspaceName) {
    const base = host.endsWith("/") ? host.slice(0, -1) : host;
    const isLocal = base.includes("localhost") || base.includes("127.0.0.1");
    const prefix = isLocal ? "" : "/opik";
    return `${base}${prefix}/${encodeURIComponent(workspaceName)}/projects`;
}
function buildApiKeysUrl(host) {
    return new URL("account-settings/apiKeys", normalizeUrl(host)).toString();
}
export function getApiKeyHelpText(deployment, host) {
    const lines = [`You can find your Opik API key here:\n${buildApiKeysUrl(host)}`];
    if (deployment === "cloud") {
        lines.push(`No Hootrix Cloud account yet? Sign up for a free account:\n${HOOTRIX_CLOUD_SIGNUP_URL}`);
    }
    return lines;
}
// ---------------------------------------------------------------------------
// API validation helpers (mirrors opik SDK api-helpers.ts)
// ---------------------------------------------------------------------------
/**
 * Check if an Opik instance is accessible at the given URL.
 * Accepts 2xx-4xx as valid (even 404 means server is running).
 * Mirrors `isOpikAccessible` in the Opik SDK.
 */
async function isOpikAccessible(url, timeoutMs = 5_000) {
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
/**
 * Fetch the default workspace for an API key.
 * Mirrors `getDefaultWorkspace` in the Opik SDK.
 * @returns The default workspace name on success, throws on failure.
 */
async function getDefaultWorkspace(apiKey, baseUrl) {
    const accountDetailsUrl = new URL("api/rest/v2/account-details", baseUrl).toString();
    const res = await fetch(accountDetailsUrl, {
        headers: {
            Authorization: apiKey,
            "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) {
        throw new Error(`Failed to fetch account details (status ${res.status})`);
    }
    const body = (await res.json());
    if (typeof body.defaultWorkspaceName !== "string" || !body.defaultWorkspaceName) {
        throw new Error("defaultWorkspaceName not found in the response");
    }
    return body.defaultWorkspaceName;
}
// ---------------------------------------------------------------------------
// Deployment-specific URL handlers (mirrors opik SDK clack-utils.ts)
// ---------------------------------------------------------------------------
/**
 * Handle local deployment URL config with auto-detection and retry.
 * Mirrors `handleLocalDeploymentConfig` in the Opik SDK.
 */
async function handleLocalDeploymentConfig() {
    const isDefaultRunning = await isOpikAccessible(DEFAULT_LOCAL_URL, 3_000);
    if (isDefaultRunning) {
        p.log.success(`Local Opik instance detected at ${DEFAULT_LOCAL_URL}`);
        return normalizeUrl(DEFAULT_LOCAL_URL);
    }
    p.log.warn(`Local Opik instance not found at ${DEFAULT_LOCAL_URL}`);
    return promptAndValidateUrl("http://localhost:5173/");
}
/**
 * Handle self-hosted deployment URL config with retry.
 * Mirrors `handleSelfHostedDeploymentConfig` in the Opik SDK.
 */
async function handleSelfHostedDeploymentConfig() {
    return promptAndValidateUrl("https://your-opik-instance.com/");
}
/**
 * Prompt the user for a URL and validate connectivity, retrying up to MAX_URL_RETRIES times.
 * Returns the normalized URL on success, or calls p.cancel and throws on max retries.
 */
async function promptAndValidateUrl(placeholder) {
    for (let attempt = 0; attempt < MAX_URL_RETRIES; attempt++) {
        const urlInput = await p.text({
            message: "Please enter your Opik instance URL:",
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
        const accessible = await isOpikAccessible(normalized, 5_000);
        spinner.stop(accessible ? "Connected." : "Not reachable.");
        if (accessible)
            return normalized;
        if (attempt + 1 < MAX_URL_RETRIES) {
            p.log.error(`Opik is not accessible at ${normalized}. Please try again. (Attempt ${attempt + 1}/${MAX_URL_RETRIES})`);
        }
    }
    p.cancel(`Failed to connect to Opik after ${MAX_URL_RETRIES} attempts.`);
    throw new Error(`Failed to connect to Opik after ${MAX_URL_RETRIES} attempts`);
}
/**
 * Manual API key entry with account-details validation (Opik / legacy cloud fallback).
 */
async function promptManualApiKeyCredentials(deployment, host) {
    let defaultWorkspaceName;
    let apiKeyValidated = false;
    let apiKey;
    while (!apiKeyValidated) {
        for (const line of getApiKeyHelpText(deployment, host)) {
            p.log.info(line);
        }
        const keyInput = await p.password({
            message: "Enter your Opik API key:",
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
            defaultWorkspaceName = await getDefaultWorkspace(apiKey, host);
            apiKeyValidated = true;
            spinner.stop("API key validated.");
        }
        catch {
            spinner.stop("Invalid API key.");
            p.log.error("Invalid API key. Please check your API key and try again.");
        }
    }
    const workspaceInput = await p.text({
        message: defaultWorkspaceName
            ? `Enter your workspace name (press Enter to use: ${defaultWorkspaceName}):`
            : "Enter your workspace name:",
        placeholder: defaultWorkspaceName ?? "your-workspace-name",
        initialValue: defaultWorkspaceName,
        validate(value) {
            if ((!value || !value.trim()) && !defaultWorkspaceName) {
                return "Workspace name is required";
            }
        },
    });
    if (p.isCancel(workspaceInput)) {
        p.cancel("Setup cancelled.");
        return null;
    }
    return {
        apiKey: apiKey,
        workspaceName: (workspaceInput || defaultWorkspaceName || "default").trim(),
    };
}
// ---------------------------------------------------------------------------
// Interactive configure wizard (mirrors opik SDK getOrAskForProjectData)
// ---------------------------------------------------------------------------
export async function runOpikConfigure(deps) {
    p.intro("Opik setup");
    // Step 1: Check if local Opik is already running (for hint in selector)
    const isLocalRunning = await isOpikAccessible(DEFAULT_LOCAL_URL, 3_000);
    // Step 2: Deployment type selection
    const deployment = await p.select({
        message: "Which Hootrix deployment do you want to log your traces to?",
        options: [
            { value: "cloud", label: "Hootrix Cloud", hint: "https://www.hootrix.ai" },
            {
                value: "self-hosted",
                label: "Self-hosted Hootrix platform",
                hint: "Custom Hootrix instance",
            },
            {
                value: "local",
                label: isLocalRunning
                    ? `Local deployment (detected at ${DEFAULT_LOCAL_URL})`
                    : "Local deployment",
                hint: isLocalRunning ? "Running" : "http://localhost:6820", // collector port
            },
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
        if (deployment === "local") {
            host = await handleLocalDeploymentConfig();
        }
        else if (deployment === "self-hosted") {
            host = await handleSelfHostedDeploymentConfig();
        }
        else {
            host = HOOTRIX_CLOUD_HOST;
        }
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
        workspaceName = "default";
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
    // Step 5: Project name
    const projectInput = await p.text({
        message: "Enter your project name (optional):",
        placeholder: "openclaw",
        initialValue: "openclaw",
    });
    if (p.isCancel(projectInput)) {
        p.cancel("Setup cancelled.");
        return;
    }
    const projectName = projectInput.trim() || "openclaw";
    // Step 6: Build API URL from host and write config
    const apiUrl = apiUrlOverride ?? buildOpikApiUrl(host);
    const existingOpik = getOpikPluginEntry(deps.readConfig()).config;
    const nextOpik = {
        ...existingOpik,
        enabled: true,
        apiUrl,
        ...(apiKey ? { apiKey } : {}),
        workspaceName,
        projectName,
    };
    await deps.mutateConfigFile({
        afterWrite: { mode: "auto" },
        mutate(draft) {
            applyOpikPluginEntryToDraft(draft, nextOpik, true);
        },
    });
    const projectsUrl = buildProjectsUrl(host, workspaceName);
    p.note([
        `API URL:    ${apiUrl}`,
        `Workspace:  ${workspaceName}`,
        `Project:    ${projectName}`,
        `API key:    ${apiKey ? "***" : "(none)"}`,
        "",
        `View your projects: ${projectsUrl}`,
    ].join("\n"), "Opik configuration saved");
    p.outro("Restart the gateway to apply changes.");
}
// ---------------------------------------------------------------------------
// Status display
// ---------------------------------------------------------------------------
export function showOpikStatus(deps) {
    const cfg = deps.readConfig();
    const entry = getOpikPluginEntry(cfg);
    const opik = entry.config;
    if (entry.enabled === undefined && Object.keys(opik).length === 0) {
        console.log("Hootrix is not configured. Run: openclaw hootrix configure");
        return;
    }
    const enabled = entry.enabled !== false && opik.enabled !== false;
    const lines = [
        `  Enabled:    ${enabled ? "yes" : "no"}`,
        `  API URL:    ${opik.apiUrl ?? "(default)"}`,
        `  Workspace:  ${opik.workspaceName ?? "default"}`,
        `  Project:    ${opik.projectName ?? "openclaw"}`,
        `  API key:    ${opik.apiKey ? "***" : "(not set)"}`,
    ];
    const tags = opik.tags;
    if (tags?.length) {
        lines.push(`  Tags:       ${tags.join(", ")}`);
    }
    console.log("Hootrix trace status:\n");
    console.log(lines.join("\n"));
}
