import { collectorFetch } from "./collector-fetch.js";
export type DeviceAuthUser = {
    id: string;
    email?: string;
    display_name?: string;
    locale?: string;
};
export type DeviceAuthBundle = {
    user: DeviceAuthUser;
    workspace_name: string;
    api_key: string;
    api_url: string;
};
export type DeviceAuthSession = {
    session_id: string;
    poll_token: string;
    connect_url: string;
    expires_in: number;
    main_api_url: string;
};
/** Main site API root — Cloud configure always targets production unless overridden. */
export declare function resolveMainApiUrl(): string;
/** Optional local backend probe for dev (`HOOTRIX_DEVICE_AUTH_PROBE_LOCAL=1`). */
export declare function resolveMainApiUrlAsync(fetchImpl?: typeof fetch): Promise<string>;
/** Browser connect page base aligned with the API endpoint in use. */
export declare function resolveMainSiteUrl(mainApiUrl?: string): string;
export declare function buildConnectUrl(sessionId: string, mainApiUrl: string, backendConnectUrl?: string): string;
/** Fetch for device-auth; retries once without TLS verification on certificate errors. */
export declare const deviceAuthFetch: typeof collectorFetch;
export declare function createDeviceAuthSession(params?: {
    clientId?: string;
    installChannel?: string;
    deployment?: string;
    mainApiUrl?: string;
    fetchImpl?: typeof fetch;
}): Promise<DeviceAuthSession>;
export declare function pollDeviceAuthSession(params: {
    sessionId: string;
    pollToken: string;
    mainApiUrl?: string;
    fetchImpl?: typeof fetch;
}): Promise<{
    status: "pending";
} | {
    status: "completed";
    bundle: DeviceAuthBundle;
}>;
export declare function waitForDeviceAuthBundle(params: {
    session: DeviceAuthSession;
    pollIntervalMs?: number;
    timeoutMs?: number;
    fetchImpl?: typeof fetch;
    onPoll?: () => void;
}): Promise<DeviceAuthBundle>;
export declare function openBrowserUrl(url: string): void;
export declare function runCloudDeviceAuth(params?: {
    mainApiUrl?: string;
    openBrowser?: (url: string) => void;
    fetchImpl?: typeof fetch;
    logInfo?: (message: string) => void;
    logWarn?: (message: string) => void;
}): Promise<DeviceAuthBundle | null>;
