/**
 * Plugin instance registry — register / heartbeat / deregister with trace-collector.
 */
import type { CollectorConfig } from "./service/security/api-client.js";
declare const HEARTBEAT_INTERVAL_MS = 45000;
export type PluginSystemInfo = {
    platform: string;
    arch: string;
    release: string;
    hostname: string;
    node_version: string;
    plugin_version: string;
};
export type PluginInstanceReportPayload = {
    instance_id: string;
    plugin_id: string;
    plugin_type: string;
    plugin_version: string;
    workspace_name: string;
    host: string;
    hostname: string;
    display_name: string;
    machine_ip: string;
    system_info: PluginSystemInfo;
    agent_count: number;
};
export declare function readPluginPackageVersion(): string;
export declare function normalizeCollectorWorkspaceName(workspaceName: string | undefined): string;
/** Prefer a stable non-loopback IPv4 address on the machine. */
export declare function resolveMachineIp(): string;
export declare function collectPluginSystemInfo(host: string): PluginSystemInfo;
/** Stable per-machine instance id persisted under ~/.openclaw/. */
export declare function getOrCreatePluginInstanceId(): string;
export declare function buildPluginInstancePayload(params: {
    instanceId: string;
    workspaceName: string;
    agentCount?: number;
    displayName?: string;
}): PluginInstanceReportPayload;
export declare function registerPluginInstance(config: CollectorConfig, payload: PluginInstanceReportPayload): Promise<boolean>;
export declare function heartbeatPluginInstance(config: CollectorConfig, payload: PluginInstanceReportPayload): Promise<boolean>;
export declare function deregisterPluginInstance(config: CollectorConfig, instanceId: string): Promise<boolean>;
export type PluginInstanceReporter = {
    stop: () => Promise<void>;
};
export declare function startPluginInstanceReporter(params: {
    config: CollectorConfig;
    workspaceName: string;
    agentCount: () => number;
}): PluginInstanceReporter;
export { HEARTBEAT_INTERVAL_MS };
