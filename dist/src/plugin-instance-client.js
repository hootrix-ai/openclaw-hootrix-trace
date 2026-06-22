/**
 * Plugin instance registry — register / heartbeat / deregister with trace-collector.
 */
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { arch, hostname, networkInterfaces, platform, release } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { collectorFetch } from "./collector-fetch.js";
import { HOOTRIX_PLUGIN_ID } from "./constants.js";
import { HOOTRIX_CREATED_FROM } from "./service/constants.js";
import { traceDbg } from "./trace-logger.js";
const HEARTBEAT_INTERVAL_MS = 45_000;
const PLUGIN_DISPLAY_NAME = "OpenClaw Plugin";
const INSTANCE_ID_DIR = join(process.env.HOME?.trim() || process.env.USERPROFILE?.trim() || "/tmp", ".openclaw");
function instanceIdScope(apiKey) {
    const key = apiKey?.trim();
    if (!key) {
        return "default";
    }
    return createHash("sha256").update(key).digest("hex").slice(0, 12);
}
function instanceIdFilePath(apiKey) {
    return join(INSTANCE_ID_DIR, `hootrix-plugin-instance-id-${instanceIdScope(apiKey)}`);
}
function pluginRootDir() {
    return join(dirname(fileURLToPath(import.meta.url)), "..");
}
export function readPluginPackageVersion() {
    try {
        const raw = readFileSync(join(pluginRootDir(), "package.json"), "utf8");
        const pkg = JSON.parse(raw);
        const v = pkg.version?.trim();
        return v || "0.0.0";
    }
    catch {
        return "0.0.0";
    }
}
export function normalizeCollectorWorkspaceName(workspaceName) {
    const ws = String(workspaceName ?? "").trim();
    if (!ws || ws.toLowerCase() === "default") {
        return "OpenClaw";
    }
    return ws;
}
function isIPv4Family(family) {
    return family === "IPv4" || family === 4;
}
function isVirtualInterface(name) {
    const n = name.toLowerCase();
    return (n === "lo" ||
        n.startsWith("docker") ||
        n.startsWith("br-") ||
        n.startsWith("veth") ||
        n.startsWith("vmnet") ||
        n.startsWith("utun"));
}
function scoreIPv4(name, ip) {
    let score = 100;
    const n = name.toLowerCase();
    if (n === "en0" || n === "eth0" || n === "wlan0" || n.startsWith("wi-fi")) {
        score -= 40;
    }
    if (isVirtualInterface(name)) {
        score += 80;
    }
    if (ip.startsWith("192.168.") || ip.startsWith("10.")) {
        score -= 30;
    }
    if (ip.startsWith("169.254.")) {
        score += 40;
    }
    if (ip.startsWith("172.")) {
        score += 20;
    }
    return score;
}
/** Prefer a stable non-loopback IPv4 address on the machine. */
export function resolveMachineIp() {
    const nets = networkInterfaces();
    const ranked = [];
    for (const [name, addrs] of Object.entries(nets)) {
        if (!addrs || isVirtualInterface(name)) {
            continue;
        }
        for (const addr of addrs) {
            if (!addr || addr.internal || !isIPv4Family(addr.family)) {
                continue;
            }
            const ip = addr.address?.trim();
            if (!ip) {
                continue;
            }
            ranked.push({ ip, score: scoreIPv4(name, ip) });
        }
    }
    ranked.sort((a, b) => a.score - b.score);
    if (ranked[0]?.ip) {
        return ranked[0].ip;
    }
    for (const addrs of Object.values(nets)) {
        if (!addrs) {
            continue;
        }
        for (const addr of addrs) {
            if (!addr || addr.internal || !isIPv4Family(addr.family)) {
                continue;
            }
            const ip = addr.address?.trim();
            if (ip) {
                return ip;
            }
        }
    }
    return "127.0.0.1";
}
export function collectPluginSystemInfo(host) {
    return {
        platform: platform(),
        arch: arch(),
        release: release(),
        hostname: host,
        node_version: process.version,
        plugin_version: readPluginPackageVersion(),
    };
}
/** Stable per-machine + per-account instance id persisted under ~/.openclaw/. */
export function getOrCreatePluginInstanceId(apiKey) {
    const instanceIdFile = instanceIdFilePath(apiKey);
    try {
        if (existsSync(instanceIdFile)) {
            const existing = readFileSync(instanceIdFile, "utf8").trim();
            if (existing.length > 0) {
                return existing;
            }
        }
    }
    catch {
        // fall through to create
    }
    const host = hostname().trim() || "host";
    const id = `${host}-${createHash("sha256").update(host + HOOTRIX_PLUGIN_ID).digest("hex").slice(0, 12)}-${randomUUID().slice(0, 8)}`;
    try {
        mkdirSync(INSTANCE_ID_DIR, { recursive: true });
        writeFileSync(instanceIdFile, id, "utf8");
    }
    catch {
        // still return ephemeral id for this process
    }
    return id;
}
function buildHeaders(apiKey) {
    const headers = {
        Accept: "application/json",
        "Content-Type": "application/json",
    };
    if (apiKey) {
        headers["X-API-Key"] = apiKey;
        headers.Authorization = `Bearer ${apiKey}`;
    }
    return headers;
}
async function postJson(config, path, body) {
    const base = config.baseUrl.replace(/\/+$/, "");
    try {
        const res = await collectorFetch(`${base}${path}`, {
            method: "POST",
            headers: buildHeaders(config.apiKey),
            body: JSON.stringify(body),
        });
        if (!res.ok) {
            traceDbg("plugin_instance", {
                node: "post_failed",
                path,
                status: res.status,
                body: await res.text().catch(() => ""),
            });
            return false;
        }
        return true;
    }
    catch (err) {
        traceDbg("plugin_instance", { node: "post_error", path, error: String(err) });
        return false;
    }
}
export function buildPluginInstancePayload(params) {
    const host = hostname().trim() || "localhost";
    return {
        instance_id: params.instanceId,
        plugin_id: HOOTRIX_PLUGIN_ID,
        plugin_type: HOOTRIX_CREATED_FROM,
        plugin_version: readPluginPackageVersion(),
        workspace_name: normalizeCollectorWorkspaceName(params.workspaceName),
        host,
        hostname: host,
        display_name: params.displayName?.trim() || PLUGIN_DISPLAY_NAME,
        machine_ip: resolveMachineIp(),
        system_info: collectPluginSystemInfo(host),
        agent_count: params.agentCount ?? 0,
    };
}
export async function registerPluginInstance(config, payload) {
    return postJson(config, "/v1/plugin/instances/register", payload);
}
export async function heartbeatPluginInstance(config, payload) {
    return postJson(config, "/v1/plugin/instances/heartbeat", payload);
}
export async function deregisterPluginInstance(config, instanceId) {
    return postJson(config, "/v1/plugin/instances/deregister", { instance_id: instanceId });
}
export function startPluginInstanceReporter(params) {
    const instanceId = getOrCreatePluginInstanceId(params.config.apiKey);
    let stopped = false;
    let timer;
    const buildPayload = () => buildPluginInstancePayload({
        instanceId,
        workspaceName: params.workspaceName,
        agentCount: params.agentCount(),
    });
    const report = async (kind) => {
        if (stopped) {
            return;
        }
        const payload = buildPayload();
        if (kind === "register") {
            const ok = await registerPluginInstance(params.config, payload);
            if (!ok) {
                traceDbg("plugin_instance", { node: "register_failed", instanceId });
            }
            return;
        }
        const ok = await heartbeatPluginInstance(params.config, payload);
        if (!ok) {
            await registerPluginInstance(params.config, payload);
        }
    };
    void report("register");
    timer = setInterval(() => {
        void report("heartbeat");
    }, HEARTBEAT_INTERVAL_MS);
    return {
        async stop() {
            stopped = true;
            if (timer) {
                clearInterval(timer);
                timer = undefined;
            }
            await deregisterPluginInstance(params.config, instanceId);
        },
    };
}
export { HEARTBEAT_INTERVAL_MS };
